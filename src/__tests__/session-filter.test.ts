/**
 * Tests for session-filter.ts — session processing decisions.
 * Pure functions, no dependencies.
 *
 * Run: node --experimental-strip-types --test src/__tests__/session-filter.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { createSessionFilter } from "../utils/session-filter.ts";

describe("createSessionFilter.shouldProcess", () => {
  it("allows normal user session by default", () => {
    const f = createSessionFilter();
    assert.strictEqual(f.shouldProcess("user-session-123"), true);
  });

  it("blocks heartbeat session by default", () => {
    const f = createSessionFilter();
    assert.strictEqual(f.shouldProcess("heartbeat"), false);
  });

  it("blocks cron session by default", () => {
    const f = createSessionFilter();
    assert.strictEqual(f.shouldProcess("cron-task-check"), false);
  });

  it("blocks internal labels (system, admin, cron, etc.)", () => {
    const f = createSessionFilter();
    const blocked = ["system", "admin", "cron", "heartbeat", "healthcheck", "internal", "plugin", "test", "debug", "monitor"];
    for (const label of blocked) {
      assert.strictEqual(f.shouldProcess(label), false, `should block "${label}"`);
    }
  });

  it("returns false for empty session key", () => {
    const f = createSessionFilter();
    assert.strictEqual(f.shouldProcess(""), false);
    assert.strictEqual(f.shouldProcess("   "), false);
  });

  it("blocks custom labels via config", () => {
    const f = createSessionFilter({ blockLabels: ["no-thanks", "skip-me"] });
    assert.strictEqual(f.shouldProcess("no-thanks"), false);
    assert.strictEqual(f.shouldProcess("skip-me-007"), false);
    assert.strictEqual(f.shouldProcess("normal-session"), true);
  });

  it("uses allowLabels to restrict processing", () => {
    const f = createSessionFilter({ allowLabels: ["chat", "user"] });
    assert.strictEqual(f.shouldProcess("chat-session"), true);
    assert.strictEqual(f.shouldProcess("user-123"), true);
    assert.strictEqual(f.shouldProcess("heartbeat"), false);
    assert.strictEqual(f.shouldProcess("cron"), false);
  });

  it("skips sessions below minMessages threshold", () => {
    const f = createSessionFilter({ minMessages: 3 });
    assert.strictEqual(f.shouldProcess("user-session", { messageCount: 2 }), false);
    assert.strictEqual(f.shouldProcess("user-session", { messageCount: 3 }), true);
    assert.strictEqual(f.shouldProcess("user-session", { messageCount: 10 }), true);
  });

  it("default minMessages is 2", () => {
    const f = createSessionFilter();
    assert.strictEqual(f.shouldProcess("user-1", { messageCount: 0 }), false);
    assert.strictEqual(f.shouldProcess("user-1", { messageCount: 1 }), false);
    assert.strictEqual(f.shouldProcess("user-1", { messageCount: 2 }), true);
  });

  it("context label takes priority for blocking", () => {
    const f = createSessionFilter({ blockLabels: ["secret"] });
    // session key is fine, but context label is blocked
    assert.strictEqual(f.shouldProcess("chat", { label: "secret-project" }), false);
  });
});

describe("getInternalLabels", () => {
  it("returns array of default internal labels", () => {
    const f = createSessionFilter();
    const labels = f.getInternalLabels();
    assert(Array.isArray(labels));
    assert(labels.includes("heartbeat"));
    assert(labels.includes("cron"));
    assert.strictEqual(labels.length >= 10, true);
  });
});

describe("addBlockedLabels", () => {
  it("adds new labels to block list", () => {
    const f = createSessionFilter();
    assert.strictEqual(f.shouldProcess("my-label"), true);
    f.addBlockedLabels(["my-label"]);
    assert.strictEqual(f.shouldProcess("my-label"), false);
  });
});
