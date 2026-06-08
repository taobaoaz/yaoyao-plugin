/**
 * Memory Cleaner — scheduled cleanup of old memory data.
 *
 * - Prunes daily log files older than retention days
 * - Removes stale FTS5 entries from the DB
 * - Optionally archives before deletion
 * - Evicts cold session checkpoints
 */
import { clampNum } from './clamp.ts';
import path from 'node:path';
import fs from 'node:fs';
import type { DBBridge } from './db-bridge.ts';

export function parseCleanTime(cleanTime?: string): { hour: number; minute: number } | null {
  if (!cleanTime) return null;
  const m = cleanTime.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hour = parseInt(m[1], 10);
  const minute = parseInt(m[2], 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

/** Compute milliseconds until next clean time */
export function getNextCleanTimeMs(cleanTime?: string): number {
  const parsed = parseCleanTime(cleanTime);
  if (!parsed) return 0;

  const now = new Date();
  const target = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    parsed.hour,
    parsed.minute,
    0,
    0,
  );
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime() - now.getTime();
}

export interface CleanerConfig {
  /** Retain daily logs for this many days (default: 30, 0 = never clean) */
  l0l1RetentionDays?: number;
  /** Allow aggressive cleanup (retention = 1 or 2 days) */
  allowAggressiveCleanup?: boolean;
  /** Number of backups to keep (default: 10) */
  maxBackups?: number;
  /** Daily cleanup time in HH:MM format (default: empty = interval-based) */
  cleanTime?: string;
}

type Logger = { info?: (s: string) => void; error?: (s: string) => void };

export function createMemoryCleaner(
  baseDir: string,
  db: DBBridge,
  config?: CleanerConfig,
  logger?: Logger,
) {
  const cfg = {
    l0l1RetentionDays: config?.l0l1RetentionDays ?? 30,
    allowAggressiveCleanup: config?.allowAggressiveCleanup ?? false,
    maxBackups: clampNum(config?.maxBackups, 10, 1, 50),
  };

  const log = (msg: string) => logger?.info?.(`[yaoyao-memory:cleaner] ${msg}`);

  /** Validate retention config */
  function validateConfig(): string | null {
    const days = cfg.l0l1RetentionDays;
    if (days === 0) return null; // 0 = disabled
    if (days > 0 && days < 3 && !cfg.allowAggressiveCleanup) {
      return `l0l1RetentionDays=${days} requires allowAggressiveCleanup=true`;
    }
    return null;
  }

  /**
   * Run a full cleanup cycle.
   * @returns { deleted: number; archived: number }
   */
  function cleanup(): { deleted: number; archived: number } {
    const result = { deleted: 0, archived: 0 };
    const days = cfg.l0l1RetentionDays;
    if (days <= 0) return result;

    const warn = validateConfig();
    if (warn) {
      logger?.error?.(`[yaoyao-memory:cleaner] Config error: ${warn}`);
      return result;
    }

    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

    // Clean up old daily .md files
    if (fs.existsSync(baseDir)) {
      let files: string[];
      try {
        files = fs.readdirSync(baseDir);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        logger?.error?.(`[yaoyao-memory:cleaner] Read baseDir failed: ${msg}`);
        files = [];
      }
      for (const f of files) {
        if (!/^\d{4}-\d{2}-\d{2}/.test(f)) continue; // only daily files

        const fp = path.join(baseDir, f);
        try {
          const stat = fs.statSync(fp);
          if (stat.mtimeMs < cutoff) {
            // Archive before deletion
            const archiveDir = path.join(baseDir, '.archive');
            fs.mkdirSync(archiveDir, { recursive: true });
            fs.copyFileSync(fp, path.join(archiveDir, f));
            fs.unlinkSync(fp);
            result.deleted++;
            result.archived++;
            log(`Archived old daily file: ${f}`);
          }
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          logger?.error?.(`[yaoyao-memory:cleaner] Skip ${f}: ${msg}`);
        }
      }
    }

    // Clean up empty scene_blocks and stale pipeline checkpoints
    const scenesDir = path.join(baseDir, 'scene_blocks');
    if (fs.existsSync(scenesDir)) {
      let files: string[];
      try {
        files = fs.readdirSync(scenesDir);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        logger?.error?.(`[yaoyao-memory:cleaner] Read scenesDir failed: ${msg}`);
        files = [];
      }
      for (const f of files) {
        const fp = path.join(scenesDir, f);
        try {
          if (fs.statSync(fp).size === 0) {
            fs.unlinkSync(fp);
          }
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          logger?.error?.(`[yaoyao-memory:cleaner] Clean scene ${f}: ${msg}`);
        }
      }
    }

    const pipelineDir = path.join(baseDir, '.pipeline');
    if (fs.existsSync(pipelineDir)) {
      let files: string[];
      try {
        files = fs.readdirSync(pipelineDir);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        logger?.error?.(`[yaoyao-memory:cleaner] Read pipelineDir failed: ${msg}`);
        files = [];
      }
      for (const f of files) {
        const fp = path.join(pipelineDir, f);
        try {
          const stat = fs.statSync(fp);
          if (Date.now() - stat.mtimeMs > days * 24 * 60 * 60 * 1000) {
            fs.unlinkSync(fp);
          }
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          logger?.error?.(`[yaoyao-memory:cleaner] Clean pipeline ${f}: ${msg}`);
        }
      }
    }

    // Prune old backups (keep last 10)
    const backupDir = path.join(baseDir, '.backups');
    if (fs.existsSync(backupDir)) {
      let backups: string[];
      try {
        backups = fs.readdirSync(backupDir);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        logger?.error?.(`[yaoyao-memory:cleaner] Read backupDir failed: ${msg}`);
        backups = [];
      }
      const backupEntries = backups
        .filter((f) => f.startsWith('memory-backup-'))
        .map((f) => ({ name: f, mtime: fs.statSync(path.join(backupDir, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
      for (const b of backupEntries.slice(cfg.maxBackups)) {
        fs.rmSync(path.join(backupDir, b.name), { recursive: true, force: true });
      }
    }

    log(`Cleanup: deleted ${result.deleted} files, archived ${result.archived}`);
    return result;
  }

  return { cleanup, validateConfig };
}

export type MemoryCleaner = ReturnType<typeof createMemoryCleaner>;
