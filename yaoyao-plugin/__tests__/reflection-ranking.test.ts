/**
 * Tests for reflection-ranking.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  computeReflectionLogistic,
  computeReflectionScore,
  normalizeReflectionLineForAggregation,
  computePresetReflectionScore,
} from '../utils/reflection-ranking.ts';

describe('computeReflectionLogistic', () => {
  it('returns 1.0 at age 0', () => {
    const score = computeReflectionLogistic(0, 30, 0.1);
    assert.ok(score > 0.95, `expected ~1.0, got ${score}`);
  });
  it('returns ~0.5 at midpoint', () => {
    const score = computeReflectionLogistic(30, 30, 0.1);
    assert.ok(score > 0.48 && score < 0.52, `expected ~0.5, got ${score}`);
  });
  it('approaches 0 at large age', () => {
    const score = computeReflectionLogistic(300, 30, 0.1);
    assert.ok(score < 0.1, `expected < 0.1, got ${score}`);
  });
  it('handles invalid inputs gracefully', () => {
    assert.strictEqual(
      computeReflectionLogistic(NaN, NaN, NaN),
      computeReflectionLogistic(0, 1, 0.1),
    );
  });
});

describe('computeReflectionScore', () => {
  it('combines all factors', () => {
    const score = computeReflectionScore({
      ageDays: 0,
      midpointDays: 30,
      k: 0.1,
      baseWeight: 2,
      quality: 0.5,
      usedFallback: false,
    });
    assert.ok(score > 0.9, `expected high score, got ${score}`);
  });
  it('applies fallback penalty', () => {
    const normal = computeReflectionScore({
      ageDays: 0,
      midpointDays: 30,
      k: 0.1,
      baseWeight: 1,
      quality: 1,
      usedFallback: false,
    });
    const fallback = computeReflectionScore({
      ageDays: 0,
      midpointDays: 30,
      k: 0.1,
      baseWeight: 1,
      quality: 1,
      usedFallback: true,
    });
    assert.ok(fallback < normal, 'fallback should reduce score');
  });
});

describe('normalizeReflectionLineForAggregation', () => {
  it('normalizes whitespace and case', () => {
    assert.strictEqual(normalizeReflectionLineForAggregation('  Hello   WORLD  '), 'hello world');
  });
});

describe('computePresetReflectionScore', () => {
  it('invariant decays slower than derived', () => {
    const inv = computePresetReflectionScore('invariant', 10);
    const derived = computePresetReflectionScore('derived', 10);
    assert.ok(inv > derived, 'invariant should score higher than derived at same age');
  });
});
