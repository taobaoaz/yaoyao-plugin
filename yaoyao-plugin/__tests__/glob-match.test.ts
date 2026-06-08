/**
 * Tests for glob-match.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { matchGlob, isExcludedAgent } from '../utils/glob-match.ts';

describe('matchGlob', () => {
  it('exact match', () => {
    assert.strictEqual(matchGlob('bench-judge-1', 'bench-judge-1'), true);
    assert.strictEqual(matchGlob('bench-judge-1', 'bench-judge-2'), false);
  });
  it('wildcard prefix', () => {
    assert.strictEqual(matchGlob('bench-*', 'bench-judge-1'), true);
    assert.strictEqual(matchGlob('bench-*', 'other-judge-1'), false);
  });
  it('wildcard suffix', () => {
    assert.strictEqual(matchGlob('*judge*', 'bench-judge-1'), true);
    assert.strictEqual(matchGlob('*judge*', 'bench-eval-1'), false);
  });
  it('wildcard middle', () => {
    assert.strictEqual(matchGlob('bench-*-1', 'bench-judge-1'), true);
    assert.strictEqual(matchGlob('bench-*-1', 'bench-eval-2'), false);
  });
  it('no wildcard mismatch', () => {
    assert.strictEqual(matchGlob('abc', 'abcd'), false);
  });
});

describe('isExcludedAgent', () => {
  it('matches exact', () => {
    assert.strictEqual(isExcludedAgent('test-agent', ['test-agent']), true);
  });
  it('matches glob', () => {
    assert.strictEqual(isExcludedAgent('bench-judge-1', ['bench-*']), true);
    assert.strictEqual(isExcludedAgent('other-agent', ['bench-*']), false);
  });
  it('empty patterns', () => {
    assert.strictEqual(isExcludedAgent('any', []), false);
  });
});
