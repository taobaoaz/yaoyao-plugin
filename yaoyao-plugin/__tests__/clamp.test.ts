import { describe, it } from 'node:test';
import assert from 'node:assert';
import { clampNum } from '../utils/clamp.ts';

describe('clampNum', () => {
  it('returns the exact value when inside range', () => {
    assert.strictEqual(clampNum(5, 10, 1, 100), 5);
    assert.strictEqual(clampNum(50, 10, 1, 100), 50);
    assert.strictEqual(clampNum(99, 10, 1, 100), 99);
  });

  it('returns default for null, undefined, NaN', () => {
    assert.strictEqual(clampNum(null, 10, 1, 100), 10);
    assert.strictEqual(clampNum(undefined, 10, 1, 100), 10);
    assert.strictEqual(clampNum(NaN, 10, 1, 100), 10);
    // Empty string coerces to 0 via Number("") = 0, then clamped to min=1
    assert.strictEqual(clampNum('', 10, 1, 100), 1);
  });

  it('returns default for non-numeric strings', () => {
    assert.strictEqual(clampNum('foo', 10, 1, 100), 10);
    assert.strictEqual(clampNum('abc', 10, 1, 100), 10);
  });

  it('clamps to min', () => {
    assert.strictEqual(clampNum(-5, 10, 1, 100), 1);
    assert.strictEqual(clampNum(0, 10, 5, 100), 5);
    assert.strictEqual(clampNum(0.5, 10, 1, 100), 1);
  });

  it('clamps to max', () => {
    assert.strictEqual(clampNum(150, 10, 1, 100), 100);
    assert.strictEqual(clampNum(1_000_000, 10, 1, 100), 100);
  });

  it('parses string numbers', () => {
    assert.strictEqual(clampNum('42', 10, 1, 100), 42);
    assert.strictEqual(clampNum('3.14', 10, 1, 100), 3.14);
    assert.strictEqual(clampNum('999', 10, 1, 100), 100);
  });

  it('handles boolean coercion (true=1, false=0)', () => {
    assert.strictEqual(clampNum(true, 10, 1, 100), 1);
    assert.strictEqual(clampNum(false, 10, 1, 100), 1);
  });

  it('handles negative default and negative min', () => {
    assert.strictEqual(clampNum(null, -5, -10, -1), -5);
    assert.strictEqual(clampNum(-20, -5, -10, -1), -10);
    assert.strictEqual(clampNum(0, -5, -10, -1), -1);
  });

  it('handles float ranges', () => {
    assert.strictEqual(clampNum(0.05, 0.5, 0.1, 1.0), 0.1);
    assert.strictEqual(clampNum(1.5, 0.5, 0.1, 1.0), 1.0);
  });

  it('handles zero default', () => {
    assert.strictEqual(clampNum(null, 0, -10, 10), 0);
  });
});
