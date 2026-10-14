import { load, save } from "../utils/storage.js";
import {
  buildFileUrlPlan,
  fileOverrideForRecord,
  orderedSaltCandidates,
  publicFileUrlForRecord,
  recordNumber
} from "../helpers/libraryFileIndex.js";
import { singleFlight } from "./libraryRequestCache.js";

const CACHE_KEY = "libraryPublicFileIndexV1";
const CACHE_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const MAX_FILE_ENTRIES = 2000;
const MAX_SUBJECT_ENTRIES = 800;
const NEGATIVE_TTL_MS = 60 * 60 * 1000;
const PROBE_CONCURRENCY = 8;
const SEARCH_SALT_BUDGET = 48;
const SALT_SAMPLE_ROWS = 2;
const PROBE_TIMEOUT_MS = 15000;
const MIN_DOCUMENT_BYTES = 512;
const DOCUMENT_CONTENT_TYPES = ["pdf", "octet-stream"];

let memoryCache = null;
let persistChain = Promise.resolve();

function emptyCache() {
  return { version: 1, files: {}, subjects: {}, misses: {} };
}

async function readCache() {
  if (!memoryCache) {
    memoryCache = await load(CACHE_KEY).catch(() => null) || emptyCache();
  }
  return memoryCache;
}

function bounded(entries, limit) {
  return Object.entries(entries)
    .sort((first, second) => (second[1]?.savedAt || 0) - (first[1]?.savedAt || 0))
    .slice(0, limit)
    .reduce((accumulator, [key, value]) => {
      accumulator[key] = value;
      return accumulator;
    }, {});
}

function persist(cache) {
  cache.files = bounded(cache.files, MAX_FILE_ENTRIES);
  cache.subjects = bounded(cache.subjects, MAX_SUBJECT_ENTRIES);
  persistChain = persistChain
    .then(() => save(CACHE_KEY, cache))
    .catch(() => {});
  return persistChain;
}

async function rememberSalt(courseCode, salt) {
  if (!courseCode || !salt) {
    return;
  }

  const cache = await readCache();
  const entry = cache.subjects[courseCode] || { salts: [] };
  if (!entry.salts.includes(salt)) {
    cache.subjects[courseCode] = {
      salts: [salt, ...entry.salts].slice(0, 8),
      savedAt: Date.now()
    };
    await persist(cache);
  }
}

async function rememberFile(recordId, url) {
  const number = recordNumber(recordId);
  if (!number || !url) {
    return;
  }

  const cache = await readCache();
  cache.files[number] = { url, savedAt: Date.now() };
  delete cache.misses[number];
  await persist(cache);
}

async function rememberMiss(recordId) {
  const number = recordNumber(recordId);
  if (!number) {
    return;
  }

  const cache = await readCache();
  cache.misses[number] = Date.now();
  delete cache.files[number];
  await persist(cache);
}

async function learnedSaltsForCourse(courseCode) {
  if (!courseCode) {
    return [];
  }

  const cache = await readCache();
  const entry = cache.subjects[courseCode];
  if (!entry || Date.now() - entry.savedAt > CACHE_TTL_MS) {
    return [];
  }

  return entry.salts || [];
}

// "miss" is a remembered failure, "unknown" has never been attempted.
async function cachedFileState(recordId) {
  const number = recordNumber(recordId);
  if (!number) {
    return { state: "miss" };
  }

  const cache = await readCache();
  const entry = cache.files[number];
  if (entry && Date.now() - entry.savedAt < CACHE_TTL_MS) {
    return { state: "hit", url: entry.url };
  }

  const missedAt = cache.misses[number];
  if (missedAt && Date.now() - missedAt < NEGATIVE_TTL_MS) {
    return { state: "miss" };
  }

  return { state: "unknown" };
}

function looksLikeDocument(response) {
  const type = (response.headers.get("Content-Type") || "").toLowerCase();
  if (!DOCUMENT_CONTENT_TYPES.some((candidate) => type.includes(candidate))) {
    return false;
  }

  if (response.status === 206) {
    const total = Number((response.headers.get("Content-Range") || "").split("/").pop());
    return Number.isFinite(total) && total > MIN_DOCUMENT_BYTES;
  }

  const length = Number(response.headers.get("Content-Length"));
  return Number.isFinite(length) && length > MIN_DOCUMENT_BYTES;
}

