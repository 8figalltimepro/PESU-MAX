// Harvests file names with a maintenance credential and feeds
// scripts/buildLibrarySaltTable.mjs. The credential is build-time only and never
// shipped. Queries are `callno:`, `title:` or `year:`; the union is written out.
//   LIBRARY_MEMBER_ID=... LIBRARY_PASSWORD=... \
//     node scripts/harvestLibraryFiles.mjs "callno:QP" "title:UE22CS"
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ORIGIN = "http://14.143.33.149";
const SEARCH_URL = `${ORIGIN}/Search.aspx`;
const LOGIN_URL = `${ORIGIN}/MyPage.aspx`;
const CATEGORY = "Digital Library";
const PAGE_DELAY_MS = 120;
const MAX_PAGES = 200;
const DEFAULT_OUTPUT = resolve(process.argv[2]?.startsWith("--out=")
  ? process.argv[2].slice(6)
  : "./library-harvest.json");

const MEMBER_ID = process.env.LIBRARY_MEMBER_ID || "";
const PASSWORD = process.env.LIBRARY_PASSWORD || "";

// Search.aspx answers `0|error|500||` without a browser User-Agent.
const BROWSER_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"
  + " AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const BROWSER_HEADERS = {
  "User-Agent": BROWSER_USER_AGENT,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9"
};

