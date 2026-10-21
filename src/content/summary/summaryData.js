export const ATTENDANCE_THRESHOLD = 75;

export const ATTENDANCE_LEVELS = ["below", "edge", "thin", "safe", "na"];

export const LEVEL_RANK = {
  below: 0,
  edge: 1,
  thin: 2,
  safe: 3,
  na: 4
};

const STATUS_LABELS = {
  below: `Below ${ATTENDANCE_THRESHOLD}%`,
  edge: "No margin",
  thin: "Thin margin",
  safe: "On track",
  na: "No data"
};

const clean = (value) => String(value == null ? "" : value).replace(/\s+/g, " ").trim();

export const normalizeCourseCode = (value) =>
  String(value == null ? "" : value).toUpperCase().replace(/[^A-Z0-9]/g, "");

export const normalizeCourseName = (value) =>
  clean(value).toLowerCase().replace(/[^a-z0-9]/g, "");

export function formatPercent(value) {
  if (value == null || !Number.isFinite(Number(value))) return "NA";
  const floored = Math.floor(Number(value) * 10) / 10;
  return Number.isInteger(floored) ? String(floored) : floored.toFixed(1);
}

export function semesterNumber(value) {
  const match = String(value == null ? "" : value).match(/(\d+)/);
  return match ? Number(match[1]) : null;
}

export function chooseSemester(semesters, profile) {
  if (!Array.isArray(semesters) || !semesters.length) return null;
  const profileNumber = profile && profile.semester != null
    ? semesterNumber(profile.semester)
    : null;
  if (profileNumber != null) {
    const match = semesters.find((semester) => semesterNumber(semester.label) === profileNumber);
    if (match) return match;
  }
  return semesters[0];
}

export function formatSemesterLabel(value) {
  const label = clean(value);
  const match = label.match(/^sem(?:ester)?\s*[-–]?\s*(\d+)$/i);
  if (match) return `Semester ${match[1]}`;
  return label;
}

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

export const statusLabel = (level) => STATUS_LABELS[level] || STATUS_LABELS.na;

function spanPercent(attended, total) {
  return total > 0 ? Math.min(100, Math.max(0, (attended / total) * 100)) : 0;
}

export function attendanceStats(row) {
  const percentage = row && row.percentage != null ? Number(row.percentage) : NaN;
  const attended = row && row.attended != null ? Number(row.attended) : null;
  const total = row && row.total != null ? Number(row.total) : null;
  const hasNumbers =
    Number.isInteger(attended) &&
    Number.isInteger(total) &&
    attended >= 0 &&
    total > 0 &&
    attended <= total;

  if (!hasNumbers || !Number.isFinite(percentage)) {
    return {
      level: "na",
      displayPercent: null,
      truePercent: null,
      barPercent: 0,
      spare: null,
      need: null,
      nextPercent: null
    };
  }

  const safe = attended * 100 >= ATTENDANCE_THRESHOLD * total;
  const spare = safe
    ? Math.floor((attended * 100 - ATTENDANCE_THRESHOLD * total) / ATTENDANCE_THRESHOLD)
    : null;
  const need = safe
    ? null
    : Math.max(
        1,
        Math.ceil(
          (ATTENDANCE_THRESHOLD * total - attended * 100) / (100 - ATTENDANCE_THRESHOLD)
        )
      );
  const level = !safe ? "below" : spare === 0 ? "edge" : spare <= 2 ? "thin" : "safe";

  return {
    level,
    displayPercent: Math.floor(percentage * 10) / 10,
    truePercent: (attended / total) * 100,
    barPercent: spanPercent(attended, total),
    spare,
    need,
    nextPercent: Math.floor(((attended * 1000) / (total + 1))) / 10
  };
}

export function marginCopy(course) {
  if (course.level === "na") return "Attendance not published.";
  if (course.level === "below") {
    return `Attend ${course.need} straight ${course.need === 1 ? "class" : "classes"} to reach ${ATTENDANCE_THRESHOLD}%.`;
  }
  if (course.level === "edge") {
    return `One more absence drops to ${formatPercent(course.nextPercent)}%.`;
  }
  return `${plural(course.spare, "absence", "absences")} to spare.`;
}

