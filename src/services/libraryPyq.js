import JSZip from "jszip";
import * as cheerio from "cheerio";
import { load, save } from "../utils/storage.js";
import { courseCodeFromTitle } from "../helpers/libraryCourseCodes.js";
import { LIBRARY_PUBLIC_ORIGIN } from "../helpers/libraryFileIndex.js";
import {
  readCachedSearch,
  serializeLibraryRequest,
  singleFlight,
  withFileSlot,
  writeCachedSearch
} from "./libraryRequestCache.js";
import { attachPublicFileUrls, invalidatePublicFile, resolvePublicFileUrl } from "./libraryPublicFiles.js";

const LIBRARY_BASE_URL = LIBRARY_PUBLIC_ORIGIN;
const SEARCH_URL = `${LIBRARY_BASE_URL}/Search.aspx`;
const LIBRARY_GRID_EVENT_TARGET = "GridView1";
const SEARCH_TOKENS_KEY = "librarySearchTokens";
const PYQ_CATEGORY = "Digital Library";
const EAGER_RESULT_LIMIT = 40;
const EAGER_PAGE_LIMIT = 4;
const PDF_CACHE_TTL_MS = 15 * 60 * 1000;

const libraryRequestCounts = {};

async function trackedLibraryFetch(requestType, url, options) {
  libraryRequestCounts[requestType] = (libraryRequestCounts[requestType] || 0) + 1;
  const startedAt = Date.now();

  try {
    const response = await fetch(url, options);
    if (process.env.NODE_ENV !== "production") {
      console.debug("[PESU-MAX library request]", {
        requestType,
        count: libraryRequestCounts[requestType],
        status: response.status,
        durationMs: Date.now() - startedAt
      });
    }
    return response;
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.debug("[PESU-MAX library request failed]", {
        requestType,
        count: libraryRequestCounts[requestType],
        durationMs: Date.now() - startedAt
      });
    }
    throw error;
  }
}

function normalizeText(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(value) {
  if (!value) {
    return "";
  }

  return value
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function extractRecordId(rawId) {
  const match = normalizeText(rawId).match(/DL\s*\d+/i);
  return match ? match[0].replace(/\s+/g, "").toUpperCase() : normalizeText(rawId);
}

function sanitizeFilename(name) {
  return normalizeText(name)
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 120);
}

function toAbsoluteLibraryUrl(pathOrUrl) {
  if (!pathOrUrl) {
    return "";
  }

  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
    return pathOrUrl;
  }

  return `${LIBRARY_BASE_URL}/${pathOrUrl.replace(/^\/+/, "")}`;
}

function extractHiddenField(html, fieldName) {
  if (!html) {
    return "";
  }

  const patterns = [
    new RegExp(`name=["']${fieldName}["'][^>]*value=["']([^"']*)["']`, "i"),
    new RegExp(`id=["']${fieldName}["'][^>]*value=["']([^"']*)["']`, "i"),
    new RegExp(`value=["']([^"']*)["'][^>]*name=["']${fieldName}["']`, "i")
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return decodeHtmlEntities(match[1]);
    }
  }

  return "";
}

function extractDeltaHiddenField(payload, fieldName) {
  if (!payload) {
    return "";
  }

  const pattern = new RegExp(`\\|hiddenField\\|${fieldName}\\|([^|]*)\\|`, "i");
  const match = payload.match(pattern);
  return match?.[1] ? decodeHtmlEntities(match[1]) : "";
}

function extractAspNetFields(html) {
  return {
    viewState: extractHiddenField(html, "__VIEWSTATE"),
    eventValidation: extractHiddenField(html, "__EVENTVALIDATION"),
    viewStateGenerator: extractHiddenField(html, "__VIEWSTATEGENERATOR")
  };
}

function extractAspNetFieldsFromDelta(payload) {
  return {
    viewState: extractDeltaHiddenField(payload, "__VIEWSTATE"),
    eventValidation: extractDeltaHiddenField(payload, "__EVENTVALIDATION"),
    viewStateGenerator: extractDeltaHiddenField(payload, "__VIEWSTATEGENERATOR")
  };
}

