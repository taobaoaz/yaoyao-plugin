/**
 * Tests for auto-capture.ts — pure utility functions (extractContent, safeStringify).
 *
 * Run: node --experimental-strip-types --test src/__tests__/auto-capture.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { extractContent, safeStringify } from "../hooks/auto-capture.ts";

describe("extractContent", () => {
  it("extracts string content", () => {
    assert.strictEqual(extractContent({ content: "hello" }), "hello");
  });

  it("extracts array of text parts", () => {
    const msg = {
      content: [
        { type: "text", text: "hello " },
        { type: "text", text: "world" },
        { type: "image", url: "http://x.jpg" },
      ],
    };
    assert.strictEqual(extractContent(msg), "hello  world");
  });

  it("returns empty for null/undefined", () => {
    assert.strictEqual(extractContent(null), "");
    assert.strictEqual(extractContent(undefined), "");
  });

  it("falls back to JSON for object content", () => {
    const msg = { content: { foo: "bar" } };
    const result = extractContent(msg);
    assert.ok(result.includes("foo"));
    assert.ok(result.includes("bar"));
  });

  it("truncates to maxLen", () => {
    assert.strictEqual(extractContent({ content: "1234567890" }, 5), "12345");
  });

  it("limits array parts", () => {
    const msg = { content: [{ type: "text", text: "1234567890" }] };
    assert.strictEqual(extractContent(msg, 5), "12345");
  });
});

describe("safeStringify", () => {
  it("stringifies simple object", () => {
    assert.strictEqual(safeStringify({ a: 1 }, 100), "{a:1}");
  });

  it("stringifies array", () => {
    assert.strictEqual(safeStringify([1, 2, 3], 100), "[1,2,3]");
  });

  it("handles circular reference", () => {
    const obj: unknown = { a: 1 };
    obj.self = obj;
    const result = safeStringify(obj, 200);
    assert.ok(result.includes("a:1"));
    assert.ok(result.includes("[Circular]"));
  });

  it("limits depth", () => {
    const deep = { a: { b: { c: { d: 1 } } } };
    const result = safeStringify(deep, 500);
    assert.ok(result.includes("[...]"));
  });

  it("truncates to maxLen", () => {
    const result = safeStringify({ a: "1234567890" }, 5);
    assert.strictEqual(result.length, 5);
  });

  it("limits array items to 10", () => {
    const arr = Array.from({ length: 15 }, (_, i) => i);
    const result = safeStringify(arr, 500);
    assert.ok(result.includes("...5 more"));
  });

  it("limits object keys to 10", () => {
    const obj: Record<string, number> = {};
    for (let i = 0; i < 15; i++) obj[`k${i}`] = i;
    const result = safeStringify(obj, 500);
    assert.ok(result.includes("...}"));
  });

  it("handles null", () => {
    assert.strictEqual(safeStringify(null, 10), "null");
  });

  it("handles primitives", () => {
    assert.strictEqual(safeStringify(42, 10), "42");
    assert.strictEqual(safeStringify("hi", 10), "hi");
    assert.strictEqual(safeStringify(true, 10), "true");
  });
});
