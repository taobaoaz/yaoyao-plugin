// scripts/dist-check.mjs — verify dist/ is in sync with src/.
//
// Walks every .ts file that tsconfig would compile (index.ts + src/**/*.ts,
// excluding src/__tests__/), and for each one confirms:
//   1. the corresponding dist/<same-path>.js exists
//   2. dist mtime >= src mtime (dist is not older than src)
//
// Exits 0 if everything is in sync, 1 otherwise. Wired into the test
// pipeline (`pretest` hook) so a stale dist — e.g. src/ edited, dist/ not
// rebuilt — is caught loudly instead of silently shipping outdated JS.
//
// CLI:
//   node scripts/dist-check.mjs             # check repo root
//   node scripts/dist-check.mjs --root=PATH  # check a different project

import { readdirSync, statSync, existsSync, utimesSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** Run a dist-vs-src freshness check rooted at `root`.
 *  @returns {{ ok: boolean, scanned: number, stale: Array<{src:string,dist:string,reason:string}> }} */
export function runDistCheck(root) {
  const srcRoots = [join(root, "index.ts")];
  const srcTree = join(root, "src");
  const distRoot = join(root, "dist");
  const stale = [];
  let scanned = 0;

  function checkOne(srcFile) {
    scanned++;
    const rel = relative(root, srcFile).replaceAll("\\", "/");
    const distFile = join(distRoot, rel).replace(/\.ts$/, ".js");
    const relDist = relative(root, distFile).replaceAll("\\", "/");
    if (!existsSync(distFile)) {
      stale.push({ src: rel, dist: relDist, reason: "missing" });
      return;
    }
    const srcStat = statSync(srcFile);
    const distStat = statSync(distFile);
    if (distStat.mtimeMs < srcStat.mtimeMs) {
      stale.push({ src: rel, dist: relDist, reason: "older" });
    }
  }

  function walk(dir) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); }
    catch (err) { if (err.code === "ENOENT") return; throw err; }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "__tests__") continue; // tsconfig excludes these
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".ts")) {
        checkOne(full);
      }
    }
  }

  for (const f of srcRoots) if (existsSync(f)) checkOne(f);
  if (existsSync(srcTree)) walk(srcTree);

  return { ok: stale.length === 0, scanned, stale };
}

// CLI entry — only runs when invoked directly, not when imported by tests.
const isCLI = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isCLI) {
  const argRoot = process.argv.find(a => a.startsWith("--root="));
  const root = argRoot ? resolve(argRoot.slice("--root=".length)) : resolve(here, "..");
  const { ok, scanned, stale } = runDistCheck(root);
  if (ok) {
    console.log(`dist-check: ${scanned} src files, all dist outputs in sync.`);
    process.exit(0);
  }
  console.error(`dist-check: ${stale.length} of ${scanned} src files have stale or missing dist outputs:`);
  for (const { src, dist, reason } of stale) {
    console.error(`  - [${reason}] ${src} -> ${dist}`);
  }
  console.error("");
  console.error("Run `npm run build` to rebuild dist/.");
  process.exit(1);
}

// Silence the unused-import warning when run as a CLI (utimesSync is only
// used by tests to rewind the dist mtime).
void utimesSync;