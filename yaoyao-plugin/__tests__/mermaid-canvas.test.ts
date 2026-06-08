/**
 * Tests for mermaid-canvas.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { buildMermaidCanvas, parseToolsFromText, maybeOffload } from '../utils/mermaid-canvas.ts';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('buildMermaidCanvas', () => {
  it('renders simple flowchart', () => {
    const canvas = buildMermaidCanvas(
      [
        { id: 'a', label: 'Start', type: 'task', status: 'done' },
        { id: 'b', label: 'Fetch', type: 'tool', status: 'done' },
      ],
      [{ from: 'a', to: 'b' }],
    );
    assert.ok(canvas.includes('graph TD'));
    assert.ok(canvas.includes('a[Start]'));
    assert.ok(canvas.includes('b[[Fetch]]'));
    assert.ok(canvas.includes('a --> b'));
  });
  it('renders decision diamond', () => {
    const canvas = buildMermaidCanvas(
      [{ id: 'd', label: 'OK?', type: 'decision', status: 'pending' }],
      [],
    );
    assert.ok(canvas.includes('d{{OK?}}'));
  });
});

describe('parseToolsFromText', () => {
  it('extracts tool calls', () => {
    const text = 'Using tool: search. Then called fetch_data. Finally invoked save.';
    const { nodes, edges } = parseToolsFromText(text);
    assert.strictEqual(nodes.length, 3);
    assert.strictEqual(edges.length, 2);
    assert.ok(nodes.some((n) => n.label === 'search'));
    assert.ok(nodes.some((n) => n.label === 'fetch_data'));
  });
  it('returns empty for plain text', () => {
    const { nodes } = parseToolsFromText('今天天气不错。');
    assert.strictEqual(nodes.length, 0);
  });
});

describe('maybeOffload', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mermaid-test-'));

  it('skips short text', () => {
    const result = maybeOffload(tmpDir, 'sess1', 'Short text.');
    assert.strictEqual(result.offloaded, false);
    assert.strictEqual(result.text, 'Short text.');
  });

  it('offloads long text with tools', () => {
    const longText = 'Using tool: search. ' + 'x'.repeat(4000);
    const result = maybeOffload(tmpDir, 'sess1', longText, 100);
    assert.strictEqual(result.offloaded, true);
    assert.ok(result.text.includes('```mermaid'));
    assert.ok(result.refPath);
    assert.ok(fs.existsSync(result.refPath!));
  });

  it('skips long text without tools', () => {
    const longText = 'x'.repeat(5000);
    const result = maybeOffload(tmpDir, 'sess2', longText, 100);
    assert.strictEqual(result.offloaded, false);
  });
});
