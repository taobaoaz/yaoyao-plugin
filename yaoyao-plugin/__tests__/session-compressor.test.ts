/**
 * Tests for session-compressor.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  scoreText,
  compressTexts,
  estimateConversationValue,
} from '../utils/session-compressor.ts';

describe('scoreText', () => {
  it('scores empty text as 0', () => {
    const s = scoreText('', 0);
    assert.strictEqual(s.score, 0);
    assert.strictEqual(s.reason, 'empty');
  });

  it('scores tool call as 1.0', () => {
    const s = scoreText('tool_use memory_store', 0);
    assert.strictEqual(s.score, 1.0);
    assert.strictEqual(s.reason, 'tool_call');
  });

  it('scores correction as 0.95', () => {
    const s = scoreText("actually that's wrong", 0);
    assert.strictEqual(s.score, 0.95);
    assert.strictEqual(s.reason, 'correction');
  });

  it('scores acknowledgment as 0.1', () => {
    const s = scoreText('ok', 0);
    assert.strictEqual(s.score, 0.1);
    assert.strictEqual(s.reason, 'acknowledgment');
  });

  it('scores substantive text as 0.7', () => {
    const s = scoreText(
      'This is a long substantive message with lots of content that exceeds the minimum threshold.',
      0,
    );
    assert.strictEqual(s.score, 0.7);
    assert.strictEqual(s.reason, 'substantive');
  });
});

describe('compressTexts', () => {
  it('returns all texts if within budget', () => {
    const texts = ['a', 'b', 'c'];
    const result = compressTexts(texts, 1000);
    assert.strictEqual(result.texts.length, 3);
    assert.strictEqual(result.dropped, 0);
  });

  it('drops low-value texts when over budget', () => {
    const texts = ['ok', 'tool_use memory_store', 'a'.repeat(500), 'b'.repeat(500)];
    const result = compressTexts(texts, 600);
    assert.ok(result.texts.length < 4);
    assert.ok(result.texts.includes('tool_use memory_store'));
  });

  it('always keeps first and last', () => {
    const texts = ['first', 'a'.repeat(300), 'b'.repeat(300), 'last'];
    const result = compressTexts(texts, 400);
    assert.strictEqual(result.texts[0], 'first');
    assert.strictEqual(result.texts[result.texts.length - 1], 'last');
  });
});

describe('estimateConversationValue', () => {
  it('returns 0 for empty', () => {
    assert.strictEqual(estimateConversationValue([]), 0);
  });

  it('returns high value for memory intent', () => {
    const v = estimateConversationValue(['remember this', 'ok']);
    assert.ok(v >= 0.5);
  });

  it('returns moderate value for substantive conversation', () => {
    const v = estimateConversationValue([
      'hello',
      'how are you',
      'fine thanks',
      "let's decide on the plan",
      'ok',
      'see you',
    ]);
    assert.ok(v > 0);
    assert.ok(v <= 1);
  });
});
