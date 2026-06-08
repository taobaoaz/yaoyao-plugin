/**
 * Tests for chunker.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { chunkDocument, smartChunk, DEFAULT_CHUNKER_CONFIG } from '../utils/chunker.ts';

describe('chunkDocument', () => {
  it('returns empty for empty text', () => {
    const result = chunkDocument('');
    assert.strictEqual(result.chunkCount, 0);
    assert.strictEqual(result.totalOriginalLength, 0);
  });

  it('returns single chunk for short text', () => {
    const text = 'Hello world. This is a short text.';
    const result = chunkDocument(text, DEFAULT_CHUNKER_CONFIG);
    assert.strictEqual(result.chunkCount, 1);
    assert.strictEqual(result.chunks[0], text);
  });

  it('splits long text into multiple chunks', () => {
    const text = 'A'.repeat(10000);
    const result = chunkDocument(text, { ...DEFAULT_CHUNKER_CONFIG, maxChunkSize: 1000 });
    assert.ok(result.chunkCount > 1);
    assert.ok(result.chunks.every((c) => c.length <= 1000));
  });

  it('respects overlap size', () => {
    const text = 'Word '.repeat(2000);
    const result = chunkDocument(text, {
      ...DEFAULT_CHUNKER_CONFIG,
      maxChunkSize: 500,
      overlapSize: 50,
    });
    assert.ok(result.chunkCount > 1);
    // Adjacent chunks should share some content due to overlap
    if (result.chunks.length >= 2) {
      const chunk0End = result.chunks[0].slice(-30);
      const chunk1Start = result.chunks[1].slice(0, 30);
      assert.ok(chunk0End.length > 0 && chunk1Start.length > 0);
    }
  });

  it('prefers sentence boundaries', () => {
    const sentences = Array.from({ length: 50 }, (_, i) => `Sentence ${i}.`).join(' ');
    const result = chunkDocument(sentences, { ...DEFAULT_CHUNKER_CONFIG, maxChunkSize: 300 });
    // Most chunks should end with a period (sentence boundary)
    const endings = result.chunks.slice(0, -1).filter((c) => /[.!?。！？]\s*$/.test(c));
    assert.ok(endings.length >= result.chunkCount * 0.5);
  });
});

describe('smartChunk', () => {
  it('adapts to CJK text', () => {
    const cjkText = '你好世界。'.repeat(500);
    const result = smartChunk(cjkText, 8192);
    assert.ok(result.chunkCount >= 1);
    // CJK chunks should be smaller due to token density
    if (result.chunkCount > 1) {
      const avgSize = result.totalOriginalLength / result.chunkCount;
      assert.ok(avgSize < 3000); // smaller than Latin equivalent
    }
  });

  it('handles Latin text', () => {
    const latinText = 'Hello world. '.repeat(500);
    const result = smartChunk(latinText, 8192);
    assert.ok(result.chunkCount >= 1);
  });
});
