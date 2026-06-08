/**
 * Tests for memory-upgrader.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { extractFirstSentence, simpleEnrich, enrichMetadata } from '../core/upgrader/index.ts';

describe('extractFirstSentence', () => {
  it('extracts first sentence', () => {
    assert.strictEqual(extractFirstSentence('Hello world. This is more.'), 'Hello world.');
  });
  it('handles Chinese punctuation', () => {
    assert.strictEqual(extractFirstSentence('你好世界。这是更多。'), '你好世界。');
  });
  it('caps at 100 chars', () => {
    const long = 'a'.repeat(200);
    assert.strictEqual(extractFirstSentence(long).length, 100);
  });
  it('falls back to first 100 chars if no terminator', () => {
    assert.strictEqual(extractFirstSentence('no terminator here'), 'no terminator here');
  });
  it('handles empty string', () => {
    assert.strictEqual(extractFirstSentence(''), '');
  });
});

describe('simpleEnrich', () => {
  it('produces L0/L1/L2', () => {
    const result = simpleEnrich("I love pizza. It's the best food.");
    assert.strictEqual(result.l0_abstract, 'I love pizza.');
    assert.strictEqual(result.l1_overview, '- I love pizza.');
    assert.strictEqual(result.l2_content, "I love pizza. It's the best food.");
  });
});

describe('enrichMetadata', () => {
  it('adds L0/L1/L2 when missing', () => {
    const meta = { temporal: 'static' };
    const enriched = enrichMetadata(meta, 'My name is Alice.');
    assert.strictEqual(enriched.l0_abstract, 'My name is Alice.');
    assert.strictEqual(enriched.l1_overview, '- My name is Alice.');
    assert.strictEqual(enriched.l2_content, 'My name is Alice.');
  });
  it('skips if already enriched', () => {
    const meta = { l0_abstract: 'existing' };
    const enriched = enrichMetadata(meta, 'New text.');
    assert.strictEqual(enriched.l0_abstract, 'existing');
  });
});
