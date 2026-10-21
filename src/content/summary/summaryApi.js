import {
  chooseSemester,
  readAttendance,
  readCourseList,
  readCoursePage,
  readSemesters
} from "./summaryData.js";

const PROFILE_PATH = "/Academy/s/studentProfilePESUAdmin";
const SEMESTERS_PATH = "/Academy/s/studentProfile/getStudentSemestersPESU";
const REQUEST_TIMEOUT_MS = 20000;
const pageCache = new Map();
const unitCache = new Map();

export class SummarySessionError extends Error {
  constructor() {
    super("Your PESU Academy session has expired.");
    this.name = "SummarySessionError";
  }
}

export class SummaryRequestError extends Error {
  constructor(message) {
    super(message);
    this.name = "SummaryRequestError";
  }
}

export const isSummarySessionError = (error) =>
  error instanceof SummarySessionError || Boolean(error && error.name === "SummarySessionError");

const withQuery = (params) => {
  if (!params) return "";
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value != null) search.set(key, String(value));
  });
  search.set("_", String(Date.now()));
  return `?${search.toString()}`;
};

const looksLikeLogin = (text) =>
  /id=["']j_scriptusername["']/i.test(text) ||
  /id=["']postloginform/i.test(text) ||
  /class=["'][^"']*login-form/i.test(text);

function readCsrfToken() {
  const meta = document.querySelector('meta[name="csrf-token"]');
  const input = document.querySelector('input[name="_csrf"]');
  return (meta && meta.getAttribute("content")) || (input && input.value) || "";
}

async function request(url, options = {}) {
  const {
    method = "GET",
    params = null,
    body = null,
    signal = null,
    headers = {}
  } = options;

  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", abort, { once: true });
  }
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${url}${withQuery(params)}`, {
      method,
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
      headers,
      body
    });
    const text = await response.text();

    if (looksLikeLogin(text)) throw new SummarySessionError();
    if (!response.ok) throw new SummaryRequestError(`PESU returned ${response.status}.`);
    return text;
  } catch (error) {
    if (error && error.name === "AbortError") {
      if (signal && signal.aborted) throw error;
      throw new SummaryRequestError("PESU took too long to respond.");
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", abort);
  }
}

export async function fetchSemesters(signal) {
  const text = await request(SEMESTERS_PATH, { signal });
  const semesters = readSemesters(text);
  if (!semesters.length) throw new SummaryRequestError("No semesters were returned.");
  return semesters;
}

export async function fetchAttendance(semesterId, signal) {
  const text = await request(PROFILE_PATH, {
    signal,
    params: {
      controllerMode: "6407",
      actionType: "8",
      batchClassId: semesterId,
      menuId: "660"
    }
  });
  return readAttendance(text);
}

export async function fetchCourseList(semesterId, signal) {
  const token = readCsrfToken();
  const body = new URLSearchParams({
    controllerMode: "6403",
    actionType: "38",
    id: String(semesterId),
    menuId: "653"
  });
  if (token) body.set("_csrf", token);

  const headers = {
    "Content-Type": "application/x-www-form-urlencoded",
    "X-Requested-With": "XMLHttpRequest"
  };
  if (token) headers["X-CSRF-TOKEN"] = token;

  const text = await request(PROFILE_PATH, {
    method: "POST",
    body: body.toString(),
    headers,
    signal
  });
  return readCourseList(text);
}

// Shared caches outlive the caller: a prefetch can serve a later jump even if its run ends.
function cacheEntry(cache, key, factory) {
  const existing = cache.get(key);
  if (existing) return existing.promise;

  const entry = { promise: null };
  entry.promise = factory()
    .then((value) => {
      entry.value = value;
      return value;
    })
    .catch((error) => {
      if (cache.get(key) === entry) cache.delete(key);
      throw error;
    });
  cache.set(key, entry);
  return entry.promise;
}

export function coursePageFromCache(courseId) {
  const entry = pageCache.get(String(courseId));
  return entry ? entry.value || null : null;
}

export function unitHtmlFromCache(courseId, unitId) {
  const entry = unitCache.get(`${courseId}:${unitId}`);
  return entry && entry.value !== undefined ? entry.value : null;
}

export async function fetchCoursePage(courseId, { force = false } = {}) {
  const key = String(courseId);
  if (force) pageCache.delete(key);

  const existing = pageCache.get(key);
  if (existing) return existing.promise;

  const entry = { value: null, promise: null };
  entry.promise = request(PROFILE_PATH, {
    params: {
      controllerMode: "6403",
      actionType: "42",
      id: key,
      menuId: "653"
    }
  })
    .then((html) => {
      const page = readCoursePage(html);
      if (!page.found) throw new SummaryRequestError("Course page was not available.");
      entry.value = { id: key, html, ...page };
      return entry.value;
    })
    .catch((error) => {
      if (pageCache.get(key) === entry) pageCache.delete(key);
      throw error;
    });

  pageCache.set(key, entry);
  return entry.promise;
}

export async function fetchUnitHtml(courseId, unitId, subType, { force = false } = {}) {
  const key = `${courseId}:${unitId}`;
  if (force) unitCache.delete(key);

  const html = await cacheEntry(unitCache, key, () =>
    request(PROFILE_PATH, {
      params: {
        controllerMode: "6403",
        actionType: "43",
        coursecontentid: unitId,
        menuId: "653",
        selectedData: courseId,
        subType: subType || "5"
      }
    })
  );

  if (/<title>\s*error\s*<\/title>/i.test(html)) {
    unitCache.delete(key);
    throw new SummaryRequestError("Unit materials were not available.");
  }
  return html;
}

function readStoredProfile() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get("userProfile", (result) => {
        if (chrome.runtime.lastError) resolve(null);
        else resolve(result.userProfile || null);
      });
    } catch (error) {
      resolve(null);
    }
  });
}

export async function loadSummary({ signal }) {
  const [semesters, profile] = await Promise.all([fetchSemesters(signal), readStoredProfile()]);
  const semester = chooseSemester(semesters, profile);

  const [attendance, courseList] = await Promise.allSettled([
    fetchAttendance(semester.value, signal),
    fetchCourseList(semester.value, signal)
  ]);

  if (attendance.status === "rejected") throw attendance.reason;
  if (courseList.status === "rejected" && isSummarySessionError(courseList.reason)) {
    throw courseList.reason;
  }

  const materials = courseList.status === "fulfilled" ? courseList.value : [];
  const warning =
    courseList.status === "rejected"
      ? "Course links couldn't be loaded. Attendance is still up to date."
      : "";

  return {
    semester,
    semesters,
    attendance: attendance.value,
    materials,
    warning,
    fetchedAt: Date.now()
  };
}
