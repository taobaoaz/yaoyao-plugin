/**
 * AuditLog — lightweight human-readable audit trail for yaoyao-memory.
 *
 * Writes structured entries to `memory/audit/audit-YYYY-MM-DD.md`.
 * Each entry is self-contained, timestamped, and human-readable.
 *
 * v2: Async batch flush to avoid blocking the event loop.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { PluginLogger } from 'openclaw/plugin-sdk/plugin-entry';

export interface AuditEntry {
  component: string;
  event: string;
  summary: string;
  details?: Record<string, unknown>;
}

export interface AuditLogOptions {
  /** Max buffered entries before auto-flush (default: 50) */
  bufferSize?: number;
  /** Flush interval in ms (default: 5000) */
  flushIntervalMs?: number;
}

export function createAuditLog(baseDir: string, logger?: PluginLogger, opts: AuditLogOptions = {}) {
  const auditDir = path.join(baseDir, 'audit');
  const bufferSize = opts.bufferSize ?? 50;
  const flushIntervalMs = opts.flushIntervalMs ?? 5000;

  const buffer: string[] = [];
  let flushTimer: NodeJS.Timeout | null = null;
  let flushing = false;
  let headerEnsuredForDate = ''; // cache: which date's header has been written

  function ensureDir() {
    if (!fs.existsSync(auditDir)) {
      fs.mkdirSync(auditDir, { recursive: true });
    }
  }

  function dailyAuditPath(): string {
    const date = new Date().toISOString().slice(0, 10);
    return path.join(auditDir, `audit-${date}.md`);
  }

  function buildHeader(date: string): string {
    return `# ${date} 审计日志\n\n> 由 yaoyao-memory 自动生成，记录关键操作与降级决策\n\n---\n\n`;
  }

  function scheduleFlush() {
    if (!flushTimer && buffer.length > 0) {
      flushTimer = setTimeout(flush, flushIntervalMs);
    }
  }

  async function flush(): Promise<void> {
    if (flushing || buffer.length === 0) return;
    flushing = true;
    flushTimer = null;

    const batch = buffer.splice(0);
    const fp = dailyAuditPath();
    const date = path.basename(fp).slice(6, 16); // audit-YYYY-MM-DD.md

    try {
      ensureDir();

      // Ensure header only once per day
      let header = '';
      if (headerEnsuredForDate !== date || !fs.existsSync(fp)) {
        header = buildHeader(date);
        headerEnsuredForDate = date;
      }

      const content = header + batch.join('');
      await fs.promises.appendFile(fp, content, 'utf-8');
    } catch (err) {
      logger?.debug?.(
        `[yaoyao-memory:audit] Flush failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      // Re-enqueue failed batch to retry on next flush
      buffer.unshift(...batch);
    } finally {
      flushing = false;
      if (buffer.length > 0) {
        scheduleFlush();
      }
    }
  }

  function write(entry: AuditEntry): void {
    try {
      const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
      let lines = `\n## ${ts} [${entry.component}] ${entry.event}\n\n`;
      lines += `- **摘要**: ${entry.summary}\n`;

      if (entry.details && Object.keys(entry.details).length > 0) {
        for (const [k, v] of Object.entries(entry.details)) {
          if (v === undefined) continue;
          const display = typeof v === 'object' ? JSON.stringify(v).slice(0, 500) : String(v);
          lines += `- **${k}**: ${display}\n`;
        }
      }
      lines += '\n';

      buffer.push(lines);

      if (buffer.length >= bufferSize) {
        flush();
      } else {
        scheduleFlush();
      }
    } catch (err) {
      logger?.debug?.(
        `[yaoyao-memory:audit] Format failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Record an audit event (alias for write). */
  function record(event: string, details?: Record<string, unknown>): void {
    write({ component: 'yaoyao-memory', event, summary: event, details });
  }

  /** Synchronous flush for graceful shutdown */
  function flushSync(): void {
    if (buffer.length === 0) return;
    const batch = buffer.splice(0);
    const fp = dailyAuditPath();
    const date = path.basename(fp).slice(6, 16);

    try {
      ensureDir();
      let header = '';
      if (headerEnsuredForDate !== date || !fs.existsSync(fp)) {
        header = buildHeader(date);
        headerEnsuredForDate = date;
      }
      fs.appendFileSync(fp, header + batch.join(''), 'utf-8');
    } catch (err) {
      logger?.error?.(
        `[yaoyao-memory:audit] Sync flush failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return { write, flush, flushSync, record };
}

export type AuditLog = ReturnType<typeof createAuditLog>;
