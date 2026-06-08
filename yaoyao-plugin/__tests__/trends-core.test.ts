import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  computeTrends,
  formatTrendsReport,
  extractTokens,
  countFrequencies,
  daysAgo,
} from '../core/trends/trends.ts';

describe('extractTokens', () => {
  it('extracts English words and Chinese bigrams', () => {
    const tokens = extractTokens('hello world 你好世界');
    assert.ok(tokens.includes('hello'));
    assert.ok(tokens.includes('world'));
    assert.ok(tokens.includes('你好'));
    assert.ok(tokens.includes('好世'));
    assert.ok(tokens.includes('世界'));
  });

  it('filters stopwords', () => {
    const tokens = extractTokens('the quick brown fox');
    assert.ok(!tokens.includes('the'));
    assert.ok(tokens.includes('quick'));
    assert.ok(tokens.includes('brown'));
    assert.ok(tokens.includes('fox'));
  });

  it('ignores short tokens', () => {
    const tokens = extractTokens('a b c def');
    assert.deepStrictEqual(tokens, ['def']);
  });
});

describe('countFrequencies', () => {
  it('counts token occurrences', () => {
    const map = countFrequencies(['a', 'b', 'a', 'c', 'a', 'b']);
    assert.strictEqual(map.get('a'), 3);
    assert.strictEqual(map.get('b'), 2);
    assert.strictEqual(map.get('c'), 1);
  });
});

describe('daysAgo', () => {
  it('returns ISO-like date string', () => {
    const d = daysAgo(0);
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(d));
  });

  it('returns earlier date for > 0', () => {
    const today = new Date(daysAgo(0));
    const yesterday = new Date(daysAgo(1));
    assert.strictEqual(today.getTime() - yesterday.getTime(), 86400000);
  });
});

describe('computeTrends', () => {
  it('computes trend directions', () => {
    const all = new Map([
      ['apple', 5],
      ['banana', 3],
      ['cherry', 1],
    ]);
    const early = new Map([
      ['apple', 1],
      ['banana', 2],
      ['cherry', 1],
    ]);
    const late = new Map([
      ['apple', 4],
      ['banana', 1],
    ]);
    const result = computeTrends(all, early, late, 3);
    assert.strictEqual(result.length, 3);
    assert.strictEqual(result[0].word, 'apple');
    assert.strictEqual(result[0].emoji, '📈'); // late(4) > early(1)*1.5
  });

  it('returns empty for empty freq map', () => {
    const result = computeTrends(new Map(), new Map(), new Map(), 5);
    assert.deepStrictEqual(result, []);
  });
});

describe('formatTrendsReport', () => {
  it('formats trends to markdown', () => {
    const trends = [
      { word: 'apple', count: 10, emoji: '📈', direction: '快速上升', earlyCount: 2, lateCount: 8 },
    ];
    const report = formatTrendsReport(trends, '30', 5, 20, 5);
    assert.ok(report.includes('apple'));
    assert.ok(report.includes('📈'));
    assert.ok(report.includes('快速上升'));
    assert.ok(report.includes('🔥 上升话题'));
  });
});
