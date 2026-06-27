/**
 * Tests for celia/tool-map.ts — yaoyao → celia delegation mapping.
 *
 * These are pure-function tests (no spawn, no fs), covering the argument
 * transforms that are the heart of the delegation layer.
 *
 * Run: node --test src/__tests__/celia-tool-map.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import {
  CELIA_DELEGATION_MAP,
  isDelegatable,
  getMapping,
} from "../celia/tool-map.ts";

describe("celia tool-map: delegatability", () => {
  it("marks overlapping tools as delegatable", () => {
    assert.strictEqual(isDelegatable("memory_save"), true);
    assert.strictEqual(isDelegatable("memory_search"), true);
    assert.strictEqual(isDelegatable("memory_search_multi"), true);
    assert.strictEqual(isDelegatable("memory_search_enhanced"), true);
    assert.strictEqual(isDelegatable("memory_forget"), true);
    assert.strictEqual(isDelegatable("memory_list"), true);
  });

  it("does NOT delegate yaoyao-unique tools", () => {
    assert.strictEqual(isDelegatable("memory_graph"), false);
    assert.strictEqual(isDelegatable("memory_timeline"), false);
    assert.strictEqual(isDelegatable("memory_trends"), false);
    assert.strictEqual(isDelegatable("memory_quality"), false);
    assert.strictEqual(isDelegatable("memory_verify"), false);
    assert.strictEqual(isDelegatable("memory_cloud_sync"), false);
  });

  it("does NOT delegate action-shaped tools (atomic_fact)", () => {
    // atomic_fact uses `handler` not `execute` + is action-based; not delegated.
    assert.strictEqual(isDelegatable("memory_atomic_fact"), false);
  });

  it("getMapping returns null for unknown tools", () => {
    assert.strictEqual(getMapping("does_not_exist"), null);
  });
});

describe("celia tool-map: memory_save mapping", () => {
  it("maps yaoyao `content` → celia `text`", () => {
    const m = getMapping("memory_save")!;
    const out = m.map({ content: "用户喜欢咖啡" });
    assert.strictEqual(out.text, "用户喜欢咖啡");
    assert.strictEqual(m.celiaTool, "memory_store");
  });

  it("falls back to `text` if content absent", () => {
    const m = getMapping("memory_save")!;
    const out = m.map({ text: "fallback" });
    assert.strictEqual(out.text, "fallback");
  });

  it("defaults to empty string when neither present", () => {
    const m = getMapping("memory_save")!;
    const out = m.map({});
    assert.strictEqual(out.text, "");
  });
});

describe("celia tool-map: memory_search mapping", () => {
  it("maps query + maxResults → celia top_k with identity context", () => {
    const m = getMapping("memory_search")!;
    const out = m.map({ query: "部署方案", maxResults: 8 }) as Record<string, unknown>;
    assert.strictEqual(out.query, "部署方案");
    assert.strictEqual(out.top_k, 8);
    assert.strictEqual(out.is_procedural, false);
    assert.strictEqual(out.time_hint, true);
    assert.strictEqual(out.tenant_id, "default");
    assert.strictEqual(out.user_id, "tools-openclaw-user");
    assert.ok(typeof out.sessionId === "string" && out.sessionId.length > 0);
    assert.strictEqual(m.celiaTool, "memory_record_search");
  });

  it("defaults top_k to 5 when no limit given", () => {
    const m = getMapping("memory_search")!;
    const out = m.map({ query: "x" }) as Record<string, unknown>;
    assert.strictEqual(out.top_k, 5);
  });

  it("accepts topK alias as well", () => {
    const m = getMapping("memory_search_multi")!;
    const out = m.map({ query: "x", topK: 3 }) as Record<string, unknown>;
    assert.strictEqual(out.top_k, 3);
  });
});

describe("celia tool-map: memory_forget mapping", () => {
  it("forwards query only (yaoyao date has no celia equivalent)", () => {
    const m = getMapping("memory_forget")!;
    const out = m.map({ query: "旧偏好", date: "2026-01-01" });
    assert.strictEqual(out.query, "旧偏好");
    assert.ok(!("date" in out));
    assert.strictEqual(m.celiaTool, "memory_forget");
  });
});

describe("celia tool-map: memory_list mapping", () => {
  it("forwards categories, defaults to empty array", () => {
    const m = getMapping("memory_list")!;
    assert.deepStrictEqual(m.map({ categories: ["preference"] }), { categories: ["preference"] });
    assert.deepStrictEqual(m.map({}).categories, []);
  });
});
