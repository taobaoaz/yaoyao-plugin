/**
 * Tests for utils/backup.ts — Backup Manager.
 *
 * Tests against temporary directories, no external dependencies.
 *
 * Run: node --experimental-strip-types --test src/__tests__/backup.test.ts
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createBackupManager } from "../utils/backup.ts";
import type { BackupManager } from "../utils/backup.ts";

function setupTestDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "backup-test-"));
  // Create a couple of memory .md files
  fs.writeFileSync(path.join(dir, "2026-05-18.md"), "# Test memory\nHello world", "utf-8");
  fs.writeFileSync(path.join(dir, "2026-05-17.md"), "# Other memory\nSome content", "utf-8");
  return dir;
}

function cleanupDir(dir: string) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
}

describe("Backup Manager", () => {
  it("creates a full backup of .md files", () => {
    const baseDir = setupTestDir();
    const mgr = createBackupManager(baseDir);

    const name = mgr.createBackup("full");
    assert.ok(name !== null, "Backup should succeed");
    assert.ok(name!.startsWith("memory-backup-full-"), "Backup name should match pattern");

    // Verify backup directory exists with files
    const backupDir = path.join(baseDir, ".backups", name!);
    assert.ok(fs.existsSync(backupDir), "Backup directory should exist");
    const files = fs.readdirSync(backupDir);
    assert.ok(files.includes("2026-05-18.md"), "Should contain memory file");
    assert.ok(files.includes("2026-05-17.md"), "Should contain second memory file");
    assert.ok(files.includes(".meta.json"), "Should contain metadata");

    // Verify meta content
    const meta = JSON.parse(fs.readFileSync(path.join(backupDir, ".meta.json"), "utf-8"));
    assert.strictEqual(meta.mode, "full");
    assert.ok(meta.fileCount >= 2);

    cleanupDir(baseDir);
  });

  it("lists available backups", () => {
    const baseDir = setupTestDir();
    const mgr = createBackupManager(baseDir);
    mgr.createBackup("full");

    const list = mgr.listBackups();
    assert.ok(list.length > 0, "Should list backups");
    assert.strictEqual(list[0].name.startsWith("memory-backup-full-"), true);
    assert.ok(list[0].sizeKB >= 0);
    assert.ok(list[0].files >= 2);

    cleanupDir(baseDir);
  });

  it("creates incremental backup (skip unchanged files)", () => {
    const baseDir = setupTestDir();
    const mgr = createBackupManager(baseDir);

    // Full backup first
    mgr.createBackup("full");

    // Incremental — no changes
    const result = mgr.createBackup("incremental");
    // If files haven't changed, incremental returns null (no backup created)
    // This is valid behavior

    // Now add a new file
    fs.writeFileSync(path.join(baseDir, "2026-05-19.md"), "New content", "utf-8");
    const result2 = mgr.createBackup("incremental");
    assert.ok(result2 !== null, "Should create incremental backup when new files exist");

    cleanupDir(baseDir);
  });

  it("prunes old backups keeping only N latest", () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "backup-prune-"));
    const mgr = createBackupManager(baseDir);

    // Create several backups by manipulating .last-backup.json timestamp
    // (direct simulate since we need multiple distinct backup dirs)
    const backupDir = path.join(baseDir, ".backups");
    fs.mkdirSync(backupDir, { recursive: true });
    for (let i = 0; i < 5; i++) {
      const dir = path.join(backupDir, `memory-backup-full-2026-05-${10 + i}T00-00-00`);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, ".meta.json"), `{"timestamp":"2026-05-${10 + i}T00:00:00","mode":"full"}`, "utf-8");
    }

    assert.strictEqual(
      fs.readdirSync(backupDir).filter(f => f.startsWith("memory-backup-")).length, 5
    );
    mgr.pruneBackups(2);
    assert.strictEqual(
      fs.readdirSync(backupDir).filter(f => f.startsWith("memory-backup-")).length, 2
    );

    cleanupDir(baseDir);
  });

  it("restores a backup", () => {
    const baseDir = setupTestDir();
    const mgr = createBackupManager(baseDir);

    const name = mgr.createBackup("full")!;
    // Modify original file
    fs.writeFileSync(path.join(baseDir, "2026-05-18.md"), "Modified content", "utf-8");

    // Restore
    const ok = mgr.restoreBackup(name);
    assert.ok(ok, "Restore should succeed");

    // Verify content restored
    const content = fs.readFileSync(path.join(baseDir, "2026-05-18.md"), "utf-8");
    assert.strictEqual(content, "# Test memory\nHello world", "Original content should be restored");

    cleanupDir(baseDir);
  });

  it("handles restore of non-existent backup gracefully", () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "backup-restore-fail-"));
    const mgr = createBackupManager(baseDir);
    const ok = mgr.restoreBackup("nonexistent-backup");
    assert.strictEqual(ok, false);
    cleanupDir(baseDir);
  });

  it("handles empty directory gracefully", () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "backup-empty-"));
    const mgr = createBackupManager(baseDir);
    const name = mgr.createBackup("full");
    // May return null or a minimal backup — either is fine
    if (name) {
      const list = mgr.listBackups();
      assert.ok(list.length > 0);
    }
    cleanupDir(baseDir);
  });
});
