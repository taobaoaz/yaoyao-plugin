import { describe, it } from "node:test";
import assert from "node:assert";
import { convertHumanToCron } from "../core/remind/cron.ts";

describe("convertHumanToCron", () => {
  it("parses Chinese daily times with fixed minute offset", () => {
    assert.strictEqual(convertHumanToCron("每天8点", 0), "00 08 * * *");
    assert.strictEqual(convertHumanToCron("每天下午3点", 0), "00 15 * * *");
  });

  it("applies minute offset when > 0", () => {
    const result = convertHumanToCron("每天8点", 10);
    assert.ok(/^\d{2} 08 \* \* \*$/.test(result || ""));
    const minute = Number(result!.split(" ")[0]);
    assert.ok(minute >= 0 && minute <= 10);
  });

  it("parses weekly patterns", () => {
    assert.strictEqual(convertHumanToCron("每周一9点", 0), "00 09 * * 1");
    assert.strictEqual(convertHumanToCron("每周五晚上8点", 0), "00 20 * * 5");
  });

  it("parses interval patterns", () => {
    assert.strictEqual(convertHumanToCron("每2小时", 0), "0 */2 * * *");
    assert.strictEqual(convertHumanToCron("每小时", 0), "00 * * * *");
  });

  it("returns null for unknown patterns", () => {
    assert.strictEqual(convertHumanToCron("foo bar"), null);
    assert.strictEqual(convertHumanToCron(""), null);
  });

  it("returns null for already-cron strings", () => {
    // The function does not pass-through; it returns null for non-Chinese patterns
    assert.strictEqual(convertHumanToCron("0 8 * * *"), null);
  });
});
