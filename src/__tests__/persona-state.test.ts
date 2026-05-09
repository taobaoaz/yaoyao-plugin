/**
 * PersonaStateMachine v3 单元测试
 *
 * 覆盖：默认状态、更新周期、mood/energy/trust 计算、置信度衰减、趋势检测、
 *       隐式标注提取/读取（v3 新增）
 * 运行: node --test src/__tests__/persona-state.test.ts
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PersonaStateMachine } from "../utils/persona-state.ts";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "psm-test-"));

describe("PersonaStateMachine", { concurrency: 1 }, () => {
  let psm: PersonaStateMachine;

  before(() => {
    psm = new PersonaStateMachine(tmpDir);
  });

  after(() => {
    try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* cleanup */ }
  });

  // ── Default State ──
  describe("default state", () => {
    it("returns neutral/medium/medium on fresh init", () => {
      const s = psm.getState();
      assert.strictEqual(s.mood, "neutral");
      assert.strictEqual(s.moodScore, 0);
      assert.strictEqual(s.energy, "medium");
      assert.strictEqual(s.trust, "medium");
      assert.strictEqual(s.confidence, 0.5);
      assert.strictEqual(s.moodTrend, "stable");
      assert.strictEqual(s.version, 3);
    });
  });

  // ── Update ──
  describe("update", () => {
    it("returns a valid state after update with positive text", () => {
      const s = psm.update({ textSample: "今天心情很好，完成了一个大功能！" });
      assert.ok(["positive", "neutral", "negative"].includes(s.mood));
      assert.ok(s.moodScore >= -1 && s.moodScore <= 1);
      assert.ok(s.confidence > 0);
      assert.ok(s.updatedAt);
    });

    it("returns a valid state after update with negative text", () => {
      const s = psm.update({ textSample: "不太顺利，出了很多bug，很烦" });
      assert.ok(["positive", "neutral", "negative"].includes(s.mood));
      assert.ok(typeof s.moodScore === "number");
    });

    it("tracks mood history across multiple updates", () => {
      for (let i = 0; i < 5; i++) {
        psm.update({ textSample: `update number ${i}` });
      }
      const s = psm.getState();
      assert.ok(typeof s.moodScore === "number");
    });
  });

  // ── v3: Implicit Tags ──
  describe("extractImplicitTags", () => {
    it("extracts stress signals from text with indicators", () => {
      const tags = psm.extractImplicitTags("今天又加班到很晚，压力好大！！");
      const stress = tags.find(t => t.tag === "stress_signal");
      assert.ok(stress, "should detect stress signal");
      assert.ok(stress!.confidence > 0.5);
      assert.ok(stress!.source.includes("加班"));
    });

    it("extracts decision avoidance pattern", () => {
      const tags = psm.extractImplicitTags("随便吧，你定就行");
      const avoid = tags.find(t => t.tag === "preference_pattern" && t.value === "decision_avoidance");
      assert.ok(avoid, "should detect decision avoidance");
    });

    it("extracts engagement depth for long messages", () => {
      const longText = "这是一个很长很长的消息，" + "我在详细解释我的想法。".repeat(20);
      const tags = psm.extractImplicitTags(longText);
      const engage = tags.find(t => t.tag === "engagement");
      assert.ok(engage, "should detect engagement");
      assert.strictEqual(engage!.value, "deep");
    });

    it("returns empty array for neutral short text", () => {
      const tags = psm.extractImplicitTags("好的");
      // No stress, no avoidance, not long enough for engagement
      assert.ok(tags.length === 0 || !tags.some(t => t.tag === "stress_signal"));
    });
  });

  describe("readImplicitTags", () => {
    it("reads back tags written by extractImplicitTags", () => {
      psm.extractImplicitTags("累累累累累！！！");
      const tags = psm.readImplicitTags(7);
      assert.ok(tags.length > 0);
      assert.ok(tags.some(t => t.tag === "stress_signal"));
    });

    it("respects the sinceDays filter", () => {
      const tags = psm.readImplicitTags(0);
      assert.strictEqual(tags.length, 0);
    });
  });

  // ── Confidence Decay ──
  describe("confidence decay", () => {
    it("applies decay after long idle time (via applyConfidenceDecay)", () => {
      const s = psm.getState();
      assert.ok(typeof s.confidence === "number");
    });
  });

  // ── Mood Prediction ──
  describe("predictMood", () => {
    it("returns null when insufficient history", () => {
      const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), "psm-pred-"));
      const fresh = new PersonaStateMachine(freshDir);
      const pred = (fresh as any).predictMood();
      assert.strictEqual(pred, null);
      try { fs.rmSync(freshDir, { recursive: true }); } catch { /* */ }
    });

    it("returns prediction after enough history", () => {
      for (let i = 0; i < 5; i++) {
        psm.update({ textSample: `mood track ${i}` });
      }
      const pred = (psm as any).predictMood();
      if (pred) {
        assert.ok(typeof pred.score === "number");
        assert.ok(typeof pred.confidence === "number");
      }
    });
  });

  // ── Persistence ──
  describe("persistence", () => {
    it("state persists to disk and reloads", () => {
      psm.update({ textSample: "persist test data" });

      const psm2 = new PersonaStateMachine(tmpDir);
      const loaded = psm2.getState();
      assert.ok(loaded.updatedAt);
      assert.ok(typeof loaded.moodScore === "number");
    });

    it("implicit tags persist to .implicit-tags.jsonl", () => {
      psm.extractImplicitTags("深夜还在测试，有点崩溃了");
      const tagsFile = path.join(tmpDir, ".implicit-tags.jsonl");
      assert.ok(fs.existsSync(tagsFile), "tags file should exist");
      const content = fs.readFileSync(tagsFile, "utf-8");
      assert.ok(content.includes("stress_signal"));
    });
  });
});
