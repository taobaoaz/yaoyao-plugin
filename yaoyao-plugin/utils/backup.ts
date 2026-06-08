/**
 * Backup Manager — creates and restores snapshots of memory data.
 */
import path from 'node:path';
import fs from 'node:fs';
import { createBackup } from './backup-create.ts';
import { restoreBackup } from './backup-restore.ts';

export interface BackupEntry {
  name: string;
  timestamp: string;
  sizeKB: number;
  files: number;
  createdAt: string;
}

type Logger = { info?: (s: string) => void; error?: (s: string) => void };

export function createBackupManager(baseDir: string, logger?: Logger) {
  const backupDir = path.join(baseDir, '.backups');
  const log = (msg: string) => logger?.info?.(`[yaoyao-memory:backup] ${msg}`);

  function ensureDir(dir: string) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  return {
    createBackup: (mode: 'full' | 'incremental' = 'full') =>
      createBackup(baseDir, backupDir, mode, logger),

    listBackups: (): BackupEntry[] => {
      try {
        ensureDir(backupDir);
        const results: BackupEntry[] = [];
        for (const name of fs
          .readdirSync(backupDir)
          .filter((f) => f.startsWith('memory-backup-'))
          .sort((a, b) => b.localeCompare(a))
          .slice(0, 30)) {
          const p = path.join(backupDir, name);
          try {
            const stat = fs.statSync(p);
            if (!stat.isDirectory()) continue;
            const files = fs.readdirSync(p);
            const size = files.reduce(
              (sum, f) => sum + (fs.statSync(path.join(p, f)).size || 0),
              0,
            );
            results.push({
              name,
              timestamp: name.replace('memory-backup-', '').replace(/-/g, ':').slice(0, 19),
              sizeKB: Math.round(size / 1024),
              files: files.length,
              createdAt: stat.mtime.toISOString(),
            });
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn(`[yaoyao-memory:backup] Skip entry ${name}: ${msg}`);
          }
        }
        return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[yaoyao-memory:utils] Operation failed: ${msg}`);
        return [];
      }
    },

    restoreBackup: (backupName: string) => restoreBackup(baseDir, backupDir, backupName, logger),

    pruneBackups: (keepCount: number = 10): void => {
      try {
        ensureDir(backupDir);
        let backups: { name: string; mtime: number }[];
        try {
          backups = fs
            .readdirSync(backupDir)
            .filter((f) => f.startsWith('memory-backup-'))
            .map((f) => ({ name: f, mtime: fs.statSync(path.join(backupDir, f)).mtimeMs }))
            .sort((a, b) => b.mtime - a.mtime);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn(`[yaoyao-memory:backup] List backups failed: ${msg}`);
          backups = [];
        }
        for (const d of backups.slice(keepCount)) {
          fs.rmSync(path.join(backupDir, d.name), { recursive: true, force: true });
          log(`Pruned: ${d.name}`);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[yaoyao-memory:backup] Prune failed: ${msg}`);
      }
    },
  };
}

export type BackupManager = ReturnType<typeof createBackupManager>;
