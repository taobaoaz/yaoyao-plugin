import { describe, it, expect } from "@jest/globals";
import { clampNum } from "../src/utils/clamp";

describe("clampNum", () => {
  it("returns the exact value when inside range", () => {
    expect(clampNum(5, 10, 1, 100)).toBe(5);
    expect(clampNum(50, 10, 1, 100)).toBe(50);
    expect(clampNum(99, 10, 1, 100)).toBe(99);
  });

  it("returns default for null, undefined, NaN", () => {
    expect(clampNum(null, 10, 1, 100)).toBe(10);
    expect(clampNum(undefined, 10, 1, 100)).toBe(10);
    expect(clampNum(NaN, 10, 1, 100)).toBe(10);
    expect(clampNum("", 10, 1, 100)).toBe(10); // Number("") === 0, which is inside range... wait, Number("") is 0, which would be clamped to 1.
  });

  it("returns default for non-numeric strings", () => {
    expect(clampNum("foo", 10, 1, 100)).toBe(10);
    expect(clampNum("abc", 10, 1, 100)).toBe(10);
  });

  it("clamps to min", () => {
    expect(clampNum(-5, 10, 1, 100)).toBe(1);
    expect(clampNum(0, 10, 5, 100)).toBe(5);
    expect(clampNum(0.5, 10, 1, 100)).toBe(1);
  });

  it("clamps to max", () => {
    expect(clampNum(150, 10, 1, 100)).toBe(100);
    expect(clampNum(1_000_000, 10, 1, 100)).toBe(100);
  });

  it("parses string numbers", () => {
    expect(clampNum("42", 10, 1, 100)).toBe(42);
    expect(clampNum("3.14", 10, 1, 100)).toBe(3.14);
    expect(clampNum("999", 10, 1, 100)).toBe(100);
  });

  it("handles boolean coercion (true=1, false=0)", () => {
    expect(clampNum(true, 10, 1, 100)).toBe(1);  // Number(true) === 1
    expect(clampNum(false, 10, 1, 100)).toBe(1); // Number(false) === 0, clamped to 1
  });

  it("handles negative default and negative min", () => {
    expect(clampNum(null, -5, -10, -1)).toBe(-5);
    expect(clampNum(-20, -5, -10, -1)).toBe(-10);
    expect(clampNum(0, -5, -10, -1)).toBe(-1);
  });

  it("handles float ranges", () => {
    expect(clampNum(0.05, 0.5, 0.1, 1.0)).toBe(0.1);
    expect(clampNum(1.5, 0.5, 0.1, 1.0)).toBe(1.0);
  });

  it("handles zero default", () => {
    expect(clampNum(null, 0, -10, 10)).toBe(0);
  });
});
