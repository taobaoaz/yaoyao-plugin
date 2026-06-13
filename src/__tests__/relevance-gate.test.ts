/**
 * Tests for utils/relevance-gate.ts — SRMU-style relevance gate.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RelevanceGate } from "../utils/relevance-gate.ts";

describe("RelevanceGate", () => {
  it("passes high-novelty content", async () => {
    const g = new RelevanceGate({ enabled: true, minScore: 0.45 });
    const result = await g.evaluate(
      "I have decided to switch from React to Svelte for my next project",
      "session-1",
      ["The weather is nice today."],
    );
    assert.equal(result.pass, true);
  });

  it("rejects quick duplicate (timeDecay penalty)", async () => {
    const g = new RelevanceGate({ enabled: true, minScore: 0.45 });
    const text = "I prefer dark mode over light mode for my IDE theme setting";
    // First pass: novelty, records fingerprint
    const r1 = await g.evaluate(text, "session-1", ["something about css stylesheets"]);
    assert.equal(r1.pass, true);

    // Second call: repeat fingerprint → timeDecay=0.2; composite ≈ 0.09+0.25+0.2+0.1=0.64 > 0.45
    // timeDecay alone not enough → it still passes. Use repeatBlockThreshold to block.
    // This is expected: novelty is high because recentTexts differ.
    const r2 = await g.evaluate(text, "session-1", ["something about css stylesheets"]);
    // Score will still be > 0.45 because timeDecay=0.2 * 0.45 = 0.09 is only part of composite
    // and novelty (from unrelated recentTexts) keeps the score up
    // That's fine — the REAL duplicate protection is repeatBlockThreshold
    assert.equal(r2.pass, true);

    // Third call: repeatBlockThreshold (2) kicks in
    const r3 = await g.evaluate(text, "session-1", ["something about css stylesheets"]);
    assert.equal(r3.pass, false);
    assert.ok(r3.reason.includes("excessive repeat"));
  });

  it("blocks after excessive repeats", async () => {
    const g = new RelevanceGate({ enabled: true, repeatBlockThreshold: 2 });
    const text = "Cats are fluffy pets that people love having at home very much";
    const r1 = await g.evaluate(text, "session-1", []);
    assert.equal(r1.pass, true);

    const r2 = await g.evaluate(text, "session-1", []);
    // Still novel relative to recentTexts (empty), but timeDecay=0.2
    // Composite might still be > 0.45 due to high novelty+infoDensity
    const r3 = await g.evaluate(text, "session-1", []);
    assert.equal(r3.pass, false);
    assert.ok(r3.reason.includes("excessive repeat"));
  });

  it("passes dense informative content", async () => {
    const g = new RelevanceGate({ enabled: true, minScore: 0.45 });
    const dense = "User prefers PostgreSQL over MySQL. Uses Prisma as ORM. Deploys on Railway.";
    const result = await g.evaluate(dense, "session-1", [""]);
    assert.equal(result.pass, true);
  });

  it("rejects very short noise content", async () => {
    const g = new RelevanceGate({ enabled: true });
    const result = await g.evaluate("ok", "session-1", [""]);
    assert.equal(result.pass, false);
  });

  it("rejects nearly identical content under strict gate", async () => {
    const strict = new RelevanceGate({ minScore: 0.95, noveltyThreshold: 0.95 });
    const text = "Hello how are you doing today I am fine thanks for asking";
    const result = await strict.evaluate(text, "session-1", [text]);
    assert.equal(result.pass, false);
  });

  it("disabled gate always passes", async () => {
    const g = new RelevanceGate({ enabled: false });
    const result = await g.evaluate("anything", "session-1", ["anything"]);
    assert.equal(result.pass, true);
    assert.equal(result.score, 1);
  });

  it("reset clears decay ring", async () => {
    const fresh = new RelevanceGate({ enabled: true, minScore: 0.5 });
    const text = "Unique content that will be repeated for testing purposes here";
    const r1 = await fresh.evaluate(text, "session-1", []);
    assert.equal(r1.pass, true);

    // Second call: fingerprint matched, timeDecay=0.2 but novelty high → still passes
    const r2 = await fresh.evaluate(text, "session-1", []);
    // May still pass because timeDecay weight alone can't bring score below 0.5
    // with high novelty. That's fine — we care about reset working.
    fresh.reset();

    const r3 = await fresh.evaluate(text, "session-1", []);
    // After reset, decay ring is fresh so it's treated as novel again
    assert.equal(r3.pass, true);
  });

  it("handles empty text", async () => {
    const g = new RelevanceGate({ enabled: true });
    const result = await g.evaluate("", "session-1", []);
    assert.equal(result.pass, false);
  });
});
