import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  estimateTokens,
  computeCompressLevel,
  estimateContextSize,
} from '../utils/context-watermark.ts';

describe('context-watermark', () => {
  it('estimateTokens uses 3.5 chars per token', () => {
    assert.strictEqual(estimateTokens('3500 chars here'), 5); // 15 chars / 3.5 ≈ 5
    assert.strictEqual(estimateTokens(''), 0);
    assert.strictEqual(estimateTokens('a'.repeat(350)), 100); // 350 / 3.5 = 100
  });

  it('computeCompressLevel none', () => {
    const result = computeCompressLevel(50_000, { contextWindowTokens: 128_000 });
    assert.strictEqual(result.level, 'none');
    assert.ok(result.ratio < 0.6);
  });

  it('computeCompressLevel mild', () => {
    const result = computeCompressLevel(80_000, { contextWindowTokens: 128_000 });
    assert.strictEqual(result.level, 'mild');
    assert.ok(result.ratio >= 0.6);
  });

  it('computeCompressLevel aggressive', () => {
    const result = computeCompressLevel(110_000, { contextWindowTokens: 128_000 });
    assert.strictEqual(result.level, 'aggressive');
    assert.ok(result.ratio >= 0.8);
  });

  it('computeCompressLevel emergency', () => {
    const result = computeCompressLevel(125_000, { contextWindowTokens: 128_000 });
    assert.strictEqual(result.level, 'emergency');
    assert.ok(result.ratio >= 0.95);
  });

  it('estimateContextSize from messages', () => {
    const messages = [
      { role: 'user', content: 'Hello world this is a test message' },
      { role: 'assistant', content: 'Sure I can help with that' },
    ];
    const tokens = estimateContextSize(messages);
    assert.ok(tokens > 0);
  });
});
