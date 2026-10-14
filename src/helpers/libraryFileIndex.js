import { LIBRARY_SALT_TABLE } from "./librarySaltTable.js";
import {
  courseCore,
  departmentFromCourseCode,
  recordNumber
} from "./libraryCourseCodes.js";

export { recordNumber };

// Papers are static files at <origin>/digital/qp/<salt><label>.pdf, where the
// salt comes from the generated table in librarySaltTable.js.
export const LIBRARY_PUBLIC_ORIGIN = "http://14.143.33.149";
const LIBRARY_FILE_DIRECTORY = "digital/qp";
const LIBRARY_FILE_EXTENSION = "pdf";
const UNSALTED = "";

// The uploader normally names a file after the record id but a few are misspelled.
const RECORD_LABEL_SPELLINGS = ["DL{number}", "{number}", "DLL{number}", "D{number}", "L{number}"];

const LIBRARY_SALTS = LIBRARY_SALT_TABLE.salts || [];
const LIBRARY_SUBJECT_SALTS = LIBRARY_SALT_TABLE.subjects || {};
const LIBRARY_FILE_OVERRIDES = LIBRARY_SALT_TABLE.overrides || {};
const LIBRARY_SCHEME_SALTS = LIBRARY_SALT_TABLE.schemeSalts || {};

const LIKELY_SALT_LIMIT = 16;
const SCHEME_SALT_LIMIT = 8;
const SCHEME_PATTERN = /^([A-Z]{2}\d{2})/;

const SALT_RANK = new Map(LIBRARY_SALTS.map((salt, index) => [salt, index]));

function byRecency(salts) {
  return [...new Set(salts)].sort(
    (first, second) => (SALT_RANK.get(first) ?? Infinity) - (SALT_RANK.get(second) ?? Infinity)
  );
}

function schemeFromCourseCode(courseCode) {
  const match = String(courseCode || "").match(SCHEME_PATTERN);
  return match ? match[1] : "";
}

function saltsForScheme(courseCode) {
  return LIBRARY_SCHEME_SALTS[schemeFromCourseCode(courseCode)] || [];
}

function buildPublicFileUrl(salt, label) {
  return `${LIBRARY_PUBLIC_ORIGIN}/${LIBRARY_FILE_DIRECTORY}/${salt}${label}.${LIBRARY_FILE_EXTENSION}`;
}

// Set only for records the standard pattern cannot build. A miss on one is
// authoritative, because the OPAC rendered that exact path.
export function fileOverrideForRecord(recordId) {
  const override = LIBRARY_FILE_OVERRIDES[recordNumber(recordId)];
  return override ? `${LIBRARY_PUBLIC_ORIGIN}/${override}` : "";
}

export function publicFileUrlForRecord(recordId, salt) {
  const number = recordNumber(recordId);
  if (!number) {
    return "";
  }

  return buildPublicFileUrl(salt || UNSALTED, `DL${number}`);
}

function saltsForCourse(courseCode, learnedSalts = []) {
  const known = LIBRARY_SUBJECT_SALTS[courseCode] || [];
  return [...new Set([...learnedSalts, ...known])].filter(Boolean);
}

// Covers a new scheme year, where the same subject is filed under a fresh code.
function saltsForSubjectCore(courseCode) {
  const core = courseCore(courseCode);
  if (!core) {
    return [];
  }

  return byRecency(Object.entries(LIBRARY_SUBJECT_SALTS)
    .filter(([code]) => code !== courseCode && courseCore(code) === core)
    .flatMap(([, salts]) => salts));
}

function relatedSalts(courseCode) {
  const department = departmentFromCourseCode(courseCode);
  const semester = String(courseCode || "").slice(4, 5);
  if (!courseCore(courseCode) && !department && !semester) {
    return [];
  }

  const entries = Object.entries(LIBRARY_SUBJECT_SALTS).filter(([code]) => code !== courseCode);
  const byDepartment = department
    ? entries.filter(([code]) => departmentFromCourseCode(code) === department)
    : [];
  const bySemester = semester
    ? entries.filter(([code]) => String(code).slice(4, 5) === semester)
    : [];

  return byRecency([
    ...saltsForSubjectCore(courseCode),
    ...saltsForScheme(courseCode),
    ...byDepartment.flatMap(([, salts]) => salts),
    ...bySemester.flatMap(([, salts]) => salts)
  ]);
}

// Most likely first: the course's own salts, the same subject in any scheme, the
// same scheme year, then the department, the semester, and finally every salt.
export function orderedSaltCandidates({ courseCode = "", pinnedSalt = "", learnedSalts = [], includeUnsalted = true }) {
  const pinned = pinnedSalt ? [pinnedSalt] : [];
  return [...new Set([
    ...(includeUnsalted ? [UNSALTED] : []),
    ...pinned,
    ...saltsForCourse(courseCode, learnedSalts),
    ...relatedSalts(courseCode),
    ...LIBRARY_SALTS
  ])];
}

// Every spelling for the course's own salts, then the standard spelling for the
// rest, so a misspelled file is found next to its salt instead of after a sweep.
export function buildFileUrlPlan({ recordId, courseCode = "", pinnedSalt = "", learnedSalts = [] }) {
  const number = recordNumber(recordId);
  if (!number) {
    return [];
  }

  const [primarySpelling, ...alternateSpellings] = RECORD_LABEL_SPELLINGS;
  const primaryLabel = primarySpelling.replace("{number}", number);
  const salts = orderedSaltCandidates({ courseCode, pinnedSalt, learnedSalts });
  const courseSalts = saltsForCourse(courseCode, learnedSalts);
  const likelySalts = [...new Set([
    pinnedSalt,
    ...courseSalts,
    ...saltsForSubjectCore(courseCode),
    ...(courseSalts.length === 0 ? saltsForScheme(courseCode).slice(0, SCHEME_SALT_LIMIT) : [])
  ])].filter((salt) => salt !== UNSALTED).slice(0, LIKELY_SALT_LIMIT);

  const candidates = [];
  const override = LIBRARY_FILE_OVERRIDES[number];
  if (override) {
    candidates.push({
      salt: fileSaltFromFileName(override, number),
      label: override.split("/").pop().replace(/\.pdf$/i, ""),
      url: `${LIBRARY_PUBLIC_ORIGIN}/${override}`
    });
  }

  candidates.push({
    salt: UNSALTED,
    label: primaryLabel,
    url: buildPublicFileUrl(UNSALTED, primaryLabel)
  });

  for (const salt of likelySalts) {
    for (const spelling of RECORD_LABEL_SPELLINGS) {
      const label = spelling.replace("{number}", number);
      candidates.push({ salt, label, url: buildPublicFileUrl(salt, label) });
    }
  }

  const remaining = salts.filter((salt) => salt !== UNSALTED && !likelySalts.includes(salt));
  candidates.push(...remaining.map((salt) => ({
    salt,
    label: primaryLabel,
    url: buildPublicFileUrl(salt, primaryLabel)
  })));

  candidates.push(...alternateSpellings.map((spelling) => {
    const label = spelling.replace("{number}", number);
    return { salt: UNSALTED, label, url: buildPublicFileUrl(UNSALTED, label) };
  }));

  const seen = new Set();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.url)) {
      return false;
    }
    seen.add(candidate.url);
    return true;
  });
}

function fileSaltFromFileName(fileName, number) {
  const stem = String(fileName).replace(/\.pdf$/i, "");
  const index = stem.lastIndexOf(number);
  return index > 0 ? stem.slice(0, index).replace(/dl+$/i, "") : "";
}
