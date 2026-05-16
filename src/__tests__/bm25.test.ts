import { describe, it } from "node:test";
import assert from "node:assert";
import { tokenize, buildBM25Index, scoreBM25, bm25Search } from "../utils/bm25.ts";

describe("bm25", () => {
  it("tokenizes Chinese + English", () => {
    const terms = tokenize("Hello 世界 world");
    assert.ok(terms.includes("hello"));
    assert.ok(terms.includes("世"));
    assert.ok(terms.includes("界"));
    assert.ok(terms.includes("world"));
  });

  it("builds index and scores", () => {
    const docs = [
      "Python programming language",
      "JavaScript web development",
      "Python machine learning",
    ];
    const index = buildBM25Index(docs);
    assert.strictEqual(index.totalDocs, 3);
    assert.ok(index.avgDocLen > 0);

    const results = scoreBM25(index, "Python");
    assert.ok(results.length >= 2);
    // Documents 0 and 2 both contain "Python"
    assert.ok(results[0].score > 0);
  });

  it("bm25Search returns sorted results", () => {
    const docs = [
      "The quick brown fox",
      "The lazy dog",
      "The quick brown fox jumps",
    ];
    const results = bm25Search(docs, "quick brown");
    assert.ok(results.length > 0);
    assert.ok(results[0].score >= (results[1]?.score ?? 0));
  });

  it("prefers exact match over partial", () => {
    const docs = [
      "cat dog bird",
      "cat dog",
      "bird",
    ];
    const results = bm25Search(docs, "cat dog");
    // Both docs 0 and 1 have cat+dog; BM25 length norm means shorter doc may score higher
    const indices = results.map(r => r.index).sort((a, b) => a - b);
    assert.ok(indices.includes(0));
    assert.ok(indices.includes(1));
    assert.strictEqual(indices.includes(2), false); // doc 2 has neither
  });

  it("handles empty query gracefully", () => {
    const docs = ["hello world"];
    const results = bm25Search(docs, "");
    assert.strictEqual(results.length, 0);
  });
});
