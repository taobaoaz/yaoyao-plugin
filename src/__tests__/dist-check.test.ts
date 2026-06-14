/**
 * Unit tests for scripts/dist-check.mjs.
 *
 * Builds a tiny throwaway project tree under os.tmpdir() for each test,
 * exercises runDistCheck() against it, and asserts the report shape.
 *
 * Why not just run dist-check against the real repo? Because the real
 * repo is in sync by construction (the script is what protects it), so
 * it cannot exercise the "stale" branch. The negative cases here pin the
 * detection logic.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, utimesSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const scriptUrl = pathToFileURL(join(here, "..", "..", "scripts", "dist-check.mjs")).href;
const { runDistCheck } = await import(scriptUrl);

/** Build a project skeleton and return its root. */
function setup(label: string) {
  const root = mkdtempSync(join(tmpdir(), `distcheck-${label}-`));
  mkdirSync(join(root, "src", "feature"), { recursive: true });
  mkdirSync(join(root, "dist", "src", "feature"), { recursive: true });
  return root;
}

/** Create src + dist files at matching paths. Dist is one second newer. */
function touchPair(root: string, rel: string, body = "// stub\n") {
  const src = join(root, rel);
  // mirror dist-check path mapping: distRoot/<rel with .ts -> .js>
  const dist = join(root, "dist/" + rel.replace(/\.ts$/, ".js"));
  mkdirSync(dirname(src), { recursive: true });
  mkdirSync(dirname(dist), { recursive: true });
  writeFileSync(src, body);
  writeFileSync(dist, body);
  const past = new Date(Date.now() - 5_000);
  const now = new Date();
  utimesSync(src, past, past);
  utimesSync(dist, now, now);
  return { src, dist };
}

/** Make src newer than dist by exactly 10s. */
function makeSrcNewer(src: string, dist: string) {
  const now = Date.now() / 1000;
  utimesSync(src, now, now);
  utimesSync(dist, now - 10, now - 10);
}

function cleanup(root: string) {
  try { rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
}

test("dist-check: in-sync project reports ok=true", () => {
  const root = setup("ok");
  try {
    touchPair(root, "index.ts");
    touchPair(root, "src/feature/a.ts");
    touchPair(root, "src/feature/nested/b.ts");
    const r = runDistCheck(root);
    assert.equal(r.ok, true, `expected ok, got stale=${JSON.stringify(r.stale)}`);
    assert.equal(r.scanned, 3);
    assert.equal(r.stale.length, 0);
  } finally { cleanup(root); }
});

test("dist-check: src newer than dist is flagged as older", () => {
  const root = setup("older");
  try {
    const { src, dist } = touchPair(root, "src/feature/a.ts");
    const { src: src2 } = touchPair(root, "src/feature/b.ts"); // still in sync
    makeSrcNewer(src, dist);
    const r = runDistCheck(root);
    assert.equal(r.ok, false);
    assert.equal(r.stale.length, 1);
    assert.equal(r.stale[0].src, "src/feature/a.ts");
    assert.equal(r.stale[0].dist, "dist/src/feature/a.js");
    assert.equal(r.stale[0].reason, "older");
    // b.ts and index.ts are still in sync
    void src2;
  } finally { cleanup(root); }
});

test("dist-check: missing dist file is flagged as missing", () => {
  const root = setup("missing");
  try {
    touchPair(root, "index.ts");
    const { src, dist } = touchPair(root, "src/feature/a.ts");
    // rmSync only the dist counterpart
    rmSync(dist);
    assert.equal(existsSync(src), true);
    assert.equal(existsSync(dist), false);
    const r = runDistCheck(root);
    assert.equal(r.ok, false);
    assert.equal(r.stale.length, 1);
    assert.equal(r.stale[0].reason, "missing");
    assert.equal(r.stale[0].src, "src/feature/a.ts");
    assert.equal(r.stale[0].dist, "dist/src/feature/a.js");
  } finally { cleanup(root); }
});

test("dist-check: __tests__ directory is excluded", () => {
  const root = setup("excluded");
  try {
    touchPair(root, "src/feature/a.ts");
    // Put a test file with no dist counterpart. It must be ignored.
    mkdirSync(join(root, "src", "__tests__"), { recursive: true });
    const past = new Date(Date.now() - 5_000);
    const testSrc = join(root, "src", "__tests__", "a.test.ts");
    writeFileSync(testSrc, "// test stub\n");
    utimesSync(testSrc, past, past);
    const r = runDistCheck(root);
    assert.equal(r.ok, true, `__tests__/a.test.ts should be ignored, got ${JSON.stringify(r.stale)}`);
    assert.equal(r.scanned, 1); // only src/feature/a.ts
  } finally { cleanup(root); }
});

test("dist-check: empty project (only index.ts) is ok", () => {
  const root = setup("empty");
  try {
    touchPair(root, "index.ts");
    const r = runDistCheck(root);
    assert.equal(r.ok, true);
    assert.equal(r.scanned, 1);
  } finally { cleanup(root); }
});

test("dist-check: reports every stale file, not just the first", () => {
  const root = setup("multi");
  try {
    const a = touchPair(root, "src/feature/a.ts");
    const b = touchPair(root, "src/feature/b.ts");
    const c = touchPair(root, "src/feature/c.ts");
    makeSrcNewer(a.src, a.dist);
    makeSrcNewer(b.src, b.dist);
    makeSrcNewer(c.src, c.dist);
    const r = runDistCheck(root);
    assert.equal(r.ok, false);
    assert.equal(r.stale.length, 3);
    const srcs = r.stale.map(s => s.src).sort();
    assert.deepEqual(srcs, ["src/feature/a.ts", "src/feature/b.ts", "src/feature/c.ts"]);
  } finally { cleanup(root); }
});

test("dist-check: passes against the real repo at HEAD", () => {
  // Sanity: if the real repo ever drifts out of sync, this test catches it.
  const root = join(here, "..", "..");
  const r = runDistCheck(root);
  assert.equal(r.ok, true, `real repo out of sync: ${JSON.stringify(r.stale)}`);
});