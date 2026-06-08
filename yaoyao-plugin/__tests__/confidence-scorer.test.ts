/**
 * Tests for confidence-scorer.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  tokenizeText,
  lcsLength,
  rougeLikeF1,
  scoreConfidenceSupport,
} from '../utils/confidence-scorer.ts';

describe('tokenizeText', () => {
  it('tokenizes English text', () => {
    const tokens = tokenizeText('Hello world');
    assert.deepStrictEqual(tokens, ['hello', 'world']);
  });

  it('tokenizes Chinese text (character-level)', () => {
    const tokens = tokenizeText('你好世界');
    assert.deepStrictEqual(tokens, ['你', '好', '世', '界']);
  });

  it('handles mixed CJK and English', () => {
    const tokens = tokenizeText('hello你好');
    assert.deepStrictEqual(tokens, ['hello', '你', '好']);
  });

  it('handles empty string', () => {
    const tokens = tokenizeText('');
    assert.deepStrictEqual(tokens, []);
  });
});

describe('lcsLength', () => {
  it('returns 0 for empty arrays', () => {
    assert.strictEqual(lcsLength([], ['a']), 0);
    assert.strictEqual(lcsLength(['a'], []), 0);
  });

  it('computes LCS correctly', () => {
    assert.strictEqual(lcsLength(['a', 'b', 'c'], ['a', 'b', 'c']), 3);
    assert.strictEqual(lcsLength(['a', 'b', 'c'], ['b', 'c', 'd']), 2);
    assert.strictEqual(lcsLength(['a', 'b'], ['c', 'd']), 0);
  });
});

describe('rougeLikeF1', () => {
  it('returns 0 for empty arrays', () => {
    assert.strictEqual(rougeLikeF1([], ['a']), 0);
  });

  it('returns 1 for identical arrays', () => {
    assert.strictEqual(rougeLikeF1(['a', 'b'], ['a', 'b']), 1);
  });

  it('computes partial overlap', () => {
    const score = rougeLikeF1(['a', 'b', 'c'], ['b', 'c', 'd']);
    assert.ok(score > 0 && score < 1);
  });
});

describe('scoreConfidenceSupport', () => {
  it('returns 0 for empty candidate', () => {
    const result = scoreConfidenceSupport('', 'some conversation text');
    assert.strictEqual(result.score, 0);
    assert.strictEqual(result.unsupportedRatio, 1);
  });

  it('scores high for exact match', () => {
    const text = 'The user likes coffee';
    const result = scoreConfidenceSupport(text, text);
    assert.ok(result.score > 0.8);
    assert.strictEqual(result.bestSupport, 1);
    assert.strictEqual(result.coverage, 1);
  });

  it('scores lower for partial match', () => {
    const candidate = 'The user likes coffee and tea';
    const conversation = 'The user likes coffee';
    const result = scoreConfidenceSupport(candidate, conversation);
    assert.ok(result.score > 0.3);
    assert.ok(result.score < 1);
    assert.ok(result.unsupportedRatio > 0);
  });
});
