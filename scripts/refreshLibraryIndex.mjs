// Pulls the newest subjects into the library mapping. Defaults to the last three
// scheme years; merges into a cached harvest so older records survive, rebuilds
// the salt table, then reports what changed and which schemes are unpublished.
//   LIBRARY_MEMBER_ID=... LIBRARY_PASSWORD=... \
//     node scripts/refreshLibraryIndex.mjs [--years=3] [--all] [--dry-run]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { harvestSpecs } from "./harvestLibraryFiles.mjs";
import { LIBRARY_SALT_TABLE } from "../src/helpers/librarySaltTable.js";
import { courseCodeFromTitle } from "../src/helpers/libraryCourseCodes.js";

const CACHE = resolve("./.library-harvest.json");
const TABLE = resolve("./src/helpers/librarySaltTable.js");

function parseArguments(argv) {
  const options = { years: 3, all: false, dryRun: false };
  for (const argument of argv) {
    if (argument === "--all") options.all = true;
    else if (argument === "--dry-run") options.dryRun = true;
    else if (argument.startsWith("--years=")) options.years = Number(argument.slice(8)) || 3;
    else if (argument.startsWith("--out=")) options.out = argument.slice(6);
  }
  return options;
}

// Scheme codes are the admission year, so the current intake plus the two before
// it cover the students who are still sitting exams.
function recentSchemes(years) {
  const currentYear = new Date().getFullYear();
  const schemes = [];
  for (let offset = 0; offset < years; offset += 1) {
    const suffix = String((currentYear - offset) % 100).padStart(2, "0");
    for (const prefix of ["UE", "UM", "UL"]) {
      schemes.push(`${prefix}${suffix}`);
    }
  }
  return schemes;
}

function readCache() {
  if (!existsSync(CACHE)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(CACHE, "utf8"));
  } catch (error) {
    console.warn(`could not read ${CACHE}, starting fresh: ${error.message}`);
    return {};
  }
}

function schemeOf(courseCode) {
  return String(courseCode || "").slice(0, 4);
}

function previousSubjects() {
  return new Set(Object.keys(LIBRARY_SALT_TABLE.subjects || {}));
}

function summarise(harvest, schemes) {
  const byScheme = new Map();
  for (const entry of Object.values(harvest)) {
    const code = courseCodeFromTitle(entry.title);
    const scheme = schemeOf(code);
    if (!byScheme.has(scheme)) {
      byScheme.set(scheme, new Set());
    }
    byScheme.get(scheme).add(code || "(unparsed title)");
  }

  return { byScheme, schemes };
}

function reportChanges(harvest, options) {
  const before = previousSubjects();
  const after = new Set();

  for (const entry of Object.values(harvest)) {
    const code = courseCodeFromTitle(entry.title);
    if (code) {
      after.add(code);
    }
  }

  const added = [...after].filter((code) => !before.has(code)).sort();
  const recent = added.filter((code) => options.schemes.includes(schemeOf(code)));

  console.log(`\nsubjects: ${before.size} -> ${after.size} (+${added.length})`);
  if (added.length > 0) {
    console.log(`  newest additions (${Math.min(added.length, 12)} shown):`);
    for (const code of added.slice(-12).reverse()) {
      console.log(`    ${code}`);
    }
  }

  console.log(`\nrecent schemes in scope: ${options.schemes.join(", ")}`);
  const recentSubjects = [...after].filter((code) => options.schemes.includes(schemeOf(code)));
  console.log(`  recent subjects covered: ${recentSubjects.length}`);
  console.log(`  of which newly added:    ${recent.length}`);

  // Unpublished is normal: the extension still resolves those papers by probing,
  // and the query stays in scope for when the library uploads them.
  const { byScheme } = summarise(harvest, options.schemes);
  const unpublished = options.schemes.filter((scheme) => {
    const codes = byScheme.get(scheme);
    return !codes || codes.size === 0;
  });
  if (unpublished.length > 0) {
    console.log(`\nno papers published yet for: ${unpublished.join(", ")}`);
    console.log("  (expected early in an intake - these queries stay in scope and");
    console.log("   will collect the papers as soon as the library uploads them)");
  }

  const gaps = [];
  for (const scheme of options.schemes) {
    const codes = byScheme.get(scheme);
    if (!codes || codes.size === 0) {
      continue;
    }
    const unmapped = [...codes].filter((code) => code !== "(unparsed title)" && !after.has(code));
    if (unmapped.length > 0) {
      gaps.push([scheme, unmapped]);
    }
  }

  if (gaps.length > 0) {
    console.log("\nrecent schemes with papers but no derived subject code:");
    for (const [scheme, codes] of gaps) {
      console.log(`  ${scheme}: ${codes.slice(0, 6).join(", ")}${codes.length > 6 ? ", ..." : ""}`);
    }
  }

  return { added, recent };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  options.schemes = recentSchemes(options.years);

  if (!process.env.LIBRARY_MEMBER_ID || !process.env.LIBRARY_PASSWORD) {
    console.error("set LIBRARY_MEMBER_ID and LIBRARY_PASSWORD to refresh the index");
    process.exit(1);
  }

  const cached = options.all ? {} : readCache();
  const cachedCount = Object.keys(cached).length;
  console.log(`harvest cache: ${cachedCount} records${options.all ? " (ignored: --all)" : ""}`);

  const specs = options.all
    ? ["callno:QP", ...options.schemes.map((scheme) => `title:${scheme}`)]
    : options.schemes.map((scheme) => `title:${scheme}`);

  console.log(`harvesting ${specs.length} queries for ${options.years} scheme years`);
  const fresh = await harvestSpecs(specs);

  const merged = { ...cached, ...fresh };
  console.log(`harvested ${Object.keys(fresh).length}, merged total ${Object.keys(merged).length}`);

  const changes = reportChanges(merged, options);

  if (options.dryRun) {
    console.log("\n--dry-run: table not rewritten");
    return;
  }

  const harvestPath = options.out ? resolve(options.out) : CACHE;
  writeFileSync(harvestPath, `${JSON.stringify(merged, null, 1)}\n`);
  console.log(`\nwrote harvest cache: ${harvestPath}`);

  const { spawnSync } = await import("node:child_process");
  const built = spawnSync(process.execPath, [resolve("./scripts/buildLibrarySaltTable.mjs"), harvestPath], {
    stdio: "inherit"
  });
  if (built.status !== 0) {
    process.exit(built.status || 1);
  }

  console.log(`\nrebuild the extension so the new mapping ships: npm run build`);
  console.log(`table: ${TABLE}`);
  if (changes.recent.length > 0) {
    console.log(`\n${changes.recent.length} recent-scheme subject(s) are new in this run.`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
