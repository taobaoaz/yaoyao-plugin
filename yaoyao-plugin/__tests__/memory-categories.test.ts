/**
 * Tests for memory-categories.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  normalizeCategory,
  legacyToNewCategory,
  ALWAYS_MERGE_CATEGORIES,
  APPEND_ONLY_CATEGORIES,
} from '../utils/memory-categories.ts';

describe('normalizeCategory', () => {
  it('accepts valid categories', () => {
    assert.strictEqual(normalizeCategory('profile'), 'profile');
    assert.strictEqual(normalizeCategory('preferences'), 'preferences');
    assert.strictEqual(normalizeCategory('entities'), 'entities');
    assert.strictEqual(normalizeCategory('events'), 'events');
    assert.strictEqual(normalizeCategory('cases'), 'cases');
    assert.strictEqual(normalizeCategory('patterns'), 'patterns');
  });
  it('handles uppercase', () => {
    assert.strictEqual(normalizeCategory('PROFILE'), 'profile');
  });
  it('returns null for invalid', () => {
    assert.strictEqual(normalizeCategory('foo'), null);
    assert.strictEqual(normalizeCategory(''), null);
  });
});

describe('legacyToNewCategory', () => {
  it('maps preference → preferences', () => {
    assert.strictEqual(legacyToNewCategory('preference'), 'preferences');
  });
  it('maps entity → entities', () => {
    assert.strictEqual(legacyToNewCategory('entity'), 'entities');
  });
  it('maps decision with long text → cases', () => {
    assert.strictEqual(legacyToNewCategory('decision', 'a'.repeat(100)), 'cases');
  });
  it('maps decision with short text → events', () => {
    assert.strictEqual(legacyToNewCategory('decision', 'short'), 'events');
  });
  it('maps reflection → patterns', () => {
    assert.strictEqual(legacyToNewCategory('reflection'), 'patterns');
  });
  it('maps unknown short text → profile', () => {
    assert.strictEqual(legacyToNewCategory('other', 'hi'), 'profile');
  });
  it('maps unknown long text → patterns', () => {
    assert.strictEqual(legacyToNewCategory('other', 'a'.repeat(100)), 'patterns');
  });
});

describe('category sets', () => {
  it('profile always merges', () => {
    assert.strictEqual(ALWAYS_MERGE_CATEGORIES.has('profile'), true);
  });
  it('events and cases are append-only', () => {
    assert.strictEqual(APPEND_ONLY_CATEGORIES.has('events'), true);
    assert.strictEqual(APPEND_ONLY_CATEGORIES.has('cases'), true);
  });
});
