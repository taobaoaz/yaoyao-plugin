/**
 * Tests for retrieval-trace.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { TraceCollector } from '../utils/retrieval-trace.ts';

describe('TraceCollector', () => {
  it('tracks single stage', () => {
    const trace = new TraceCollector();
    trace.startStage('search', ['a', 'b', 'c']);
    trace.endStage(['a', 'b']);
    const result = trace.finalize('test query', 'fts');

    assert.strictEqual(result.mode, 'fts');
    assert.strictEqual(result.stages.length, 1);
    assert.strictEqual(result.stages[0].name, 'search');
    assert.strictEqual(result.stages[0].inputCount, 3);
    assert.strictEqual(result.stages[0].outputCount, 2);
    assert.deepStrictEqual(result.stages[0].droppedIds, ['c']);
  });

  it('tracks multiple stages', () => {
    const trace = new TraceCollector();
    trace.startStage('search', ['a', 'b', 'c', 'd']);
    trace.endStage(['a', 'b', 'c']);
    trace.startStage('decay', ['a', 'b', 'c']);
    trace.endStage(['a', 'b', 'c'], [0.8, 0.7, 0.6]);
    const result = trace.finalize('query', 'hybrid');

    assert.strictEqual(result.stages.length, 2);
    assert.strictEqual(result.finalCount, 3);
    assert.ok(result.totalMs >= 0);
  });

  it('handles empty stages', () => {
    const trace = new TraceCollector();
    const result = trace.finalize('q', 'fts');
    assert.strictEqual(result.finalCount, 0);
    assert.strictEqual(result.stages.length, 0);
  });

  it('summarize produces readable output', () => {
    const trace = new TraceCollector();
    trace.startStage('search', ['a', 'b', 'c']);
    trace.endStage(['a', 'b'], [0.9, 0.5]);
    const summary = trace.summarize();

    assert.ok(summary.includes('search:'));
    assert.ok(summary.includes('1 stages'));
  });
});
