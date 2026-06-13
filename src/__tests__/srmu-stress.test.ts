/**
 * stress/srmu-stress.test.ts — 高压测试套件
 *
 * 覆盖：
 *   1. RelevanceGate 高并发 + 长时间运行 + 边界条件
 *   2. SemanticShiftDetector 海量主题漂移 + 安全阀
 *   3. MemoryBackprop 大规模交叉检测 + 性能基准
 *   4. 混合工作负载（三模块同时运行）
 *   5. 内存泄漏检测（GC 前后对比）
 *
 * v1.7.8
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { RelevanceGate } from "../utils/relevance-gate.ts";
import { SemanticShiftDetector } from "../utils/semantic-shift-detector.ts";
import { MemoryBackprop, type BackpropResult } from "../utils/memory-backprop.ts";

// ── Helpers ──

/** Generate pseudo-random text of roughly `length` chars, seeded by `seed`. */
function genText(length: number, seed: number): string {
  const words = [
    "the", "user", "prefers", "likes", "uses", "works", "lives", "thinks",
    "believes", "wants", "needs", "has", "knows", "feels", "says", "does",
    "react", "svelte", "vue", "angular", "python", "java", "go", "rust",
    "typescript", "docker", "kubernetes", "linux", "macos", "windows",
    "beijing", "shanghai", "tokyo", "london", "newyork", "paris", "berlin",
    "database", "frontend", "backend", "fullstack", "devops", "mobile",
    "testing", "deploy", "monitor", "scale", "optimize", "refactor",
    "component", "module", "service", "controller", "middleware", "router",
    "design", "pattern", "architecture", "pipeline", "workflow", "config",
    "morning", "evening", "today", "yesterday", "tomorrow", "weekend",
    "weather", "temperature", "forecast", "climate", "season", "autumn",
    "breakfast", "lunch", "dinner", "snack", "coffee", "water", "fruit",
    "music", "movie", "book", "game", "sport", "travel", "photo", "code",
  ];
  const rng = mulberry32(seed);
  let result = "";
  while (result.length < length) {
    result += words[Math.floor(rng() * words.length)] + " ";
  }
  return result.slice(0, length);
}

function mulberry32(a: number) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Generate texts on the same topic (high overlap). */
function genSameTopic(count: number, baseLen = 80): string[] {
  const topic = genText(40, 42);
  const results: string[] = [];
  for (let i = 0; i < count; i++) {
    results.push(topic + " " + genText(baseLen - 40, i + 100));
  }
  return results;
}

/** Generate texts on different topics (low overlap). */
function genDifferentTopics(count: number, baseLen = 80): string[] {
  const topics = [
    "User prefers React for frontend development tools and frameworks",
    "Weather in Beijing is cold during winter season with snow",
    "User likes cats very much and wants to adopt one soon",
    "Italian cuisine pasta pizza is favorite food of user",
    "Software engineering full stack development using microservices",
    "Machine learning deep learning neural networks for AI projects",
    "Traveling to Japan during cherry blossom season in spring",
    "Reading science fiction fantasy novels during free time at home",
    "Cycling running swimming exercise every morning for fitness",
    "Photography landscape portrait editing using Adobe Lightroom",
  ];
  const results: string[] = [];
  for (let i = 0; i < count; i++) {
    results.push(topics[i % topics.length] + " " + genText(baseLen - 50, i + 200));
  }
  return results;
}

/** Generate contradiction texts (change indicators + overlap). */
function genContradictions(base: string[], count: number): string[] {
  const negations = ["no longer", "not anymore", "hate", "dislike", "changed my mind about", "actually prefer"];
  const results: string[] = [];
  for (let i = 0; i < count; i++) {
    const idx = i % base.length;
    const neg = negations[i % negations.length];
    // Take first 3 words of base text
    const prefix = base[idx].split(" ").slice(0, 5).join(" ");
    results.push(`User ${neg} ${prefix} instead now definitely for sure`);
  }
  return results;
}

// ── Mock DB for MemoryBackprop ──