function inferSemesterFromCode(code) {
  if (!code) {
    return null;
  }

  const numberMatch = code.match(/(\d{3})/);
  if (!numberMatch) {
    return null;
  }

  const number = numberMatch[1];
  const group = parseInt(number[0], 10);
  if (Number.isNaN(group)) {
    return null;
  }

  const suffix = code.split(number)[1] || "";
  const sectionMatch = suffix.match(/[A-Z]/);
  if (!sectionMatch) {
    return null;
  }

  const baseSemester = (group - 1) * 2 + 1;
  return sectionMatch[0] === "A" ? baseSemester : baseSemester + 1;
}

function toLibraryCodeQuery(subjectCode) {
  const code = normalizeText(subjectCode).toUpperCase();
  const codeWithoutBatch = code.replace(/^[A-Z]{2}\d{2}(?=[A-Z])/, "");
  return codeWithoutBatch.length >= 4 ? codeWithoutBatch : code;
}

function hasFormTokens(tokens) {
  return Boolean(tokens?.viewState && tokens?.eventValidation);
}

async function loadFormTokens(storageKey) {
  const tokens = await load(storageKey).catch(() => null);
  return hasFormTokens(tokens) ? tokens : null;
}

function fetchFormTokens(storageKey, url, requestType) {
  return singleFlight(`tokens:${storageKey}`, async () => {
    const response = await trackedLibraryFetch(requestType, url, {
      method: "GET",
      credentials: "omit"
    });
    const html = await response.text();
    if (!response.ok) throw new Error(`Library unavailable (HTTP ${response.status})`);

    const tokens = extractAspNetFields(html);
    if (!hasFormTokens(tokens)) {
      throw new Error("Unable to read library form tokens");
    }

    await save(storageKey, tokens).catch(() => {});
    return tokens;
  });
}

async function getSearchTokens({ refresh = false } = {}) {
  const cached = refresh ? null : await loadFormTokens(SEARCH_TOKENS_KEY);
  return cached || fetchFormTokens(SEARCH_TOKENS_KEY, SEARCH_URL, "search-page");
}

function classifySearchResponse(response, responseText) {
  if (/^\d+\|error\|/.test(responseText)
    || /validation of viewstate|invalid postback|invalid viewstate/i.test(responseText)) {
    return "stale";
  }

  if (response.status === 401 || response.status === 403
    || /\|pageredirect\|[^|]*\|?[^|]*mypage\.aspx/i.test(responseText)) {
    throw new Error("The library refused an anonymous search. Try again later.");
  }

  if (!response.ok) {
    throw new Error(`Library search failed (HTTP ${response.status})`);
  }

  if (!/GridView1|id=["']Label2["']|\bLabel2\|/i.test(responseText)) {
    throw new Error("Unexpected library search response. Please refresh the search.");
  }

  return "ok";
}

async function postLibrarySearch(formData, requestType) {
  const response = await trackedLibraryFetch(requestType, SEARCH_URL, {
    method: "POST",
    credentials: "omit",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      "X-MicrosoftAjax": "Delta=true"
    },
    body: formData.toString()
  });

  const responseText = await response.text();
  return { status: classifySearchResponse(response, responseText), responseText };
}

function sendSearchPostback(formData, requestType) {
  return postLibrarySearch(formData, requestType);
}

const pdfCache = new Map();
let pdfCacheBytes = 0;
const PDF_CACHE_LIMIT = 20 * 1024 * 1024;

async function fetchLibraryFile(absoluteUrl) {
  for (const [entryKey, entry] of pdfCache) {
    if (Date.now() - entry.savedAt >= PDF_CACHE_TTL_MS) {
      pdfCacheBytes -= entry.buffer.byteLength;
      pdfCache.delete(entryKey);
    }
  }

  const cached = pdfCache.get(absoluteUrl);
  if (cached) {
    return cached.buffer;
  }

  return singleFlight(`pdf:${absoluteUrl}`, () => withFileSlot(async () => {
    const response = await trackedLibraryFetch("pdf", absoluteUrl, {
      method: "GET",
      credentials: "omit"
    });
    if (!response.ok) throw new Error(`Unable to download file (HTTP ${response.status})`);

    const buffer = await response.arrayBuffer();
    if (!new TextDecoder().decode(buffer.slice(0, 5)).startsWith("%PDF-")) {
      throw new Error("Library returned an invalid PDF.");
    }

    if (buffer.byteLength <= PDF_CACHE_LIMIT) {
      while (pdfCache.size >= 10 || pdfCacheBytes + buffer.byteLength > PDF_CACHE_LIMIT) {
        const oldestKey = pdfCache.keys().next().value;
        pdfCacheBytes -= pdfCache.get(oldestKey).buffer.byteLength;
        pdfCache.delete(oldestKey);
      }
      pdfCache.set(absoluteUrl, { buffer, savedAt: Date.now() });
      pdfCacheBytes += buffer.byteLength;
    }
    return buffer;
  }));
}

