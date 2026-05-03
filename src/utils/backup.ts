/**
 * Backup Manager — creates and restores snapshots of memory data.
 *
 * Backs up both the SQLite DB (.yaoyao.db) and all memory/*.md files
 * into timestamped backup directories under memory/.backups/.
 * Restores from a chosen backup point.
 */
import path from "node:path";
import fs from "node:fs";

export interface BackupEntry {
  name: string;
  timestamp: string;
  sizeKB: number;
  files: number;
  createdAt: string;
}

type Logger = { info?: (s: string) => void; error?: (s: string) => void };

export function createBackupManager(baseDir: string, logger?: Logger) {
  const backupDir = path.join(baseDir, ".backups");
  const log = (msg: string) => logger?.info?.(`[yaoyao-memory:backup] ${msg}`);

  function ensureDir(dir: string) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  /** Create a timestamped backup of all memory data. Returns backup name or null. */
  function createBackup(): string | null {
    try {
      ensureDir(backupDir);
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const backupName = `memory-backup-${timestamp}`;
      const backupPath = path.join(backupDir, backupName);
      ensureDir(backupPath);

      let fileCount = 0;

      // Backup .md files
      if (fs.existsSync(baseDir)) {
        for (const f of fs.readdirSync(baseDir).filter(f => f.endsWith(".md"))) {
          fs.copyFileSync(path.join(baseDir, f), path.join(backupPath, f));
          fileCount++;
        }
      }

      // Backup SQLite DB
      const dbPath = path.join(baseDir, ".yaoyao.db");
      if (fs.existsSync(dbPath)) {
        fs.copyFileSync(dbPath, path.join(backupPath, ".yaoyao.db"));
        fileCount++;
      }

      log(`Backup created: ${backupName} (${fileCount} files)`);
      return backupName;
    } catch (err: any) {
      logger?.error?.(`[yaoyao-memory:backup] Create failed: ${err.message}`);
      return null;
    }
  }

  /** List all available backups, most recent first. */
  function listBackups(): BackupEntry[] {
    try {
      ensureDir(backupDir);
      const results: BackupEntry[] = [];
      for (const name of fs.readdirSync(backupDir).filter(f => f.startsWith("memory-backup-")).slice(-30)) {
        const p = path.join(backupDir, name);
        try {
          const stat = fs.statSync(p);
          if (!stat.isDirectory()) continue;
          const files = fs.readdirSync(p);
          const size = files.reduce((sum, f) => sum + (fs.statSync(path.join(p, f)).size || 0), 0);
          results.push({
            name,
            timestamp: name.replace("memory-backup-", "").replace(/-/g, ":").slice(0, 19),
            sizeKB: Math.round(size / 1024),
            files: files.length,
            createdAt: stat.mtime.toISOString(),
          });
        } catch { /* skip */ }
      }
      return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } catch {
      return [];
    }
  }

  /** Restore memory data from a backup. Overwrites current files. */
  function restoreBackup(backupName: string): boolean {
    try {
      const backupPath = path.join(backupDir, backupName);
      if (!fs.existsSync(backupPath)) {
        logger?.error?.(`[yaoyao-memory:backup] Not found: ${backupName}`);
        return false;
      }

      const files = fs.readdirSync(backupPath);

      // Pre-restore snapshot
      const preDir = path.join(backupDir, `pre-restore-${Date.now()}`);
      fs.mkdirSync(preDir, { recursive: true });

      for (const f of files) {
        const src = path.join(baseDir, f);
        if (fs.existsSync(src)) fs.copyFileSync(src, path.join(preDir, f));
        fs.copyFileSync(path.join(backupPath, f), src);
      }

      log(`Restored from ${backupName} (snapshot: ${preDir})`);
      return true;
    } catch (err: any) {
      logger?.error?.(`[yaoyao-memory:backup] Restore failed: ${err.message}`);
      return false;
    }
  }

  /** Prune old backups, keeping only the N most recent. */
  function pruneBackups(keepCount: number = 10): void {
    try {
      ensureDir(backupDir);
      const backups = fs.readdirSync(backupDir)
        .filter(f => f.startsWith("memory-backup-"))
        .map(f => ({ name: f, mtime: fs.statSync(path.join(backupDir, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
      for (const d of backups.slice(keepCount)) {
        fs.rmSync(path.join(backupDir, d.name), { recursive: true, force: true });
        log(`Pruned: ${d.name}`);
      }
    } catch { /* best effort */ }
  }

  return { createBackup, listBackups, restoreBackup, pruneBackups };
}

export type BackupManager = ReturnType<typeof createBackupManager>;
