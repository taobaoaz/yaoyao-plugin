/**
 * Tests for storage/hybrid.ts — Hybrid search.
 *
 * Run: node --test src/__tests__/hybrid.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { createHybridSearch } from "../storage/hybrid.ts";
import type { SearchResult, EmbeddedSearchResult } from "../storage/types.ts";

describe("HybridSearch", () => {
  const hybrid = createHybridSearch();

  const ftsResults: SearchResult[] = [
    { id: 1, filename: "a.md", snippet: "apple", score: 0.9, date: "2025-01-01" },
    { id: 2, filename: "b.md", snippet: "banana", score: 0.7, date: "2025-01-02" },
  ];

  const vecResults: EmbeddedSearchResult[] = [
    { id: 1, filename: "a.md", snippet: "apple", score: 0.85, date: "2025-01-01", vectorScore: 0.85, hybridScore: 0 },
    { id: 3, filename: "c.md", snippet: "cherry", score: 0.6, date: "2025-01-03", vectorScore: 0.6, hybridScore: 0 },
  ];

  it("weighted: merges FTS and vector results", () => {
    const results = hybrid.weighted(ftsResults, vecResults, 10);
    assert.strictEqual(results.length, 3);
    // Items in both get boosted hybridScore
    const apple = results.find(r => r.id === 1);
    assert.ok(apple, "Apple should be present");
    assert.ok(apple!.hybridScore > 0, "Hybrid score should be > 0");
  });

  it("weighted: respects limit", () => {
    const results = hybrid.weighted(ftsResults, vecResults, 1);
    assert.strictEqual(results.length, 1);
  });

  it("weighted: empty inputs return empty", () => {
    assert.strictEqual(hybrid.weighted([], [], 10).length, 0);
  });

  it("rrf: fuses two lists", () => {
    const results = hybrid.rrf(ftsResults, vecResults, 10);
    assert.strictEqual(results.length, 3);
    assert.ok(results.every(r => r.hybridScore > 0));
  });

  it("rrf: empty inputs return empty", () => {
    assert.strictEqual(hybrid.rrf([], [], 10).length, 0);
  });
});
