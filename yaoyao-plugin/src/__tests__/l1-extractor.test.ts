/**
 * Tests for l1-extractor.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { extractHeuristic, extractFacts } from "../utils/l1-extractor.ts";

describe("extractHeuristic", () => {
  it("extracts identity", () => {
    const facts = extractHeuristic("我叫张三，是一个开发者。", "");
    assert.ok(facts.some(f => f.type === "identity" && f.content.includes("张三")));
  });
  it("extracts preference", () => {
    const facts = extractHeuristic("我喜欢吃川菜。", "");
    assert.ok(facts.some(f => f.type === "preference" && f.content.includes("川菜")));
  });
  it("extracts task", () => {
    const facts = extractHeuristic("记得明天开会。", "");
    assert.ok(facts.some(f => f.type === "task" && f.content.includes("开会")));
  });
  it("extracts correction", () => {
    const facts = extractHeuristic("不对，我是李四。", "");
    assert.ok(facts.some(f => f.type === "correction" && f.content.includes("李四")));
  });
  it("returns empty for plain text", () => {
    const facts = extractHeuristic("今天天气不错。", "是的。");
    assert.strictEqual(facts.length, 0);
  });
});

describe("extractFacts unified", () => {
  it("lite mode uses heuristic", async () => {
    const facts = await extractFacts("我喜欢咖啡。", "", { brainMode: "lite" });
    assert.ok(facts.some(f => f.source === "heuristic"));
  });
  it("full mode without LLM falls back to heuristic", async () => {
    const facts = await extractFacts("我叫王五。", "", { brainMode: "full", llmClient: null });
    assert.ok(facts.some(f => f.source === "heuristic"));
  });
});