export function readSemesters(text) {
  let html = String(text == null ? "" : text).trim();
  if (html.startsWith('"')) {
    try {
      const parsed = JSON.parse(html);
      if (typeof parsed === "string") html = parsed;
    } catch (error) {
    }
  }

  const doc = new DOMParser().parseFromString(html, "text/html");
  return [...doc.querySelectorAll("option")]
    .map((option) => ({
      value: option.value.trim().replace(/^["']|["']$/g, ""),
      label: clean(option.textContent)
    }))
    .filter((option) => option.value && option.label);
}

export function readAttendance(html) {
  const doc = new DOMParser().parseFromString(String(html == null ? "" : html), "text/html");
  const rows = [];

  doc.querySelectorAll("#subjetInfo tr").forEach((row) => {
    const cells = [...row.cells];
    if (cells.length < 4) return;

    const courseCode = clean(cells[0].textContent);
    const courseName = clean(cells[1].textContent);
    if (!courseCode && !courseName) return;

    const classesText = clean(cells[2].textContent);
    const percentageText = clean(cells[3].textContent);
    let attended = null;
    let total = null;

    if (classesText !== "NA" && classesText.includes("/")) {
      const [attendedText, totalText] = classesText.split("/");
      const attendedNumber = parseInt(attendedText, 10);
      const totalNumber = parseInt(totalText, 10);
      if (Number.isInteger(attendedNumber) && Number.isInteger(totalNumber)) {
        attended = attendedNumber;
        total = totalNumber;
      }
    }

    const percentage = parseInt(percentageText, 10);
    rows.push({
      courseCode,
      courseName,
      classesText,
      attended,
      total,
      percentage: percentageText === "NA" || !Number.isInteger(percentage) ? null : percentage
    });
  });

  return rows;
}

export function readCourseList(html) {
  const doc = new DOMParser().parseFromString(String(html == null ? "" : html), "text/html");

  return [...doc.querySelectorAll('tr[id^="rowWiseCourseContent_"]')]
    .map((row) => ({
      id: clean(row.id.replace("rowWiseCourseContent_", "")),
      code: clean(row.cells[0] ? row.cells[0].textContent : ""),
      name: clean(row.cells[1] ? row.cells[1].textContent : ""),
      status: clean(row.cells[3] ? row.cells[3].textContent : "")
    }))
    .filter((course) => course.id && (course.code || course.name))
    .filter((course) => !course.status || course.status.toLowerCase() === "enrolled");
}

export function readCoursePage(html) {
  const doc = new DOMParser().parseFromString(String(html == null ? "" : html), "text/html");
  const found = Boolean(
    doc.querySelector("#courseContentCategory") || doc.querySelector(".course-info-content")
  );
  const seen = new Set();
  const units = [];

  doc.querySelectorAll("#courselistunit li a").forEach((anchor) => {
    const onclick = anchor.getAttribute("onclick") || "";
    const match = onclick.match(/handleclassUnit\s*\(\s*['"]([^'"]+)['"]/i);
    const id = clean(match ? match[1] : "");
    if (!id || seen.has(id)) return;
    seen.add(id);

    const name = clean(anchor.textContent) || clean(anchor.getAttribute("title"));
    units.push({ id, name, number: units.length + 1 });
  });

  return {
    found,
    units,
    subType: doc.querySelector("#subType") ? clean(doc.querySelector("#subType").value) : "5",
    selectedData: doc.querySelector("#selectedData")
      ? clean(doc.querySelector("#selectedData").value)
      : null
  };
}

function materialMatch(course, byCode, byName) {
  const code = normalizeCourseCode(course.code);
  if (code && byCode.has(code)) return byCode.get(code);
  const name = normalizeCourseName(course.name);
  if (name && byName.get(name) && byName.get(name).length === 1) return byName.get(name)[0];
  return null;
}

const materialOf = (course) =>
  course
    ? { id: course.id, code: course.code || "", name: course.name || "" }
    : null;

export function buildCourses(attendanceRows = [], materialCourses = []) {
  const byCode = new Map();
  const byName = new Map();

  materialCourses.forEach((course) => {
    const code = normalizeCourseCode(course.code);
    if (code && !byCode.has(code)) byCode.set(code, course);
    const name = normalizeCourseName(course.name);
    if (name) {
      const list = byName.get(name) || [];
      list.push(course);
      byName.set(name, list);
    }
  });

  const used = new Set();
  const seenAttendance = new Set();
  const courses = [];

  attendanceRows.forEach((row, index) => {
    const code = normalizeCourseCode(row.courseCode);
    const name = normalizeCourseName(row.courseName);
    const dedupe = code || name || `row-${index}`;
    if (seenAttendance.has(dedupe)) return;
    seenAttendance.add(dedupe);

    const match = materialMatch(
      { code: row.courseCode, name: row.courseName },
      byCode,
      byName
    );
    if (match) used.add(match.id);

    const stats = attendanceStats(row);
    courses.push({
      key: match ? `material:${match.id}` : code ? `code:${code}` : `name:${name || index}`,
      name: row.courseName || (match && match.name) || "Course",
      attended: row.attended,
      total: row.total,
      percentage: row.percentage,
      material: materialOf(match),
      ...stats
    });
  });

  materialCourses.forEach((material) => {
    if (used.has(material.id)) return;
    const name = clean(material.name);
    if (!name) return;
    courses.push({
      key: `material:${material.id}`,
      name,
      attended: null,
      total: null,
      percentage: null,
      material: materialOf(material),
      ...attendanceStats({ attended: null, total: null, percentage: null })
    });
  });

  return courses.sort(compareCourses);
}

export function compareCourses(a, b) {
  const rank = (LEVEL_RANK[a.level] == null ? 9 : LEVEL_RANK[a.level]) -
    (LEVEL_RANK[b.level] == null ? 9 : LEVEL_RANK[b.level]);
  if (rank !== 0) return rank;

  if (a.level === "below") {
    if (a.truePercent !== b.truePercent) return a.truePercent - b.truePercent;
  } else if (a.level === "edge" || a.level === "thin" || a.level === "safe") {
    if (a.spare !== b.spare) return a.spare - b.spare;
    if (a.truePercent !== b.truePercent) return a.truePercent - b.truePercent;
  }

  return a.name.localeCompare(b.name, "en", { sensitivity: "base" });
}

export function summarizeCourses(courses) {
  const counts = { below: 0, edge: 0, thin: 0, safe: 0, na: 0 };
  courses.forEach((course) => {
    if (counts[course.level] != null) counts[course.level] += 1;
  });
  counts.total = courses.length;
  counts.reported = counts.below + counts.edge + counts.thin + counts.safe;
  counts.attention = counts.below + counts.edge;
  return counts;
}

export function headlineFor(summary) {
  if (summary.total === 0) return "No courses this semester.";
  if (summary.reported === 0) return "Attendance isn't published yet.";

  if (summary.below > 0) {
    return summary.attention === 1
      ? "One course needs attention."
      : `${summary.attention} courses need attention.`;
  }
  if (summary.edge > 0) {
    return summary.edge === 1 ? "One course has no margin." : `${summary.edge} courses have no margin.`;
  }
  if (summary.thin > 0) {
    return summary.thin === 1
      ? "One course has a thin margin."
      : `${summary.thin} courses have thin margins.`;
  }
  return summary.reported === 1
    ? "Your reported course is on track."
    : `All ${summary.reported} reported courses are on track.`;
}

export function ledeFor(summary, courses) {
  if (summary.total === 0) return "Courses will appear here once you're enrolled in a semester.";
  if (summary.reported === 0) {
    return "PESU hasn't reported attendance for this semester yet. Course links are still available below.";
  }

  const reported = courses.filter((course) => course.level !== "na");
  const closest = reported[0];
  let text = "";

  if (summary.below > 0 && closest) {
    text = `${closest.name} is the furthest from the line. ${marginCopy(closest)}`;
  } else if (summary.edge > 0 && closest) {
    text = `${closest.name} clears ${ATTENDANCE_THRESHOLD}% today, but one more absence drops it to ${formatPercent(closest.nextPercent)}%.`;
  } else if (summary.thin > 0 && closest) {
    text = `${closest.name} can take ${plural(closest.spare, "more absence", "more absences")} before dropping below ${ATTENDANCE_THRESHOLD}%.`;
  } else if (closest) {
    text = `${closest.name} has the thinnest margin: ${plural(closest.spare, "absence", "absences")} to spare.`;
  }

  if (summary.na > 0) {
    text += ` ${plural(summary.na, "course has", "courses have")} no attendance data yet.`;
  }

  return text;
}