function parseResultRow($, rowElement, index) {
  const row = $(rowElement);

  const title = normalizeText(
    row
      .find("span")
      .filter((_, el) => {
        const style = ($(el).attr("style") || "").toLowerCase();
        return style.includes("font-weight") && style.includes("bold");
      })
      .first()
      .text()
  );

  if (!title) {
    return null;
  }

  const downloadAnchor = row.find("a[onclick*='fnDownload']").first();
  const onclick = decodeHtmlEntities(downloadAnchor.attr("onclick") || "");
  const downloadMatch = onclick.match(/fnDownload\('([^']+)'\)/i) || onclick.match(/fnDownload\("([^"]+)"\)/i);
  const downloadPath = downloadMatch?.[1] || "";

  const yearLabel = row
    .find("span")
    .filter((_, el) => normalizeText($(el).text()).startsWith("Year,Ed:"))
    .first();
  const yearEdition = normalizeText(yearLabel.next("span").first().text());
  const year = Number((yearEdition.match(/\b(?:19|20)\d{2}\b/) || [])[0]) || null;

  const idLabel = row
    .find("span")
    .filter((_, el) => normalizeText($(el).text()).startsWith("ID:"))
    .first();
  // The cell reads "DL16049 ( Digital Library )".
  const recordId = extractRecordId(normalizeText(idLabel.next("span").first().text()));

  const callNoLabel = row
    .find("span")
    .filter((_, el) => normalizeText($(el).text()).startsWith("Call_No:"))
    .first();
  const callNo = normalizeText(callNoLabel.next("span").first().text());

  const statusContainerText = normalizeText(
    row
      .find("span")
      .filter((_, el) => normalizeText($(el).text()).startsWith("Status:"))
      .first()
      .parent()
      .text()
  );
  const statusMatch = statusContainerText.match(/Status:\s*([A-Za-z]+)/i);
  const status = statusMatch?.[1] || "Unknown";

  const courseCode = courseCodeFromTitle(title);
  const stableId = downloadPath || recordId || `${title}-${yearEdition}-${callNo}-${index}`;

  return {
    id: stableId,
    title,
    courseCode,
    yearEdition,
    year,
    recordId,
    callNo,
    status,
    downloadPath,
    downloadUrl: toAbsoluteLibraryUrl(downloadPath)
  };
}

