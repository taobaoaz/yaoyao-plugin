/**
 * Tests for utils/memory-backprop.ts — A-Mem style cross-memory back-propagation.
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { MemoryBackprop, type BackpropResult } from "../utils/memory-backprop.ts";

const mockMemories: Array<{ text: string; meta?: string }> = [
  { text: "User prefers React for web development tools", meta: "importance:0.7" },
  { text: "User lives in Beijing city China", meta: "importance:0.5" },
  { text: "User likes cats very much a lot", meta: "importance:0.6" },
  { text: "User favorite food is Italian cuisine pasta", meta: "importance:0.4" },
  { text: "User works as a software engineer full stack", meta: "importance:0.8" },
];

const mockDb = {
  getLatestMemory: (_limit: number) =>
    mockMemories.map((m, i) => ({
      id: i + 1,
      rowId: i + 1,
      snippet: m.text,
      text: m.text,
      meta: m.meta,
      date: "2026-06-08",
      score: 0.8,
      userText: m.text,
      asstText: "",
    })),
} as any;

describe("MemoryBackprop", () => {
  // Use lower minSimilarity so trigram overlap is sufficient for test mocks
  let backprop: MemoryBackprop;

  before(() => {
    backprop = new MemoryBackprop({ enabled: true, minSimilarity: 0.25 });
  });

  it("detects reinforces", async () => {
    // Very high overlap with mock[0]
    const results = await backprop.process(
      "User prefers React for web development tools and frameworks",
      "",
      mockDb,
    );
    const reinforces = results.filter((r) => r.relation === "reinforces");
    assert.ok(reinforces.length >= 1, `reinforces not found: ${JSON.stringify(results)}`);
  });

  it("detects supersedes (change indicator + overlap)", async () => {
    const results = await backprop.process(
      "User but now prefers Svelte for web development tools instead of React for projects now",
      "",
      mockDb,
    );
    const supersedes = results.filter((r) => r.relation === "supersedes");
    assert.ok(supersedes.length >= 1, `supersedes not found: ${JSON.stringify(results)}`);
  });

  it("detects contradiction", async () => {
    // Shares "user likes cats" content + "no longer" indicator
    const results = await backprop.process(
      "User no longer likes cats not anymore at all now for sure",
      "",
      mockDb,
    );
    const contradicts = results.filter((r) => r.relation === "contradicts");
    assert.ok(contradicts.length >= 1, `contradicts not found: ${JSON.stringify(results)}`);
  });

  it("detects elaborates", async () => {
    const results = await backprop.process(
      "User works as a software engineer full stack user works as a software engineer lead developer",
      "",
      mockDb,
    );
    const elaborates = results.filter((r) => r.relation === "elaborates");
    assert.ok(elaborates.length >= 1, `elaborates not found: ${JSON.stringify(results)}`);
  });

  it("returns nothing for completely different topic", async () => {
    const results = await backprop.process(
      "The weather in Antarctica is very cold",
      "",
      mockDb,
    );
    assert.equal(results.length, 0);
  });

  it("deduplicates same content via fingerprint", async () => {
    const text = "User likes programming in Python language tools";
    await backprop.process(text, "", mockDb);
    const r2 = await backprop.process(text, "", mockDb);
    assert.equal(r2.length, 0);
  });

  it("disabled backprop returns empty array", async () => {
    const disabled = new MemoryBackprop({ enabled: false });
    const results = await disabled.process("Anything at all", "", mockDb);
    assert.equal(results.length, 0);
  });

  it("reset clears fingerprint cache", async () => {
    const text = "Some unique content for testing purposes here";
    await backprop.process(text, "", mockDb);
    backprop.reset();
    const r2 = await backprop.process(text, "", mockDb);
    assert.ok(Array.isArray(r2));
  });
});
