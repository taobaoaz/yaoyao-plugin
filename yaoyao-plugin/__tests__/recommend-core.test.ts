import { describe, it } from 'node:test';
import assert from 'node:assert';
import { diversifiedSelect, formatRecommendations } from '../core/recommend/recommend.ts';

describe('diversifiedSelect', () => {
  it('selects top-N by score when no scene diversity', () => {
    const pool = [
      { id: '1', date: '2026-05-14', user_text: 'a', asst_text: 'A', score: 0.9 },
      { id: '2', date: '2026-05-13', user_text: 'b', asst_text: 'B', score: 0.7 },
      { id: '3', date: '2026-05-12', user_text: 'c', asst_text: 'C', score: 0.5 },
    ];
    const selected = diversifiedSelect(pool, 2, new Map(), 0, false);
    assert.strictEqual(selected.length, 2);
    assert.strictEqual(selected[0].user_text, 'a');
    assert.strictEqual(selected[1].user_text, 'b');
  });

  it('returns empty for empty pool', () => {
    const selected = diversifiedSelect([], 3, new Map(), 0, false);
    assert.deepStrictEqual(selected, []);
  });

  it('returns all if limit > pool size', () => {
    const pool = [{ id: '1', date: '2026-05-14', user_text: 'a', asst_text: 'A', score: 0.9 }];
    const selected = diversifiedSelect(pool, 5, new Map(), 0, false);
    assert.strictEqual(selected.length, 1);
  });
});

describe('formatRecommendations', () => {
  it('formats with score bars', () => {
    const selected = [
      { date: '2026-05-14', user_text: 'note A', asst_text: 'reply A', score: 0.8 },
    ];
    const text = formatRecommendations(selected, 'test context', 0.5);
    assert.ok(text.includes('note A'));
    assert.ok(text.includes('test context'));
    assert.ok(text.includes('50%'));
    assert.ok(text.includes('█'));
  });

  it('handles empty selection', () => {
    const text = formatRecommendations([], 'none', 0);
    assert.ok(text.includes('记忆推荐'));
  });
});