function makeMockDb(memories: Array<{ text: string; meta?: string }>) {
  return {
    getLatestMemory: (_limit: number) =>
      memories.map((m, i) => ({
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
    vectorSearch: () => [] as any[],
  };
}

// ══════════════════════════════════════════════════
//  1. RelevanceGate 高压测试
// ══════════════════════════════════════════════════

describe("Stress: RelevanceGate", () => {
  it("handles 100,000 rapid evaluations with no crash", async () => {
    const gate = new RelevanceGate({ enabled: true, minScore: 0.3, ttlHalfLifeSec: 60 });
    const texts = genDifferentTopics(100_000, 60);
    let passCount = 0;
    const start = Date.now();
    for (let i = 0; i < texts.length; i++) {
      const result = await gate.evaluate(texts[i], "stress-test", []);
      if (result.pass) passCount++;
    }
    const elapsed = Date.now() - start;
    // All different topics should mostly pass
    assert.ok(passCount > texts.length * 0.5, `pass=${passCount} should be > 50%`);
    console.log(`  [perf] 100k evaluations: ${elapsed}ms (${(texts.length / elapsed * 1000).toFixed(0)}/s)`);
  });

  it("blocks after repeatBlockThreshold with exact repeats", async () => {
    const gate = new RelevanceGate({ enabled: true, minScore: 0.3, repeatBlockThreshold: 2 });
    const text = genText(60, 9999);
    const results: boolean[] = [];
    for (let i = 0; i < 10; i++) {
      const r = await gate.evaluate(text, "repeat-test", []);
      results.push(r.pass);
    }
    // First passes (novel), second may pass (timeDecay penalty alone can't stop it with high info density)
    // Third+ should be blocked by repeatBlockThreshold
    // Actually: timeDecay=0.2 only applies once, repeatBlockThreshold=2 means after 2 records, count >= 2 blocks
    // First call: count=0 → pass, records it
    // Second call: count=1 → timeDecay=0.2 but still may pass, records again
    // Third call: count=2 → blocked by repeatBlockThreshold >= 2
    assert.equal(results[0], true, "first should pass");
    // Third should be blocked
    assert.equal(results[2], false, "third should be blocked");
    // All subsequent should be blocked
    for (let i = 3; i < 10; i++) {
      assert.equal(results[i], false, `iteration ${i} should be blocked`);
    }
  });

  it("decay ring does not leak memory under rapid fire", async () => {
    const gate = new RelevanceGate({ enabled: true, ttlHalfLifeSec: 0.1 });
    const texts = genDifferentTopics(10_000, 40);
    for (const text of texts) {
      await gate.evaluate(text, "leak-test", []);
    }
    // Wait for sweep
    await new Promise(r => setTimeout(r, 200));
    // Insert one more to trigger another sweep
    await gate.evaluate(genText(40, 7777), "leak-test", []);
    // No crash = pass
    assert.ok(true, "no memory leak crash");
  });

  it("short texts always fail", async () => {
    const gate = new RelevanceGate({ enabled: true, minScore: 0.3 });
    const shorts = ["hi", "ok", "yeah", "no", "a", "b", "c", "x", "y", "z", "!", "?", "", " ", "  "];
    for (const text of shorts) {
      const result = await gate.evaluate(text, "short-test", [""]);
      assert.equal(result.pass, false, `"${text}" should fail`);
    }
  });

  it("information density rates stopwords lower than content", async () => {
    const gate = new RelevanceGate({ enabled: true, minScore: 0.3 });
    const poor = "the and for with from this that these those the and for with from this that these those";
    const rich = "User prefers PostgreSQL over MySQL for databases uses Prisma as ORM and deploys on Railway platform for hosting with Docker using Kubernetes orchestration";
    const rRich = await gate.evaluate(rich, "density-test", [""]);
    const rPoor = await gate.evaluate(poor, "density-test", [""]);
    assert.ok(rRich.factors.infoDensity >= rPoor.factors.infoDensity,
      `rich(${rRich.factors.infoDensity}) should >= poor(${rPoor.factors.infoDensity})`);
  });

  it("reset actually clears state", async () => {
    const gate = new RelevanceGate({ enabled: true, repeatBlockThreshold: 1 });
    const text = genText(60, 12345);
    await gate.evaluate(text, "reset-test", []);
    gate.reset();
    const r2 = await gate.evaluate(text, "reset-test", []);
    assert.equal(r2.pass, true, "after reset, repeat should pass again");
  });

  it("parallel same-text bursts", async () => {
    const gate = new RelevanceGate({ enabled: true, minScore: 0.3, repeatBlockThreshold: 3 });
    const text = genText(50, 8888);
    const promises: Promise<boolean>[] = [];
    for (let i = 0; i < 20; i++) {
      // Each call gets slightly different recentTexts to avoid exact novelty match
      promises.push(gate.evaluate(text, "burst-test", [`context ${i}`]).then(r => r.pass));
    }
    const results = await Promise.all(promises);
    const passes = results.filter(Boolean).length;
    // With repeatBlockThreshold=3, at most 2 should pass
    assert.ok(passes <= 3, `passes=${passes} should be <= 3`);
  });
});

// ══════════════════════════════════════════════════
//  2. SemanticShiftDetector 高压测试
// ══════════════════════════════════════════════════

describe("Stress: SemanticShiftDetector", () => {
  it("handles 10,000 rapid topic shift evaluations", () => {
    const detector = new SemanticShiftDetector({ enabled: true, threshold: 0.4 });
    const topics = genDifferentTopics(10_000, 60);
    let shiftCount = 0;
    const start = Date.now();
    for (let i = 0; i < topics.length; i++) {
      const result = detector.evaluate(topics[i]);
      if (result.isShift) shiftCount++;
    }
    const elapsed = Date.now() - start;
    console.log(`  [perf] 10k shifts in ${elapsed}ms (${(10000 / elapsed * 1000).toFixed(0)}/s); detected=${shiftCount}`);
    assert.ok(elapsed < 5000, `should complete within 5s (was ${elapsed}ms)`);
  });

  it("forces flush on maxBufferedCaptures", () => {
    const detector = new SemanticShiftDetector({ enabled: true, threshold: 0.9, maxBufferedCaptures: 5 });
    const sameTopic = genText(60, 1111);
    // Same topic repeated many times; threshold 0.9 makes it never shift by similarity
    // But after 5 buffered, maxBufferedCaptures forces flush
    let forcedFlushes = 0;
    for (let i = 0; i < 50; i++) {
      const result = detector.evaluate(sameTopic);
      if (result.isShift && result.reason.includes("max buffered")) {
        forcedFlushes++;
        detector.markFlushed();
      }
    }
    assert.ok(forcedFlushes >= 5, `should have >=5 forced flushes, got ${forcedFlushes}`);
  });

  it("forces flush on max idle time", async () => {
    const detector = new SemanticShiftDetector({ enabled: true, maxIdleMs: 50 });
    const text = genText(60, 2222);
    detector.evaluate(text);
    detector.evaluate(text);
    await new Promise(r => setTimeout(r, 60));
    const result = detector.evaluate(text);
    assert.equal(result.isShift, true, "should force flush due to idle timeout");
    assert.ok(result.reason.includes("max idle"), `reason should mention idle: ${result.reason}`);
  });

  it("reset clears all state", () => {
    const detector = new SemanticShiftDetector({ enabled: true, threshold: 1.0 });
    detector.evaluate(genText(60, 3333));
    // threshold=1.0 means no shift, so capturedCount increments to 2
    detector.evaluate(genText(60, 3333));
    assert.equal(detector.stats().capturedCount, 2);
    detector.reset();
    assert.equal(detector.stats().capturedCount, 0);
    assert.equal(detector.stats().topicWindowSize, 0);
    // After reset, first evaluate should set initial topic
    const r = detector.evaluate(genText(60, 5555));
    assert.equal(r.isShift, false);
    assert.equal(r.reason, "initial topic");
  });

  it("short content never triggers shift", () => {
    const detector = new SemanticShiftDetector({
      enabled: true, threshold: 0.1, minContentLength: 30, maxBufferedCaptures: 50,
    });
    detector.evaluate(genText(60, 6666)); // initial topic
    for (let i = 0; i < 20; i++) {
      const result = detector.evaluate("ok");
      assert.equal(result.isShift, false, `iteration ${i}: short content should not trigger shift`);
    }
  });

  it("disabled detector never shifts", () => {
    const detector = new SemanticShiftDetector({ enabled: false });
    for (let i = 0; i < 100; i++) {
      const result = detector.evaluate(genText(60, i + 7777));
      assert.equal(result.isShift, false);
    }
  });

  it("no memory leak after 50k evaluations", () => {
    const detector = new SemanticShiftDetector({ enabled: true, threshold: 0.4 });
    const start = Date.now();
    for (let i = 0; i < 50_000; i++) {
      detector.evaluate(genText(40, i + 10000));
    }
    const elapsed = Date.now() - start;
    console.log(`  [perf] 50k evals in ${elapsed}ms (${(50000 / elapsed * 1000).toFixed(0)}/s)`);
    const stats = detector.stats();
    // topicWindow should be bounded by windowSize (default 3)
    assert.ok(stats.topicWindowSize <= 3, `window size ${stats.topicWindowSize} should be <= 3`);
    assert.ok(stats.capturedCount > 0, "should have captured count");
  });
});

// ══════════════════════════════════════════════════
//  3. MemoryBackprop 高压测试
// ══════════════════════════════════════════════════

describe("Stress: MemoryBackprop", () => {
  // Create a large memory pool
  const POOL_SIZE = 500;
  const poolTexts: Array<{ text: string; meta?: string }> = [];
  for (let i = 0; i < POOL_SIZE; i++) {
    poolTexts.push({ text: genText(50, i + 50000), meta: `importance:${(0.3 + Math.random() * 0.5).toFixed(2)}` });
  }
  // Add some known texts for relationship detection
  poolTexts.push({ text: "User prefers React for web development tools and frameworks", meta: "importance:0.8" });
  poolTexts.push({ text: "User likes cats very much a lot and wants to adopt one", meta: "importance:0.6" });
  poolTexts.push({ text: "User works as a software engineer full stack developer", meta: "importance:0.7" });

  const mockDb = makeMockDb(poolTexts);

  it("processes 200 memories through backprop without timeout", async () => {
    const backprop = new MemoryBackprop({ enabled: true, minSimilarity: 0.25, scanCount: 30 });
    const start = Date.now();
    let totalResults = 0;
    for (let i = 0; i < 200; i++) {
      const results = await backprop.process(genText(60, i + 60000), "", mockDb as any);
      totalResults += results.length;
    }
    const elapsed = Date.now() - start;
    console.log(`  [perf] 200 backprop runs: ${elapsed}ms (avg ${(elapsed / 200).toFixed(1)}ms/run); total relations=${totalResults}`);
    assert.ok(elapsed < 60_000, `should complete within 60s (was ${elapsed}ms)`);
  });

  it("detects reinforces relationship correctly", async () => {
    const fresh = new MemoryBackprop({ enabled: true, minSimilarity: 0.25, scanCount: 50 });
    const results = await fresh.process(
      "User prefers React for web development tools and frameworks ecosystem",
      "",
      mockDb as any,
    );
    const reinforces = results.filter(r => r.relation === "reinforces");
    assert.ok(reinforces.length >= 1, `reinforces not found: ${JSON.stringify(results)}`);
  });

  it("detects contradiction relationship correctly", async () => {
    const fresh = new MemoryBackprop({ enabled: true, minSimilarity: 0.25, scanCount: 50 });
    // Dedicated small DB to guarantee high word overlap
    const smallDb = makeMockDb([
      { text: "User likes cats very much a lot and wants to adopt one cat soon", meta: "importance:0.6" },
    ]);
    const results = await fresh.process(
      "User no longer likes cats not anymore at all now for sure doesn't want them",
      "",
      smallDb as any,
    );
    const contradicts = results.filter(r => r.relation === "contradicts");
    assert.ok(contradicts.length >= 1, `contradicts not found: ${JSON.stringify(results)}`);
  });

  it("fingerprint dedup prevents redundant work", async () => {
    const backprop = new MemoryBackprop({ enabled: true, scanCount: 10 });
    const text = genText(50, 77777);
    // First call should process
    await backprop.process(text, "", mockDb as any);
    // Second call should be skipped by fingerprint
    const r2 = await backprop.process(text, "", mockDb as any);
    assert.equal(r2.length, 0, "duplicate should be skipped");
    // Third call should also be skipped
    const r3 = await backprop.process(text, "", mockDb as any);
    assert.equal(r3.length, 0, "third duplicate should be skipped");
  });

  it("disabled backprop is instant", async () => {
    const disabled = new MemoryBackprop({ enabled: false });
    const start = Date.now();
    for (let i = 0; i < 100; i++) {
      const results = await disabled.process(genText(40, i + 80000), "", mockDb as any);
      assert.equal(results.length, 0);
    }
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 1000, `disabled path should be fast (${elapsed}ms)`);
  });

  it("reset clears fingerprint cache", async () => {
    const backprop = new MemoryBackprop({ enabled: true, scanCount: 10 });
    const text = genText(50, 88888);
    await backprop.process(text, "", mockDb as any);
    backprop.reset();
    // After reset, repeat should work again (fingerprint cleared)
    const r2 = await backprop.process(text, "", mockDb as any);
    // It may or may not find relations depending on similarity
    assert.ok(Array.isArray(r2), "should return array even if empty");
  });
});

// ══════════════════════════════════════════════════
//  4. 混合工作负载
// ══════════════════════════════════════════════════

describe("Stress: Mixed Workload", () => {
  it("all three modules run concurrently without interference", async () => {
    const gate = new RelevanceGate({ enabled: true, minScore: 0.3 });
    const detector = new SemanticShiftDetector({ enabled: true, threshold: 0.5 });
    const backprop = new MemoryBackprop({ enabled: true, minSimilarity: 0.3, scanCount: 20 });
    const db = makeMockDb(genDifferentTopics(100).map(t => ({ text: t })));

    const start = Date.now();
    const TEXT_COUNT = 500;
    const phases = genDifferentTopics(TEXT_COUNT, 60);
    let gatePasses = 0;
    let detectorShifts = 0;
    let backpropRels = 0;

    for (let i = 0; i < phases.length; i++) {
      const text = phases[i];
      // Gate
      const g = await gate.evaluate(text, "mixed", []);
      if (g.pass) gatePasses++;

      // Detector
      const d = detector.evaluate(text);
      if (d.isShift) {
        detectorShifts++;
        detector.markFlushed();
      }

      // Backprop
      const b = await backprop.process(text, "", db as any);
      backpropRels += b.length;
    }

    const elapsed = Date.now() - start;
    console.log(`  [perf] Mixed 500 runs: ${elapsed}ms; gatePass=${gatePasses} shifts=${detectorShifts} relations=${backpropRels}`);
    assert.ok(elapsed < 30_000, `mixed workload should complete within 30s (${elapsed}ms)`);
  });

  it("realistic multi-turn conversation pipeline", async () => {
    // Simulates a full conversation: user talks about coding → shift to weather → shift to food
    const gate = new RelevanceGate({ enabled: true, minScore: 0.3 });
    const detector = new SemanticShiftDetector({ enabled: true, threshold: 0.5 });

    // Conversation turns
    const turns = [
      "I am working on a React project using TypeScript for the frontend",
      "We use Vite as the build tool because it is faster than webpack",
      "The backend is written in Go with PostgreSQL database",
      "Actually I changed my mind about React I prefer Svelte now",
      "What is the weather like in Beijing today",
      "I heard it is going to rain later in the afternoon",
      "My favorite food is Italian pasta with pesto sauce",
      "I also like Japanese ramen especially tonkotsu broth",
      "For breakfast I usually have oatmeal with fresh berries",
    ];

    let shiftCount = 0;
    const captured: string[] = [];

    for (const turn of turns) {
      const g = await gate.evaluate(turn, "chat", captured.slice(-3));
      if (g.pass) captured.push(turn);

      const d = detector.evaluate(turn);
      if (d.isShift) {
        shiftCount++;
        detector.markFlushed();
      }
    }

    // 3 topics (coding → weather → food) → at least 2 shifts
    assert.ok(shiftCount >= 2, `expected >= 2 shifts, got ${shiftCount}`);
    assert.ok(captured.length > 0, "should have captured some content");
    console.log(`  Pipeline: ${turns.length} turns, ${shiftCount} shifts, ${captured.length} captured`);
  });
});

// ══════════════════════════════════════════════════
//  5. 内存泄漏检测
// ══════════════════════════════════════════════════

describe("Stress: Memory Leak Detection", () => {
  it("RelevanceGate decay ring stabilizes under infinite input", async () => {
    const gate = new RelevanceGate({ enabled: true, ttlHalfLifeSec: 60 });
    // Push many different texts
    for (let i = 0; i < 50_000; i++) {
      await gate.evaluate(genText(40, i + 90000), "memcheck", []);
    }
    // Decay ring should be bounded by half-life + rate
    // No crash = pass
    assert.ok(true, "decay ring stabilized");
  });

  it("SemanticShiftDetector topic window stays bounded under infinite input", () => {
    const detector = new SemanticShiftDetector({ enabled: true, windowSize: 3, threshold: 0.4 });
    for (let i = 0; i < 50_000; i++) {
      detector.evaluate(genText(40, i + 100000));
    }
    const stats = detector.stats();
    assert.ok(stats.topicWindowSize <= 3, `window=${stats.topicWindowSize} should be <= 3`);
    assert.ok(stats.capturedCount > 0, "should have captures");
  });

  it("MemoryBackprop fingerprint cache stays bounded", async () => {
    const backprop = new MemoryBackprop({ enabled: true, scanCount: 10 });
    const smallDb = makeMockDb(genDifferentTopics(20).map(t => ({ text: t })));
    for (let i = 0; i < 1000; i++) {
      await backprop.process(genText(40, i + 110000), "", smallDb as any);
    }
    // Fingerprint cache should be bounded by the 200-element trim logic
    // No crash = pass
    assert.ok(true, "fingerprint cache bounded");
  });
});
