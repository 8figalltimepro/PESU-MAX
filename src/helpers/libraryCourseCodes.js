const COURSE_CODE_PATTERN = /\(\s*([A-Z]{2}\d{2}[A-Z]{2,4}\d{3}[A-Z0-9]*)\s*\)?/g;
const COURSE_CORE_PATTERN = /^[A-Z]{2}\d{2}([A-Z]{2,4}\d{3})/;
const COURSE_CORE_ANYWHERE_PATTERN = /([A-Z]{2,4}\d{3})/;
const DEPARTMENT_PATTERN = /^[A-Z]{2}\d{2}([A-Z]{2})/;

// The ID cell renders as "DL16049 ( Digital Library )", so tolerate a suffix.
export function recordNumber(recordId) {
  const value = String(recordId || "");
  const tagged = value.match(/DL\s*(\d+)/i);
  if (tagged) {
    return tagged[1];
  }

  const trailing = value.match(/(\d+)\D*$/);
  return trailing ? trailing[1] : "";
}

// Codes are inconsistently punctuated, so take the last candidate in the title.
export function courseCodeFromTitle(title) {
  const matches = [...String(title || "").matchAll(COURSE_CODE_PATTERN)];
  return matches.length > 0 ? matches[matches.length - 1][1] : "";
}

// UE23CS342AA1 and UE22CS342A both reduce to CS342.
export function courseCore(courseCode) {
  const value = String(courseCode || "");
  const match = value.match(COURSE_CORE_PATTERN) || value.match(COURSE_CORE_ANYWHERE_PATTERN);
  return match ? match[1] : "";
}

export function departmentFromCourseCode(courseCode) {
  const match = String(courseCode || "").match(DEPARTMENT_PATTERN);
  return match ? match[1] : "";
}
