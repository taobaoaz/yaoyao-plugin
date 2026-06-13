import { batchDedup, textSimilarity } from "../utils/batch-dedup.ts";
import { describe, it } from "node:test";
import assert from "node:assert";

describe("batchDedup", () => {
  it("keeps unique texts", () => {
    const result = batchDedup(["hello world", "foo bar", "baz qux"]);
    assert.strictEqual(result.outputCount, 3);
    assert.deepStrictEqual(result.duplicateIndices, []);
  });

  it("detects near-duplicates", () => {
    const result = batchDedup([
      "I love eating pizza from Dominos",
      "I love eating pizza from dominos",
      "something completely different",
    ]);
    assert.strictEqual(result.outputCount, 2);
    assert.strictEqual(result.duplicateIndices.length, 1);
  });

  it("handles empty array", () => {
    const result = batchDedup([]);
    assert.strictEqual(result.outputCount, 0);
  });

  it("handles single item", () => {
    const result = batchDedup(["only one"]);
    assert.strictEqual(result.outputCount, 1);
  });

  it("marks correct duplicateOf", () => {
    const result = batchDedup([
      "original text here",
      "original text here",
      "different content",
    ]);
    assert.ok(result.duplicateIndices.includes(1));
  });
});

describe("textSimilarity", () => {
  it("identical texts = 1.0", () => {
    assert.strictEqual(textSimilarity("hello", "hello"), 1);
  });

  it("completely different = low", () => {
    assert.ok(textSimilarity("abc", "xyz") < 0.3);
  });
});
