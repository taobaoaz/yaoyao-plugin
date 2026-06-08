import { describe, it } from 'node:test';
import assert from 'node:assert';
import { runInstallCheck, formatInstallCheck } from '../utils/install-check.ts';

describe('install-check', () => {
  it('returns a capability report', () => {
    const report = runInstallCheck();
    assert.strictEqual(typeof report.canRun, 'boolean');
    assert.strictEqual(report.canRun, true); // always true
    assert.ok(['node-sqlite', 'better-sqlite3', 'file-db'].includes(report.backend));
    assert.strictEqual(typeof report.features.fts5, 'boolean');
    assert.strictEqual(typeof report.features.wal, 'boolean');
    assert.strictEqual(typeof report.features.vec, 'boolean');
    assert.strictEqual(typeof report.features.autoCapture, 'boolean');
    assert.strictEqual(typeof report.features.autoRecall, 'boolean');
    assert.ok(Array.isArray(report.warnings));
    assert.ok(Array.isArray(report.info));
  });

  it('formatInstallCheck produces markdown', () => {
    const report = runInstallCheck();
    const formatted = formatInstallCheck(report);
    assert.ok(formatted.includes('环境能力报告'));
    assert.ok(formatted.includes(report.backend));
    assert.ok(formatted.includes('FTS5'));
  });

  it('always reports autoCapture as available', () => {
    const report = runInstallCheck();
    assert.strictEqual(report.features.autoCapture, true);
  });
});
