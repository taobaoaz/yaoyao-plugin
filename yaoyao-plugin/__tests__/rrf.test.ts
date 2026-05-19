import { describe, it } from "node:test";
import assert from "node:assert";
import { reciprocalRankFusion, fuseFTSAndVector } from "../core/search/rrf.ts";

describe("rrf", () => {
  it("fuses two simple ranked lists", () => {
    const fts = [
      { id: "a", doc: { title: "A" }, originalScore: 0.9 },
      { id: "b", doc: { title: "B" }, originalScore: 0.8 },
      { id: "c", doc: { title: "C" }, originalScore: 0.7 },
    ];
    const vec = [
      { id: "b", doc: { title: "B" }, originalScore: 0.95 },
      { id: "a", doc: { title: "A" }, originalScore: 0.85 },
      { id: "d", doc: { title: "D" }, originalScore: 0.6 },
    ];

    const fused = reciprocalRankFusion([fts, vec], 60);
    assert.strictEqual(fused.length, 4);
    // a and b appear in both lists → highest RRF (tie possible)
    const topIds = fused.slice(0, 2).map(r => r.id);
    assert.ok(topIds.includes("a"));
    assert.ok(topIds.includes("b"));
    // c and d appear in one list each
    assert.ok(fused[2].rrfScore >= fused[3].rrfScore);
  });

  it("handles single list gracefully", () => {
    const fts = [
      { id: "a", doc: { title: "A" }, originalScore: 0.9 },
      { id: "b", doc: { title: "B" }, originalScore: 0.8 },
    ];
    const fused = reciprocalRankFusion([fts], 60);
    assert.strictEqual(fused.length, 2);
    assert.strictEqual(fused[0].id, "a");
    assert.strictEqual(fused[1].id, "b");
  });

  it("handles empty lists", () => {
    const fused = reciprocalRankFusion([[], []], 60);
    assert.strictEqual(fused.length, 0);
  });

  it("fuseFTSAndVector convenience function", () => {
    const fts = [
      { id: "a", score: 0.9, snippet: "A" },
      { id: "b", score: 0.8, snippet: "B" },
    ];
    const vec = [
      { id: "b", score: 0.95, snippet: "B" },
      { id: "a", score: 0.85, snippet: "A" },
    ];
    const fused = fuseFTSAndVector(fts, vec, 60, 0);
    assert.strictEqual(fused.length, 2);
    // Both a and b are in both lists - order may vary due to tie
    const ids = fused.map(r => r.id);
    assert.ok(ids.includes("a"));
    assert.ok(ids.includes("b"));
    assert.ok(fused[0].rrfScore > 0);
    assert.ok(fused[0].ftsScore > 0);
    assert.ok(fused[0].vecScore > 0);
  });

  it("respects score threshold", () => {
    const fts = [{ id: "a", score: 0.9 }];
    const vec = [{ id: "a", score: 0.85 }];
    const fused = fuseFTSAndVector(fts, vec, 60, 0.01);
    assert.strictEqual(fused.length, 1);
    assert.ok(fused[0].rrfScore >= 0.01);
  });

  it("filters below threshold", () => {
    const fts = [{ id: "a", score: 0.01 }];
    const vec = [{ id: "a", score: 0.01 }];
    const fused = fuseFTSAndVector(fts, vec, 60, 0.05);
    assert.strictEqual(fused.length, 0);
  });
});
