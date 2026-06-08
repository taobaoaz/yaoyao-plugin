/**
 * Tests for session-recovery.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  stripResetSuffix,
  resolveSessionSearchDirs,
  readCrossSessionMemories,
} from '../utils/session-recovery.ts';

describe('stripResetSuffix', () => {
  it('strips .reset. suffix', () => {
    assert.strictEqual(stripResetSuffix('abc.reset.123.json'), 'abc.json');
  });
  it('passes through normal names', () => {
    assert.strictEqual(stripResetSuffix('normal.json'), 'normal.json');
  });
});

describe('resolveSessionSearchDirs', () => {
  it('includes workspace sessions dir', () => {
    const dirs = resolveSessionSearchDirs({
      context: {},
      cfg: {},
      workspaceDir: '/home/user/.openclaw/workspace',
    });
    assert.ok(dirs.some((d) => d.includes('sessions')));
  });
  it('includes current session file dir', () => {
    const dirs = resolveSessionSearchDirs({
      context: {},
      cfg: {},
      workspaceDir: '/tmp/ws',
      currentSessionFile: '/home/user/.openclaw/agents/main/sessions/abc.json',
    });
    assert.ok(dirs.some((d) => d.includes('abc.json')) || dirs.some((d) => d.includes('sessions')));
  });
});

describe('readCrossSessionMemories', () => {
  it('returns empty for non-existent dirs', () => {
    const result = readCrossSessionMemories(['/nonexistent/path']);
    assert.strictEqual(result.length, 0);
  });
  it('reads memories from temp test dir', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'yaoyao-test-'));
    const memFile = join(tmpDir, 'session.jsonl');
    writeFileSync(memFile, JSON.stringify({ text: 'hello world', timestamp: Date.now() }) + '\n');
    const result = readCrossSessionMemories([tmpDir], { maxMemories: 10 });
    assert.ok(result.length >= 1);
    assert.ok(result[0].text.includes('hello'));
    rmSync(tmpDir, { recursive: true });
  });
});
