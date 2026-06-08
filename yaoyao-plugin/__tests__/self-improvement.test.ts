/**
 * Tests for self-improvement.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  appendSelfImprovementEntry,
  ensureSelfImprovementFiles,
} from '../utils/self-improvement.ts';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('ensureSelfImprovementFiles', () => {
  it('creates LEARNINGS.md and ERRORS.md', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'yaoyao-test-'));
    try {
      await ensureSelfImprovementFiles(tmpDir);
      assert.ok(existsSync(join(tmpDir, '.learnings', 'LEARNINGS.md')));
      assert.ok(existsSync(join(tmpDir, '.learnings', 'ERRORS.md')));
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });
});

describe('appendSelfImprovementEntry', () => {
  it('appends a learning entry', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'yaoyao-test-'));
    try {
      const result = await appendSelfImprovementEntry({
        baseDir: tmpDir,
        type: 'learning',
        summary: 'Test learning',
        details: 'Some details',
        suggestedAction: 'Do this',
      });
      assert.ok(result.id.startsWith('LRN-'));
      const content = readFileSync(result.filePath, 'utf-8');
      assert.ok(content.includes('Test learning'));
      assert.ok(content.includes('Some details'));
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it('appends an error entry', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'yaoyao-test-'));
    try {
      const result = await appendSelfImprovementEntry({
        baseDir: tmpDir,
        type: 'error',
        summary: 'Test error',
        details: 'Error details',
      });
      assert.ok(result.id.startsWith('ERR-'));
      const content = readFileSync(result.filePath, 'utf-8');
      assert.ok(content.includes('Test error'));
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });
});