export function hidden(html, name) {
  for (const pattern of [
    new RegExp(`name="${name}"[^>]*value="([^"]*)"`, "i"),
    new RegExp(`id="${name}"[^>]*value="([^"]*)"`, "i"),
    new RegExp(`value="([^"]*)"[^>]*name="${name}"`, "i")
  ]) {
    const match = html.match(pattern);
    if (match) return match[1].replace(/&amp;/g, "&").replace(/&#39;/g, "'");
  }
  return "";
}

export function tokensFromHtml(html) {
  return {
    __VIEWSTATE: hidden(html, "__VIEWSTATE"),
    __VIEWSTATEGENERATOR: hidden(html, "__VIEWSTATEGENERATOR"),
    __EVENTVALIDATION: hidden(html, "__EVENTVALIDATION")
  };
}

export function deltaField(payload, name) {
  const match = payload.match(new RegExp(`\\|hiddenField\\|${name}\\|([^|]*)\\|`));
  return match ? match[1].replace(/&amp;/g, "&") : "";
}

export function tokensFromDelta(payload) {
  return {
    __VIEWSTATE: deltaField(payload, "__VIEWSTATE"),
    __VIEWSTATEGENERATOR: deltaField(payload, "__VIEWSTATEGENERATOR"),
    __EVENTVALIDATION: deltaField(payload, "__EVENTVALIDATION")
  };
}

export function searchFields(overrides) {
  return {
    txtMemberid: "",
    txtPassword: "",
    txtTitle: "",
    txtAuthor: "",
    txtYear: "",
    txtSubject: "",
    txtCallno: "",
    txtPublisher: "",
    cmbCategory: CATEGORY,
    txtLocation: "",
    txtEdition: "",
    txtAccessNo: "",
    ...overrides
  };
}

export function parseRows(text) {
  const rows = {};
  for (const block of text.split('<div class="row" style="padding: 5px;').slice(1)) {
    const id = block.match(/<span>(DL\d+)&nbsp;/);
    if (!id) continue;
    const dl = block.match(/fnDownload\(&#39;([^&]+)&#39;\)/);
    const title = block.match(/font-weight: bold;">([\s\S]*?)<\/span>/);
    rows[id[1]] = {
      downloadPath: dl ? dl[1].replace(/&#39;/g, "'") : "",
      title: title ? title[1].replace(/&amp;/g, "&").replace(/&#39;/g, "'").trim() : ""
    };
  }
  return rows;
}

export function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

export async function post(session, tokens, extra, overrides) {
  const body = new URLSearchParams({
    __EVENTTARGET: "",
    __EVENTARGUMENT: "",
    __VIEWSTATE: tokens.__VIEWSTATE,
    __VIEWSTATEGENERATOR: tokens.__VIEWSTATEGENERATOR,
    __VIEWSTATEENCRYPTED: "",
    __EVENTVALIDATION: tokens.__EVENTVALIDATION,
    ...searchFields(overrides),
    __ASYNCPOST: "true",
    ...extra
  });

  const response = await session.fetch(SEARCH_URL, {
    method: "POST",
    headers: {
      ...BROWSER_HEADERS,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      "X-MicrosoftAjax": "Delta=true",
      Referer: SEARCH_URL
    },
    body: body.toString()
  });

  return response.text();
}


export function createSession() {
  const jar = new Map();

  const cookieHeader = () => [...jar].map(([name, value]) => `${name}=${value}`).join("; ");

  const absorb = (response) => {
    for (const raw of response.headers.getSetCookie?.() || []) {
      const [pair] = raw.split(";");
      const index = pair.indexOf("=");
      if (index > 0) jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
    }
  };

  return {
    async fetch(url, options = {}) {
      const headers = new Headers({ ...BROWSER_HEADERS, ...(options.headers || {}) });
      if (jar.size > 0) headers.set("Cookie", cookieHeader());
      // The login cookie arrives on the 302, which auto-following would discard.
      const response = await fetch(url, {
        ...options,
        headers,
        redirect: options.redirect || "follow"
      });
      absorb(response);
      return response;
    },
    get(name) {
      return jar.get(name);
    }
  };
}

export async function login(session) {
  if (!MEMBER_ID || !PASSWORD) {
    throw new Error("set LIBRARY_MEMBER_ID and LIBRARY_PASSWORD to harvest");
  }

  const page = await session.fetch(LOGIN_URL);
  const tokens = tokensFromHtml(await page.text());
  const body = new URLSearchParams({
    __VIEWSTATE: tokens.__VIEWSTATE,
    __VIEWSTATEGENERATOR: tokens.__VIEWSTATEGENERATOR,
    __EVENTVALIDATION: tokens.__EVENTVALIDATION,
    txtMemberid: MEMBER_ID,
    txtPassword: PASSWORD,
    signin: "Sign In"
  });

  await session.fetch(LOGIN_URL, {
    method: "POST",
    headers: {
      ...BROWSER_HEADERS,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: body.toString(),
    redirect: "manual"
  });

  return Boolean(session.get(".ASPXFORMSAUTH"));
}

export function parseQuery(spec) {
  const [kind, ...rest] = spec.split(":");
  const value = rest.join(":");
  if (kind === "callno") return { txtCallno: value };
  if (kind === "year") return { txtYear: value };
  if (kind === "title") return { txtTitle: value };
  throw new Error(`unknown query spec: ${spec}`);
}

export async function harvestQuery(session, spec, collected) {
  const overrides = parseQuery(spec);
  const page = await session.fetch(SEARCH_URL);
  let tokens = tokensFromHtml(await page.text());
  let text = await post(session, tokens, {
    ToolkitScriptManager1: "UpdatePanel1|cmdSearch",
    cmdSearch: "Search"
  }, overrides);

  for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex += 1) {
    Object.assign(collected, parseRows(text));

    if (!/Page\$Next/.test(text)) break;
    tokens = tokensFromDelta(text);
    if (!tokens.__VIEWSTATE) break;

    await sleep(PAGE_DELAY_MS);
    text = await post(session, tokens, {
      ToolkitScriptManager1: "UpdatePanel1|GridView1",
      __EVENTTARGET: "GridView1",
      __EVENTARGUMENT: "Page$Next"
    }, overrides);
  }

  const total = text.match(/id="Label2"[^>]*>(\d+)/);
  console.log(
    `[${spec}] rows so far=${Object.keys(collected).length}`
    + `${total ? ` (query total ${total[1]})` : ""} lastResponse=${text.length}B`
  );
}

// Also used by scripts/refreshLibraryIndex.mjs.
export async function harvestSpecs(specs) {
  const session = createSession();
  if (!await login(session)) {
    throw new Error("library login failed - the maintenance credential is stale or has expired");
  }

  const collected = {};
  for (const spec of specs) {
    await harvestQuery(session, spec, collected);
  }

  return Object.fromEntries(
    Object.entries(collected).filter(([, value]) => value.downloadPath)
  );
}

async function main() {
  const specs = process.argv.slice(2).filter((argument) => !argument.startsWith("--out="));
  if (specs.length === 0) {
    console.error("usage: LIBRARY_MEMBER_ID=... LIBRARY_PASSWORD=... \\");
    console.error("  node scripts/harvestLibraryFiles.mjs [--out=file.json] callno:QP title:UE22CS");
    process.exit(1);
  }

  const session = createSession();
  if (!await login(session)) {
    throw new Error("library login failed - the maintenance credential is stale or has expired");
  }

  const collected = {};
  for (const spec of specs) {
    await harvestQuery(session, spec, collected);
  }

  const withPath = await harvestSpecs(specs);
  writeFileSync(DEFAULT_OUTPUT, `${JSON.stringify(withPath, null, 1)}\n`);
  console.log(`wrote ${Object.keys(withPath).length} records to ${DEFAULT_OUTPUT}`);
  console.log(`next: node scripts/buildLibrarySaltTable.mjs ${DEFAULT_OUTPUT}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
