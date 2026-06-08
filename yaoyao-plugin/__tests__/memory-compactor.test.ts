/**
 * Tests for memory-compactor.ts (text-only version)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  jaccardSimilarity,
  buildTextClusters,
  buildMergedEntry,
  runTextCompaction,
} from '../core/compactor/index.ts';

describe('jaccardSimilarity', () => {
  it('returns 1 for identical texts', () => {
    assert.strictEqual(jaccardSimilarity('hello world', 'hello world'), 1);
  });

  it('returns 0 for completely different texts', () => {
    assert.strictEqual(jaccardSimilarity('abc xyz', 'def uvw'), 0);
  });

  it('returns intermediate value for partial overlap', () => {
    const sim = jaccardSimilarity('hello world foo', 'hello world bar');
    assert.ok(sim > 0 && sim < 1);
  });
});

describe('buildMergedEntry', () => {
  it('deduplicates lines across members', () => {
    const merged = buildMergedEntry([
      {
        id: '1',
        text: 'Line A\nLine B',
        category: 'fact',
        importance: 0.5,
        timestamp: 1,
        scope: 'user',
      },
      {
        id: '2',
        text: 'Line B\nLine C',
        category: 'fact',
        importance: 0.7,
        timestamp: 2,
        scope: 'user',
      },
    ]);
    assert.ok(merged.text.includes('Line A'));
    assert.ok(merged.text.includes('Line B'));
    assert.ok(merged.text.includes('Line C'));
    // Line B should appear only once
    const lines = merged.text.split('\n').filter(Boolean);
    assert.strictEqual(lines.length, 3);
  });

  it('takes max importance', () => {
    const merged = buildMergedEntry([
      { id: '1', text: 'A', category: 'fact', importance: 0.3, timestamp: 1, scope: 'user' },
      { id: '2', text: 'B', category: 'fact', importance: 0.8, timestamp: 2, scope: 'user' },
    ]);
    assert.strictEqual(merged.importance, 0.8);
  });

  it('uses plurality vote for category', () => {
    const merged = buildMergedEntry([
      { id: '1', text: 'A', category: 'fact', importance: 0.5, timestamp: 1, scope: 'user' },
      { id: '2', text: 'B', category: 'preference', importance: 0.5, timestamp: 2, scope: 'user' },
      { id: '3', text: 'C', category: 'preference', importance: 0.5, timestamp: 3, scope: 'user' },
    ]);
    assert.strictEqual(merged.category, 'preference');
  });
});

describe('buildTextClusters', () => {
  it('returns empty when entries < minClusterSize', () => {
    const clusters = buildTextClusters(
      [
        {
          id: '1',
          text: 'hello world',
          category: 'fact',
          importance: 0.5,
          timestamp: 1,
          scope: 'user',
        },
      ],
      0.5,
      2,
    );
    assert.strictEqual(clusters.length, 0);
  });

  it('clusters similar entries', () => {
    const entries = [
      {
        id: '1',
        text: 'hello world foo',
        category: 'fact',
        importance: 0.8,
        timestamp: 1,
        scope: 'user',
      },
      {
        id: '2',
        text: 'hello world bar',
        category: 'fact',
        importance: 0.6,
        timestamp: 2,
        scope: 'user',
      },
      {
        id: '3',
        text: 'completely different text here',
        category: 'fact',
        importance: 0.5,
        timestamp: 3,
        scope: 'user',
      },
    ];
    const clusters = buildTextClusters(entries, 0.3, 2);
    assert.strictEqual(clusters.length, 1);
    assert.strictEqual(clusters[0].members.length, 2);
  });
});

describe('runTextCompaction', () => {
  it('returns zero result when disabled', () => {
    const result = runTextCompaction([], {
      enabled: false,
      minAgeDays: 7,
      similarityThreshold: 0.5,
      minClusterSize: 2,
      maxEntriesToScan: 200,
      dryRun: false,
    });
    assert.strictEqual(result.scanned, 0);
  });

  it('dry run reports clusters without deleting', () => {
    const entries = [
      {
        id: '1',
        text: 'hello world',
        category: 'fact',
        importance: 0.5,
        timestamp: 1,
        scope: 'user',
      },
      {
        id: '2',
        text: 'hello world',
        category: 'fact',
        importance: 0.5,
        timestamp: 2,
        scope: 'user',
      },
    ];
    const result = runTextCompaction(entries, {
      enabled: true,
      minAgeDays: 0,
      similarityThreshold: 0.5,
      minClusterSize: 2,
      maxEntriesToScan: 200,
      dryRun: true,
    });
    assert.ok(result.clustersFound > 0);
    assert.strictEqual(result.entriesDeleted, 0);
  });
});
