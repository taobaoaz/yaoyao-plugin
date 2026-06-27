/**
 * Tests for coexistence.ts celia-aware detection (v1.9.1).
 *
 * The module performs an IIFE detection on import reading ~/.openclaw/openclaw.json.
 * To test slot-owner recognition deterministically we run the detection in a
 * child process with a controlled HOME, then assert on the emitted state.
 *
 * Run: node --test src/__tests__/coexistence-celia.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Run a fresh node process that imports coexistence.ts under a given fake HOME
 * and prints the detection result as JSON. This sidesteps the module-level
 * cached state from our own process.
 */
function detectUnderFakeHome(slots: Record<string, string> | null): {
  mode: string;
  slotOwner: string;
  celiaActive: boolean;
} {
  const home = mkdtempSync(join(tmpdir(), "yao-celia-"));
  mkdirSync(join(home, ".openclaw"), { recursive: true });
  if (slots) {
    writeFileSync(join(home, ".openclaw", "openclaw.json"), JSON.stringify({ slots }));
  }
  const probe = `
    import { getCoexistMode, getCoexistState, getSlotOwner, isCeliaActive }
      from ${JSON.stringify(new URL("../utils/coexistence.ts", import.meta.url).pathname)};
    const out = {
      mode: getCoexistMode(),
      slotOwner: getSlotOwner(),
      celiaActive: isCeliaActive(),
    };
    process.stdout.write(JSON.stringify(out));
  `;
  try {
    const stdout = execFileSync(process.execPath, ["--experimental-strip-types", "-e", probe], {
      env: { ...process.env, HOME: home, USERPROFILE: home },
      encoding: "utf-8",
    });
    return JSON.parse(stdout);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

describe("coexistence: memory-celia slot detection", () => {
  it("detects coexist + slotOwner when celia owns the memory slot", () => {
    const r = detectUnderFakeHome({ memory: "memory-celia" });
    assert.strictEqual(r.mode, "coexist");
    assert.strictEqual(r.slotOwner, "memory-celia");
    assert.strictEqual(r.celiaActive, true);
  });

  it("stays standalone when yaoyao itself owns the slot", () => {
    const r = detectUnderFakeHome({ memory: "yaoyao-memory" });
    assert.strictEqual(r.mode, "standalone");
    assert.strictEqual(r.slotOwner, "");
    assert.strictEqual(r.celiaActive, false);
  });

  it("stays standalone when no slots configured (empty env)", () => {
    const r = detectUnderFakeHome(null);
    assert.strictEqual(r.mode, "standalone");
    assert.strictEqual(r.slotOwner, "");
    assert.strictEqual(r.celiaActive, false);
  });

  it("detects coexist but NOT celia when another system owns slot", () => {
    const r = detectUnderFakeHome({ memory: "some-other-memory" });
    assert.strictEqual(r.mode, "coexist");
    assert.strictEqual(r.slotOwner, "some-other-memory");
    // Only "celia" in the owner name triggers the bridge.
    assert.strictEqual(r.celiaActive, false);
  });
});
