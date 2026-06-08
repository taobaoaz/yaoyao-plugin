/**
 * Tests for support-info.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  normalizeContext,
  parseSupportInfo,
  updateSupportStats,
  MAX_SUPPORT_SLICES,
} from '../utils/support-info.ts';

describe('normalizeContext', () => {
  it('returns general for empty', () => {
    assert.strictEqual(normalizeContext(undefined), 'general');
    assert.strictEqual(normalizeContext(''), 'general');
  });

  it('matches vocabulary directly', () => {
    assert.strictEqual(normalizeContext('morning'), 'morning');
    assert.strictEqual(normalizeContext('work'), 'work');
  });

  it('maps Chinese aliases', () => {
    assert.strictEqual(normalizeContext('早上'), 'morning');
    assert.strictEqual(normalizeContext('晚上'), 'evening');
    assert.strictEqual(normalizeContext('周末'), 'weekend');
  });

  it('keeps custom context', () => {
    assert.strictEqual(normalizeContext('custom-context'), 'custom-context');
  });
});

describe('parseSupportInfo', () => {
  it('returns defaults for null', () => {
    const info = parseSupportInfo(null);
    assert.strictEqual(info.global_strength, 0.5);
    assert.strictEqual(info.total_observations, 0);
    assert.deepStrictEqual(info.slices, []);
  });

  it('parses V2 format', () => {
    const raw = {
      global_strength: 0.8,
      total_observations: 10,
      slices: [
        {
          context: 'work',
          confirmations: 5,
          contradictions: 1,
          strength: 0.83,
          last_observed_at: 1700000000000,
        },
      ],
    };
    const info = parseSupportInfo(raw);
    assert.strictEqual(info.global_strength, 0.8);
    assert.strictEqual(info.slices.length, 1);
    assert.strictEqual(info.slices[0].context, 'work');
  });

  it('migrates V1 format', () => {
    const raw = { confirmations: 3, contradictions: 1, strength: 0.75 };
    const info = parseSupportInfo(raw);
    assert.strictEqual(info.total_observations, 4);
    assert.strictEqual(info.slices.length, 1);
    assert.strictEqual(info.slices[0].context, 'general');
    assert.strictEqual(info.slices[0].strength, 0.75);
  });
});

describe('updateSupportStats', () => {
  it('adds support event', () => {
    const updated = updateSupportStats(
      { global_strength: 0.5, total_observations: 0, slices: [] },
      'work',
      'support',
    );
    assert.strictEqual(updated.slices.length, 1);
    assert.strictEqual(updated.slices[0].confirmations, 1);
    assert.strictEqual(updated.slices[0].contradictions, 0);
    assert.strictEqual(updated.total_observations, 1);
  });

  it('adds contradict event', () => {
    const updated = updateSupportStats(
      { global_strength: 0.5, total_observations: 0, slices: [] },
      'morning',
      'contradict',
    );
    assert.strictEqual(updated.slices[0].confirmations, 0);
    assert.strictEqual(updated.slices[0].contradictions, 1);
    assert.strictEqual(updated.slices[0].strength, 0);
  });

  it('updates existing slice', () => {
    const base = {
      global_strength: 0.5,
      total_observations: 1,
      slices: [
        {
          context: 'work',
          confirmations: 1,
          contradictions: 0,
          strength: 1,
          last_observed_at: 1700000000000,
        },
      ],
    };
    const updated = updateSupportStats(base, 'work', 'contradict');
    assert.strictEqual(updated.slices[0].confirmations, 1);
    assert.strictEqual(updated.slices[0].contradictions, 1);
    assert.strictEqual(updated.slices[0].strength, 0.5);
    assert.strictEqual(updated.total_observations, 2);
  });

  it('caps slices at MAX_SUPPORT_SLICES', () => {
    let info = { global_strength: 0.5, total_observations: 0, slices: [] };
    for (let i = 0; i < MAX_SUPPORT_SLICES + 3; i++) {
      info = updateSupportStats(info, `ctx-${i}`, 'support');
    }
    assert.strictEqual(info.slices.length, MAX_SUPPORT_SLICES);
    // total_observations includes dropped evidence from current truncation round only;
    // evidence from previous rounds is baked into global_strength (Brain design trade-off)
    assert.ok(info.total_observations >= MAX_SUPPORT_SLICES);
  });
});