async function requestFile(url, method, extraHeaders = {}) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS) : null;

  try {
    return await fetch(url, {
      method,
      headers: extraHeaders,
      credentials: "omit",
      cache: "no-store",
      signal: controller ? controller.signal : undefined
    });
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

// HEAD is the cheap probe; a ranged GET settles it if the transport refuses HEAD.
async function probePublicFile(url) {
  try {
    const response = await requestFile(url, "HEAD");
    if (response.ok) {
      return looksLikeDocument(response);
    }
  } catch (error) {
    try {
      const response = await requestFile(url, "GET", { Range: "bytes=0-0" });
      return response.ok && looksLikeDocument(response);
    } catch (retryError) {
      return false;
    }
  }

  return false;
}

async function firstHit(urls) {
  const queue = [...urls];
  if (queue.length === 0) {
    return "";
  }

  let settled = false;

  async function worker() {
    while (!settled) {
      const next = queue.shift();
      if (!next) {
        return "";
      }

      if (await probePublicFile(next)) {
        settled = true;
        return next;
      }
    }

    return "";
  }

  const results = await Promise.all(
    Array.from({ length: Math.min(PROBE_CONCURRENCY, queue.length) }, worker)
  );

  return results.find(Boolean) || "";
}

export async function resolvePublicFileUrl({ recordId, courseCode = "", pinnedSalt = "" }) {
  if (!recordNumber(recordId)) {
    return "";
  }

  return singleFlight(`public-file:${recordId}`, async () => {
    const cached = await cachedFileState(recordId);
    if (cached.state === "hit") {
      return cached.url;
    }
    if (cached.state === "miss") {
      return "";
    }

    const override = fileOverrideForRecord(recordId);
    if (override && !await probePublicFile(override)) {
      await rememberMiss(recordId);
      return "";
    }

    const learnedSalts = await learnedSaltsForCourse(courseCode);
    const plan = buildFileUrlPlan({ recordId, courseCode, pinnedSalt, learnedSalts });
    const hit = override || await firstHit(plan.map((candidate) => candidate.url));

    if (!hit) {
      await rememberMiss(recordId);
      return "";
    }

    const matched = plan.find((candidate) => candidate.url === hit);
    await rememberFile(recordId, hit);
    await rememberSalt(courseCode, matched ? matched.salt : "");
    return hit;
  });
}

// One result page shares an upload batch, so one salt covers every row. Returns
// the salt (possibly "" for a pre-salt record) or null when nothing matched.
async function resolveSaltForRecords({ records, courseCode = "", courseHint = "", saltBudget = 0 }) {
  const numbers = records.map((record) => recordNumber(record.recordId)).filter(Boolean);
  if (numbers.length === 0) {
    return null;
  }

  const hint = courseCode || courseHint;
  const sample = numbers.slice(0, SALT_SAMPLE_ROWS);

  return singleFlight(`public-salt:${hint}:${numbers.join(",")}`, async () => {
    const learnedSalts = await learnedSaltsForCourse(hint);
    const salts = orderedSaltCandidates({ courseCode: hint, learnedSalts });
    const queue = saltBudget > 0 ? salts.slice(0, saltBudget) : salts;

    let settled = false;

    async function worker() {
      while (!settled) {
        const salt = queue.shift();
        if (salt === undefined) {
          return null;
        }

        for (const number of sample) {
          if (await probePublicFile(publicFileUrlForRecord(`DL${number}`, salt))) {
            settled = true;
            return salt;
          }
        }
      }

      return null;
    }

    const results = await Promise.all(
      Array.from({ length: Math.min(PROBE_CONCURRENCY, queue.length) }, worker)
    );
    const salt = results.find((result) => result !== null);
    if (salt === undefined) {
      return null;
    }

    await rememberSalt(hint, salt);
    return salt;
  });
}

function urlPath(url) {
  const marker = "digital/qp/";
  const index = url ? url.indexOf(marker) : -1;
  return index >= 0 ? url.slice(index) : url;
}

// Search resolves the page salt within a budget so an unknown course cannot stall
// the results. A row that still has no URL is resolved on download instead.
export async function attachPublicFileUrls(records, courseCode = "", courseHint = "") {
  const states = await Promise.all(records.map((record) => cachedFileState(record.recordId)));
  const pending = records.filter((record, index) => states[index].state === "unknown");

  const salt = pending.length > 0
    ? await resolveSaltForRecords({
        records: pending,
        courseCode,
        courseHint,
        saltBudget: SEARCH_SALT_BUDGET
      })
    : null;

  return records.map((record, index) => {
    let url = states[index].state === "hit" ? states[index].url : "";

    if (!url && states[index].state === "unknown" && salt !== null) {
      url = fileOverrideForRecord(record.recordId)
        || publicFileUrlForRecord(record.recordId, salt);
    }

    return { ...record, downloadPath: urlPath(url), downloadUrl: url };
  });
}

export async function invalidatePublicFile(recordId) {
  const number = recordNumber(recordId);
  if (!number) {
    return;
  }

  const cache = await readCache();
  delete cache.files[number];
  delete cache.misses[number];
  await persist(cache);
}
