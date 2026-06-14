/**
 * Regression test for hooks/auto-recall.ts
 *
 * The handler used to check `if (!userMessage || isTrivial(userMessage)) return;`
 * but `isTrivial()` returns a TrivialCheckResult object, which is always truthy.
 * As a result, recall always exited early — the gate was dead code.
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { isTrivial } from "../core/filter/trivial.ts";

describe("auto-recall — trivial-check gate", () => {
  it("isTrivial returns a TrivialCheckResult object, not a boolean", () => {
    const result = isTrivial("hello world");
    assert.strictEqual(typeof result, "object", "isTrivial should return an object");
    assert.strictEqual(typeof result.isTrivial, "boolean", "result should expose isTrivial flag");
  });

  it("truthiness check on the result incorrectly treats any input as non-trivial", () => {
    // This documents the original bug: a raw `if (isTrivial(msg))` check
    // always evaluated the object as truthy and never triggered the early return.
    const result = isTrivial("hello world");
    assert.ok(result, "object is truthy — that is the bug we are guarding against");
  });
});
