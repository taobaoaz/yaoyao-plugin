/**
 * Tests for query-expander.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { expandQuery } from "../utils/query-expander.ts";

describe("expandQuery", () => {
  it("passes through short queries unchanged", () => {
    assert.strictEqual(expandQuery("a"), "a");
    assert.strictEqual(expandQuery(""), "");
  });

  it("expands Chinese colloquial terms", () => {
    const result = expandQuery("系统挂了怎么办");
    assert.ok(result.includes("崩溃"));
    assert.ok(result.includes("crash"));
    assert.ok(result.includes("error"));
  });

  it("expands English technical terms", () => {
    const result = expandQuery("The server crashed");
    assert.ok(result.includes("崩溃"));
    assert.ok(result.includes("error"));
  });

  it("does not duplicate existing terms", () => {
    const result = expandQuery("系统 crash 了");
    // crash already in query, should not be duplicated
    const crashes = result.match(/crash/gi);
    assert.strictEqual(crashes?.length, 1);
  });

  it("limits expansion to MAX_EXPANSION_TERMS", () => {
    const result = expandQuery("报错 日志 权限");
    // Original query: 报错 日志 权限 (3 words)
    // Expanded should add at most 5 terms
    const parts = result.split(" ");
    const addedCount = parts.length - 3; // subtract original 3 words
    assert.ok(addedCount <= 5, `Added ${addedCount} terms, expected <= 5`);
  });

  it("is idempotent — precise queries pass through", () => {
    const query = "select * from users where id = 1";
    assert.strictEqual(expandQuery(query), query);
  });
});