function parseSearchResults(payload, query) {
  const $ = cheerio.load(payload || "");
  const parsedResults = [];

  $("#GridView1 tr").each((index, row) => {
    const parsedRow = parseResultRow($, row, index);
    if (parsedRow) {
      parsedResults.push(parsedRow);
    }
  });

  const labelTotal = parseInt(normalizeText($("#Label2").first().text()), 10);
  const regexTotalMatch = payload.match(/Total Search Results:\s*<span[^>]*>\s*(\d+)\s*<\/span>/i);
  const deltaLabelMatch = payload.match(/\bLabel2\|\s*(\d+)\b/i);
  const genericLabelMatch = payload.match(/id=["']Label2["'][^>]*>\s*(\d+)\s*</i);
  const regexTotal = regexTotalMatch ? parseInt(regexTotalMatch[1], 10) : NaN;
  const deltaTotal = deltaLabelMatch ? parseInt(deltaLabelMatch[1], 10) : NaN;
  const genericLabelTotal = genericLabelMatch ? parseInt(genericLabelMatch[1], 10) : NaN;
  const hasNextPage = /Page\$Next/i.test(payload);

  return {
    query,
    totalResults: Number.isFinite(labelTotal)
      ? labelTotal
      : (Number.isFinite(regexTotal)
          ? regexTotal
          : (Number.isFinite(deltaTotal)
              ? deltaTotal
              : (Number.isFinite(genericLabelTotal) ? genericLabelTotal : parsedResults.length))),
    results: parsedResults,
    hasNextPage
  };
}

function buildSearchFields({ query, year }) {
  return {
    txtMemberid: "",
    txtPassword: "",
    txtTitle: query,
    txtAuthor: "",
    txtYear: year || "",
    txtSubject: "",
    txtCallno: "",
    txtPublisher: "",
    cmbCategory: PYQ_CATEGORY,
    txtLocation: "",
    txtEdition: "",
    txtAccessNo: ""
  };
}

function buildSearchPayload({ query, year, viewState, eventValidation, viewStateGenerator }) {
  return new URLSearchParams({
    ToolkitScriptManager1: "UpdatePanel1|cmdSearch",
    __EVENTTARGET: "",
    __EVENTARGUMENT: "",
    __VIEWSTATE: viewState,
    __VIEWSTATEGENERATOR: viewStateGenerator,
    __VIEWSTATEENCRYPTED: "",
    __EVENTVALIDATION: eventValidation,
    ...buildSearchFields({ query, year }),
    __ASYNCPOST: "true",
    cmdSearch: "Search"
  });
}

function buildPaginationPayload({ query, year, viewState, eventValidation, viewStateGenerator }) {
  return new URLSearchParams({
    ToolkitScriptManager1: `UpdatePanel1|${LIBRARY_GRID_EVENT_TARGET}`,
    ...buildSearchFields({ query, year }),
    __EVENTTARGET: LIBRARY_GRID_EVENT_TARGET,
    __EVENTARGUMENT: "Page$Next",
    __VIEWSTATE: viewState,
    __VIEWSTATEGENERATOR: viewStateGenerator,
    __VIEWSTATEENCRYPTED: "",
    __EVENTVALIDATION: eventValidation,
    __ASYNCPOST: "true"
  });
}

async function fetchFirstSearchPage({ query, year }) {
  const tokens = await getSearchTokens();
  const result = await sendSearchPostback(
    buildSearchPayload({ query, year, ...tokens }),
    "search-submit"
  );
  if (result.status !== "stale") {
    return result.responseText;
  }

  const freshTokens = await getSearchTokens({ refresh: true });
  const retry = await sendSearchPostback(
    buildSearchPayload({ query, year, ...freshTokens }),
    "search-retry"
  );
  if (retry.status === "stale") {
    throw new Error("Library search failed. Please try again.");
  }
  return retry.responseText;
}

async function fetchNextSearchPage({ query, year, cursor }) {
  const result = await sendSearchPostback(
    buildPaginationPayload({ query, year, ...cursor }),
    "pagination-submit"
  );
  if (result.status === "stale") {
    throw new Error("These search results have expired. Please search again.");
  }
  return result.responseText;
}

function readSearchPage(responseText, query) {
  const parsed = parseSearchResults(responseText, query);
  const fields = extractAspNetFieldsFromDelta(responseText);
  const cursor = parsed.hasNextPage && parsed.results.length > 0 && hasFormTokens(fields)
    ? fields
    : null;

  return {
    totalResults: parsed.totalResults,
    results: parsed.results,
    nextCursor: cursor
  };
}

function appendSearchPage(entry, page) {
  const seenIds = new Set(entry.results.map((item) => item.id));
  const freshResults = page.results.filter((item) => !seenIds.has(item.id));
  const results = [...entry.results, ...freshResults];
  const complete = !page.nextCursor || freshResults.length === 0;

  return {
    ...entry,
    totalResults: Math.max(page.totalResults || 0, results.length),
    results,
    complete,
    nextCursor: complete ? null : page.nextCursor
  };
}

function sortByNewestYear(results) {
  return [...results].sort((first, second) => (second.year || 0) - (first.year || 0));
}

// One result page is one upload batch, so the salt is resolved once for it.
async function readSearchPageWithFiles(responseText, query) {
  const page = readSearchPage(responseText, query);
  if (page.results.length === 0) {
    return page;
  }

  const courseCode = page.results
    .map((item) => item.courseCode)
    .find((code) => Boolean(code)) || "";

  return { ...page, results: await attachPublicFileUrls(page.results, courseCode, query) };
}

async function performLibrarySearch({ query, year }) {
  const firstPage = await readSearchPageWithFiles(await fetchFirstSearchPage({ query, year }), query);
  let entry = appendSearchPage(
    { query, year, totalResults: 0, results: [], complete: false, nextCursor: null },
    firstPage
  );

  if (entry.totalResults <= EAGER_RESULT_LIMIT) {
    for (let pageCount = 1; pageCount < EAGER_PAGE_LIMIT && !entry.complete; pageCount += 1) {
      const page = await readSearchPageWithFiles(
        await fetchNextSearchPage({ query, year, cursor: entry.nextCursor }),
        query
      );
      entry = appendSearchPage(entry, page);
    }
  }

  return entry.complete ? { ...entry, results: sortByNewestYear(entry.results) } : entry;
}

function searchCacheKey(query, year) {
  return JSON.stringify([query.toLowerCase(), year]);
}

function arrayBufferToBase64(arrayBuffer) {
  let binary = "";
  const bytes = new Uint8Array(arrayBuffer);
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function ensurePdfExtension(name) {
  return name.toLowerCase().endsWith(".pdf") ? name : `${name}.pdf`;
}

function buildZipFileName(query) {
  const safeQuery = sanitizeFilename(query || "PYQs") || "PYQs";
  return `PESU_PYQs_${safeQuery}.zip`;
}

function triggerBrowserDownload(url, filename) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      {
        url,
        filename,
        saveAs: false
      },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve(downloadId);
      }
    );
  });
}

