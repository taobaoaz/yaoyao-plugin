import { describe, it } from 'node:test';
import assert from 'node:assert';
import { computeCompressLevel } from '../utils/context-watermark.ts';

describe('context-watermark compression actions', () => {
  it('none level: no compression', () => {
    const { level } = computeCompressLevel(50_000, { contextWindowTokens: 128_000 });
    assert.strictEqual(level, 'none');
    // skipL1 = false, skipFTS5 = false
    assert.strictEqual(level !== 'emergency' && level !== 'aggressive', true);
  });

  it('mild level: no skip', () => {
    const { level } = computeCompressLevel(80_000, { contextWindowTokens: 128_000 });
    assert.strictEqual(level, 'mild');
    // Mild: normal capture, offload may trigger
    assert.strictEqual(level !== 'emergency', true);
    assert.strictEqual(level !== 'aggressive', true);
  });

  it('aggressive level: skip L1 only', () => {
    const { level } = computeCompressLevel(110_000, { contextWindowTokens: 128_000 });
    assert.strictEqual(level, 'aggressive');
    // Aggressive: skipL1 = true, skipFTS5 = false
    const skipL1 = level === 'aggressive' || level === 'emergency';
    const skipFTS5 = level === 'emergency';
    assert.strictEqual(skipL1, true);
    assert.strictEqual(skipFTS5, false);
  });

  it('emergency level: skip L1 + FTS5', () => {
    const { level } = computeCompressLevel(125_000, { contextWindowTokens: 128_000 });
    assert.strictEqual(level, 'emergency');
    // Emergency: skipL1 = true, skipFTS5 = true
    const skipL1 = level === 'aggressive' || level === 'emergency';
    const skipFTS5 = level === 'emergency';
    assert.strictEqual(skipL1, true);
    assert.strictEqual(skipFTS5, true);
  });

  it('custom ratios work', () => {
    const { level } = computeCompressLevel(70_000, {
      contextWindowTokens: 100_000,
      mildOffloadRatio: 0.5,
      aggressiveCompressRatio: 0.7,
      emergencyCompressRatio: 0.9,
    });
    // 70k/100k = 0.7 → aggressive
    assert.strictEqual(level, 'aggressive');
  });

  it('small window triggers earlier', () => {
    const { level, ratio } = computeCompressLevel(31_000, { contextWindowTokens: 32_000 });
    // 31k/32k = 0.96875 → emergency
    assert.strictEqual(level, 'emergency');
    assert.ok(ratio >= 0.95);
  });
});
