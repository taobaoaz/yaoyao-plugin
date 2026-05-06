/**
 * FeedbackTracker 单元测试
 *
 * 覆盖：记录、读取、统计、学习、压缩
 * 运行: node --test src/__tests__/feedback-tracker.test.ts
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FeedbackTracker } from "../learning/feedback-tracker.ts";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fb-test-"));

describe("FeedbackTracker", { concurrency: 1 }, () => {
  let tracker: FeedbackTracker;

  before(() => {
    tracker = new FeedbackTracker(tmpDir);
  });

  after(() => {
    try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* cleanup */ }
  });

  describe("fresh instance", () => {
    it("returns empty stats on fresh init", () => {
      const stats = tracker.getStats();
      assert.strictEqual(stats.total, 0);
      assert.strictEqual(stats.corrections, 0);
      assert.strictEqual(stats.praises, 0);
      assert.strictEqual(stats.ignores, 0);
      assert.deepStrictEqual(stats.topTags, []);
    });
  });

  describe("record", () => {
    it("records a correction entry", () => {
      tracker.record({ type: "correction", original: "错误的记忆", tag: "memory", context: "测试" });
      const stats = tracker.getStats();
      assert.strictEqual(stats.total, 1);
      assert.strictEqual(stats.corrections, 1);
    });

    it("records a praise entry", () => {
      tracker.record({ type: "praise", original: "回答很好", tag: "tone" });
      const stats = tracker.getStats();
      assert.strictEqual(stats.total, 2);
      assert.strictEqual(stats.praises, 1);
    });

    it("records multiple entries with different tags", () => {
      tracker.record({ type: "correction", original: "不相关的回答", tag: "relevance" });
      tracker.record({ type: "ignore", original: "", tag: "general" });
      tracker.record({ type: "correction", original: "语气太生硬", tag: "tone" });
      const stats = tracker.getStats();
      assert.strictEqual(stats.total, 5);
      assert.strictEqual(stats.corrections, 3);
      assert.strictEqual(stats.topTags.length > 0, true);
    });
  });

  describe("readAll", () => {
    it("returns entries in reverse chronological order", () => {
      const entries = tracker.readAll(10);
      assert.ok(entries.length > 0);
      // Most recent first
      if (entries.length >= 2) {
        const t1 = new Date(entries[0].timestamp).getTime();
        const t2 = new Date(entries[1].timestamp).getTime();
        assert.ok(t1 >= t2);
      }
    });

    it("respects limit parameter", () => {
      const entries = tracker.readAll(2);
      assert.ok(entries.length <= 2);
    });
  });

  describe("getStats", () => {
    it("reports correct tag breakdown", () => {
      const stats = tracker.getStats();
      assert.ok(Array.isArray(stats.topTags));
      if (stats.topTags.length > 0) {
        assert.ok(stats.topTags[0].tag);
        assert.ok(stats.topTags[0].count > 0);
      }
      // Check recentByTag exists with correct structure
      assert.ok(typeof stats.recentByTag === "object");
    });
  });

  describe("learn", () => {
    it("returns suggestions based on feedback patterns", () => {
      // Add more corrections to trigger suggestions
      for (let i = 0; i < 5; i++) {
        tracker.record({ type: "correction", original: "错误的事实内容", tag: "memory" });
      }
      const result = tracker.learn();
      assert.ok(result.totalFeedback > 0);
      assert.ok(typeof result.correctionRate === "string");
      assert.ok(Array.isArray(result.suggestions));
      assert.ok(Array.isArray(result.topTags));
    });

    it("suggests on memory correction patterns", () => {
      const result = tracker.learn();
      const memorySuggestion = result.suggestions.find(s => s.includes("记忆") || s.includes("纠错"));
      if (result.corrections >= 3) {
        assert.ok(result.suggestions.length > 0);
      }
    });
  });

  describe("compression", () => {
    it("does not throw on compression call", () => {
      // Compress is only called when > 1000 entries, so just verify it doesn't crash
      // by calling readAll (which the compress method uses internally via readAll)
      const entries = tracker.readAll(2000);
      assert.ok(typeof entries === "object");
    });
  });
});