export async function getPyqCourseCatalog() {
  const [pesuData, semestersData] = await Promise.all([
    load("pesuData"),
    load("semestersData")
  ]);

  const rawSubjects = Object.values(pesuData?.subjects || {});
  const uniqueCourses = new Map();

  for (const subject of rawSubjects) {
    const subjectCode = normalizeText(subject.subjectCode);
    const subjectName = normalizeText(subject.subjectName);
    const semester = subject.semester ?? inferSemesterFromCode(subjectCode);

    if (!subjectCode || !subjectName || !semester) {
      continue;
    }

    const dedupeKey = `${semester}-${subjectCode}`;
    if (!uniqueCourses.has(dedupeKey)) {
      uniqueCourses.set(dedupeKey, {
        id: dedupeKey,
        subjectId: subject.id,
        subjectCode,
        subjectName,
        searchCode: toLibraryCodeQuery(subjectCode),
        semester,
        semesterLabel: `Semester ${semester}`
      });
    }
  }

  const courses = Array.from(uniqueCourses.values()).sort((first, second) => {
    if (first.semester !== second.semester) {
      return first.semester - second.semester;
    }

    return first.subjectCode.localeCompare(second.subjectCode);
  });

  const semesterSet = new Set(courses.map((course) => course.semester));
  const fallbackSemesters = Array.from(semesterSet)
    .sort((first, second) => first - second)
    .map((number) => ({ value: String(number), label: `Semester ${number}`, number }));

  const semesters = (semestersData || [])
    .map((semester) => ({
      value: String(semester.number),
      label: `Semester ${semester.number}`,
      number: semester.number
    }))
    .filter((semester) => semesterSet.has(semester.number));

  return {
    semesters: semesters.length > 0 ? semesters : fallbackSemesters,
    courses
  };
}

export async function searchLibraryPyqs({ query, year }) {
  const cleanQuery = normalizeText(query);
  const cleanYear = normalizeText(year);
  if (!cleanQuery) {
    throw new Error("Search query is required");
  }

  const cacheKey = searchCacheKey(cleanQuery, cleanYear);
  const cached = await readCachedSearch(cacheKey);
  if (cached) {
    return cached;
  }

  return singleFlight(`search:${cacheKey}`, () => serializeLibraryRequest(async () => {
    const entry = await performLibrarySearch({ query: cleanQuery, year: cleanYear });
    await writeCachedSearch(cacheKey, entry);
    return entry;
  }));
}

