/**
 * Tests for access-tracker.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  parseAccessMetadata,
  buildUpdatedMetadata,
  computeEffectiveHalfLife,
} from '../utils/access-tracker.ts';

describe('parseAccessMetadata', () => {
  it('parses valid metadata', () => {
    const meta = JSON.stringify({ accessCount: 5, lastAccessedAt: 1700000000000 });
    const parsed = parseAccessMetadata(meta);
    assert.strictEqual(parsed.accessCount, 5);
    assert.strictEqual(parsed.lastAccessedAt, 1700000000000);
  });

  it('returns defaults for undefined', () => {
    const parsed = parseAccessMetadata(undefined);
    assert.strictEqual(parsed.accessCount, 0);
    assert.strictEqual(parsed.lastAccessedAt, 0);
  });

  it('returns defaults for empty string', () => {
    const parsed = parseAccessMetadata('');
    assert.strictEqual(parsed.accessCount, 0);
    assert.strictEqual(parsed.lastAccessedAt, 0);
  });

  it('returns defaults for malformed JSON', () => {
    const parsed = parseAccessMetadata('{broken');
    assert.strictEqual(parsed.accessCount, 0);
    assert.strictEqual(parsed.lastAccessedAt, 0);
  });

  it('clamps excessive accessCount', () => {
    const meta = JSON.stringify({ accessCount: 999999 });
    const parsed = parseAccessMetadata(meta);
    assert.strictEqual(parsed.accessCount, 10000);
  });
});

describe('buildUpdatedMetadata', () => {
  it('increments accessCount', () => {
    const meta = JSON.stringify({ accessCount: 3, lastAccessedAt: 1700000000000 });
    const updated = buildUpdatedMetadata(meta, 1);
    const parsed = JSON.parse(updated);
    assert.strictEqual(parsed.accessCount, 4);
    assert.ok(parsed.lastAccessedAt > 1700000000000);
  });

  it('preserves other fields', () => {
    const meta = JSON.stringify({ importance: 0.8, accessCount: 1 });
    const updated = buildUpdatedMetadata(meta, 2);
    const parsed = JSON.parse(updated);
    assert.strictEqual(parsed.importance, 0.8);
    assert.strictEqual(parsed.accessCount, 3);
  });

  it('handles undefined metadata', () => {
    const updated = buildUpdatedMetadata(undefined, 1);
    const parsed = JSON.parse(updated);
    assert.strictEqual(parsed.accessCount, 1);
  });
});

describe('computeEffectiveHalfLife', () => {
  it('returns baseHalfLife when no reinforcement', () => {
    const hl = computeEffectiveHalfLife(30, 5, Date.now(), 0, 3);
    assert.strictEqual(hl, 30);
  });

  it('returns baseHalfLife when no accesses', () => {
    const hl = computeEffectiveHalfLife(30, 0, 0, 1, 3);
    assert.strictEqual(hl, 30);
  });

  it('extends half-life with accesses', () => {
    const hl = computeEffectiveHalfLife(30, 10, Date.now(), 1, 3);
    assert.ok(hl > 30);
    assert.ok(hl <= 90); // maxMultiplier=3 → 30*3=90
  });

  it('honors maxMultiplier cap', () => {
    const hl = computeEffectiveHalfLife(30, 10000, Date.now(), 10, 2);
    assert.ok(hl <= 60); // 30*2=60
  });

  it('decays stale accesses', () => {
    const now = Date.now();
    const oldAccess = now - 60 * 24 * 60 * 60 * 1000; // 60 days ago
    const hlFresh = computeEffectiveHalfLife(30, 10, now, 1, 3);
    const hlStale = computeEffectiveHalfLife(30, 10, oldAccess, 1, 3);
    assert.ok(hlStale < hlFresh);
  });
});
