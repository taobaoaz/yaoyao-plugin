/**
 * Tests for llm-parse.ts — JSON response parser + date formatter.
 * Pure functions, no dependencies.
 *
 * Run: node --experimental-strip-types --test src/__tests__/llm-parse.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { parseJSONResponse, formatDate } from "../utils/llm-parse.ts";

describe("parseJSONResponse", () => {
  it("parses plain JSON array", () => {
    const result = parseJSONResponse<Array<{ name: string }>>('[{"name":"test"}]');
    assert(result !== null);
    assert(Array.isArray(result));
    assert.strictEqual(result[0].name, "test");
  });

  it("parses plain JSON object", () => {
    const result = parseJSONResponse<{ ok: boolean }>('{"ok":true}');
    assert(result !== null);
    assert.strictEqual((result as any).ok, true);
  });

  it("strips ```json fence", () => {
    const result = parseJSONResponse<Array<{ a: number }>>("```json\n[{\"a\":1}]\n```");
    assert(result !== null);
    assert(Array.isArray(result));
    assert.strictEqual(result[0].a, 1);
  });

  it("strips ``` fence (no json marker)", () => {
    const result = parseJSONResponse<Array<{ a: number }>>("```\n[{\"a\":1}]\n```");
    assert(result !== null);
    assert(Array.isArray(result));
  });

  it("extracts JSON array from surrounding text", () => {
    const result = parseJSONResponse<Array<{ id: number }>>('Here is the result: [{"id":1},{"id":2}] Done.');
    assert(result !== null);
    assert.strictEqual(result.length, 2);
  });

  it("extracts JSON object from surrounding text", () => {
    const result = parseJSONResponse<{ status: string }>('Response: {"status":"ok"} End.');
    assert(result !== null);
    assert.strictEqual((result as any).status, "ok");
  });

  it("returns null for invalid JSON", () => {
    const result = parseJSONResponse("just some text without JSON");
    assert.strictEqual(result, null);
  });

  it("returns null for empty string", () => {
    const result = parseJSONResponse("");
    assert.strictEqual(result, null);
  });

  it("handles nested JSON with multiple fences", () => {
    const result = parseJSONResponse<{ items: Array<{ a: number }> }>('{"items":[{"a":1},{"a":2}]}');
    assert(result !== null);
    assert.strictEqual((result as any).items.length, 2);
  });
});

describe("formatDate", () => {
  it("formats ISO date string to YYYY-MM-DD", () => {
    assert.strictEqual(formatDate("2026-05-02T20:30:00.000Z"), "2026-05-02");
  });

  it("returns 'unknown' for invalid input", () => {
    assert.strictEqual(formatDate("not-a-date"), "unknown");
  });

  it("handles timestamps", () => {
    const ts = new Date("2026-06-15").toISOString();
    assert.strictEqual(formatDate(ts), "2026-06-15");
  });
});