export async function loadMoreLibraryPyqs({ query, year, cursor }) {
  const cleanQuery = normalizeText(query);
  const cleanYear = normalizeText(year);
  if (!cleanQuery) {
    throw new Error("Search query is required");
  }

  if (!hasFormTokens(cursor)) {
    throw new Error("No next page is available for this search");
  }

  const cacheKey = searchCacheKey(cleanQuery, cleanYear);
  return singleFlight(`page:${cacheKey}:${cursor.viewState}`, () => serializeLibraryRequest(async () => {
    const page = await readSearchPageWithFiles(
      await fetchNextSearchPage({ query: cleanQuery, year: cleanYear, cursor }),
      cleanQuery
    );

    const cached = await readCachedSearch(cacheKey);
    if (cached?.nextCursor?.viewState === cursor.viewState) {
      await writeCachedSearch(cacheKey, appendSearchPage(cached, page));
    }

    return page;
  }));
}

// Tries the predicted URL first, then falls back to the full candidate plan.
async function resolveVerifiedFileUrl({ recordId, courseCode, downloadPath }) {
  const predicted = toAbsoluteLibraryUrl(downloadPath);
  const candidates = predicted ? [predicted] : [];

  for (const candidate of [...candidates, null]) {
    const url = candidate
      || await resolvePublicFileUrl({ recordId, courseCode });

    if (!url) {
      continue;
    }

    try {
      return { url, buffer: await fetchLibraryFile(url) };
    } catch (error) {
      await invalidatePublicFile(recordId);
    }
  }

  throw new Error("This paper is not available in the library file server");
}

export async function downloadLibraryPyq({ recordId, courseCode, downloadPath, title }) {
  if (!recordId && !downloadPath) {
    throw new Error("Invalid download URL");
  }

  const { url, buffer } = await resolveVerifiedFileUrl({ recordId, courseCode, downloadPath });
  const dataUrl = `data:application/pdf;base64,${arrayBufferToBase64(buffer)}`;

  const fallbackName = `PYQ_${Date.now()}`;
  const safeName = sanitizeFilename(title || fallbackName) || fallbackName;
  const fileName = ensurePdfExtension(safeName);
  const downloadId = await triggerBrowserDownload(dataUrl, `PESU_PYQs/${fileName}`);

  return {
    downloadId,
    fileName,
    sourceUrl: url
  };
}

export async function downloadLibraryPyqsZip({ items, query }) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("No PYQs selected for ZIP download");
  }

  const zip = new JSZip();
  const failedItems = [];
  let successful = 0;

  const uniqueItems = Array.from(
    new Map(items.map((item) => [item.downloadPath, item])).values()
  );
  const queue = uniqueItems.map((item, index) => ({ item, index }));
  const workerCount = Math.min(3, queue.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (queue.length > 0) {
        const next = queue.shift();
        if (!next) {
          return;
        }

        const { item, index } = next;
        try {
          const { buffer } = await resolveVerifiedFileUrl({
            recordId: item.recordId,
            courseCode: item.courseCode,
            downloadPath: item.downloadPath
          });
          const fallbackName = `PYQ_${index + 1}`;
          const safeName = sanitizeFilename(item.title || fallbackName) || fallbackName;
          const fileName = `${String(index + 1).padStart(2, "0")}_${ensurePdfExtension(safeName)}`;

          zip.file(fileName, buffer, {
            binary: true,
            compression: "STORE"
          });
          successful += 1;
        } catch (error) {
          failedItems.push({
            id: item.id,
            title: item.title || "Unknown PYQ",
            error: error.message || "Unknown error"
          });
        }
      }
    })
  );

  if (successful === 0) {
    throw new Error("Unable to download selected PYQs");
  }

  const zipBlob = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 4 }
  });
  const zipBuffer = await zipBlob.arrayBuffer();
  const zipBase64 = arrayBufferToBase64(zipBuffer);
  const zipDataUrl = `data:application/zip;base64,${zipBase64}`;
  const fileName = buildZipFileName(query);
  const downloadId = await triggerBrowserDownload(zipDataUrl, `PESU_PYQs/${fileName}`);

  return {
    downloadId,
    fileName,
    stats: {
      total: uniqueItems.length,
      successful,
      failed: failedItems.length,
      failedItems
    }
  };
}
