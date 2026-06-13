/**
 * Tests for utils/semantic-shift-detector.ts — GAM-style topic shift detection.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SemanticShiftDetector } from "../utils/semantic-shift-detector.ts";

describe("SemanticShiftDetector", () => {
  it("initializes topic on first call", () => {
    const d = new SemanticShiftDetector({ threshold: 0.55, minContentLength: 10 });
    const result = d.evaluate("I love building web apps with React and TypeScript");
    assert.equal(result.isShift, false);
    assert.equal(result.similarityToCurrent, 1);
    assert.ok(result.currentTopic.includes("React"));
  });

  it("detects same topic within threshold", () => {
    const d = new SemanticShiftDetector({ threshold: 0.55, minContentLength: 10 });
    d.evaluate("React TypeScript frontend development");
    // Same keywords → high Jaccard
    const result = d.evaluate("TypeScript React frontend development");
    assert.equal(result.isShift, false);
    assert.ok(result.similarityToCurrent >= 0.55);
  });

  it("detects topic shift when content changes", () => {
    const d = new SemanticShiftDetector({ threshold: 0.55, minContentLength: 10 });
    d.evaluate("React TypeScript frontend development");
    // Completely different keywords
    const result = d.evaluate("hiking mountain trail scenery photography");
    assert.equal(result.isShift, true);
    assert.ok(result.similarityToCurrent < 0.55);
  });

  it("resets buffered count on shift", () => {
    const d = new SemanticShiftDetector({ threshold: 0.55, minContentLength: 10 });
    d.evaluate("cats pets fluffy cute kitten");
    assert.equal((d as any).capturedCount, 1);
    d.evaluate("cats pets cute kitten fluffy");
    assert.equal((d as any).capturedCount, 2);
    d.evaluate("cats fluffy cute kitten pets");
    assert.equal((d as any).capturedCount, 3);
    // Shift to different topic
    d.evaluate("python data science machine learning");
    assert.equal((d as any).capturedCount, 1);
  });

  it("forces flush on max buffered captures", () => {
    const d = new SemanticShiftDetector({ maxBufferedCaptures: 3, maxIdleMs: 60000, minContentLength: 10, threshold: 0.55 });
    d.evaluate("topic alpha long content words");
    d.evaluate("topic alpha long content words");
    d.evaluate("topic alpha long content words");
    // 4th call → capturedCount = 3 >= maxBufferedCaptures = 3
    const result = d.evaluate("topic alpha long content words");
    assert.equal(result.isShift, true);
    assert.ok(result.reason.includes("max") || result.reason.includes("buffered") || result.reason.includes("captured"));
  });

  it("forces flush on max idle time", () => {
    const d = new SemanticShiftDetector({ maxIdleMs: 0, maxBufferedCaptures: 999, minContentLength: 10 });
    d.evaluate("Initial topic long enough content");
    const result = d.evaluate("Same topic still here content");
    assert.equal(result.isShift, true);
    assert.ok(result.reason.includes("idle"));
  });

  it("short content does not trigger shift", () => {
    const d = new SemanticShiftDetector({ threshold: 0.55, minContentLength: 30 });
    d.evaluate("Long content about machine learning and neural networks and deep learning");
    const result = d.evaluate("ok thanks");
    assert.equal(result.isShift, false);
    assert.ok(result.reason.includes("short"));
  });

  it("disabled detector never shifts", () => {
    const d = new SemanticShiftDetector({ enabled: false });
    d.evaluate("Topic one");
    const result = d.evaluate("Completely different topic");
    assert.equal(result.isShift, false);
  });

  it("markFlushed resets counter", () => {
    const d = new SemanticShiftDetector({ threshold: 0.55, minContentLength: 10 });
    d.evaluate("Topic A long enough here");
    assert.equal((d as any).capturedCount, 1);
    d.evaluate("Topic A long enough again");
    assert.equal((d as any).capturedCount, 2);
    d.markFlushed();
    assert.equal((d as any).capturedCount, 0);
  });

  it("reset clears everything then initializes on next call", () => {
    const d = new SemanticShiftDetector({ threshold: 0.55, minContentLength: 20 });
    d.evaluate("Topic one long enough for detection");
    d.evaluate("Topic one again long enough");
    d.reset();
    assert.equal((d as any).capturedCount, 0);
    assert.equal((d as any).currentTopic, null);
    assert.equal((d as any).topicWindow.length, 0);
    const result = d.evaluate("Brand new start for the detector");
    assert.equal(result.isShift, false);
    assert.equal(result.reason, "initial topic");
  });

  it("stats returns diagnostics", () => {
    const d = new SemanticShiftDetector({ threshold: 0.55, minContentLength: 10 });
    d.evaluate("Some content here for testing purposes");
    d.evaluate("More content here for the detector stats");
    const stats = d.stats();
    assert.equal(typeof stats.topicWindowSize, "number");
    assert.equal(typeof stats.capturedCount, "number");
    assert.equal(typeof stats.idleSec, "number");
    assert.equal(typeof stats.currentTopicSnippet, "string");
  });
});
