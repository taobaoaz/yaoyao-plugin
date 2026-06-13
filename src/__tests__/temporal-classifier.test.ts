/**
 * Tests for temporal-classifier.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { classifyTemporal, inferExpiry } from "../utils/temporal-classifier.ts";

describe("classifyTemporal", () => {
  it("classifies permanent facts as static", () => {
    assert.strictEqual(classifyTemporal("My name is John"), "static");
    assert.strictEqual(classifyTemporal("我喜欢吃寿司"), "static");
    assert.strictEqual(classifyTemporal("毕业于清华大学"), "static");
  });

  it("classifies time-sensitive info as dynamic", () => {
    assert.strictEqual(classifyTemporal("今天天气很好"), "dynamic");
    assert.strictEqual(classifyTemporal("I will do it tomorrow"), "dynamic");
    assert.strictEqual(classifyTemporal("昨天去了医院"), "dynamic");
  });

  it("dynamic wins when both match", () => {
    assert.strictEqual(classifyTemporal("I always go to the gym today"), "dynamic");
  });

  it("defaults to static when no keywords match", () => {
    assert.strictEqual(classifyTemporal("Some random text here"), "static");
  });
});

describe("inferExpiry", () => {
  it("infers expiry for 'tomorrow'", () => {
    const now = Date.now();
    const expiry = inferExpiry("I will do it tomorrow", now);
    assert.ok(expiry !== undefined);
    assert.ok(expiry! > now);
    assert.ok(expiry! <= now + 25 * 60 * 60 * 1000); // ~24h
  });

  it("infers expiry for '今天'", () => {
    const now = Date.now();
    const expiry = inferExpiry("今天天气很好", now);
    assert.ok(expiry !== undefined);
    assert.ok(expiry! > now);
  });

  it("returns undefined for no temporal expression", () => {
    assert.strictEqual(inferExpiry("Some random text"), undefined);
  });
});
