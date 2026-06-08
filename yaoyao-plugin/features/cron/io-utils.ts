/**
 * features/cron/io-utils.ts — Safe IO helpers for cron tool.
 */

import fs from 'node:fs';
import { execSync } from 'node:child_process';

export function safeReadJson(filePath: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[yaoyao-memory:cron] Operation failed: ${msg}`);
    return null;
  }
}

export function safeExec(cmd: string): string | null {
  try {
    return execSync(cmd, {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[yaoyao-memory:cron] Operation failed: ${msg}`);
    return null;
  }
}
