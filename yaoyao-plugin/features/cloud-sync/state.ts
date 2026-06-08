/**
 * features/cloud-sync/state.ts — Sync state persistence.
 *
 * Load/save sync state + remote path helpers.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { SyncState } from '../../core/cloud/cloud.ts';

export const REMOTE_BASE = 'yaoyao-memory';
export const SYNC_STATE_FILE = '.cloud-sync-state.json';
export const SYNC_MARKER = '.sync-source';

export function remotePath(filename: string): string {
  return `${REMOTE_BASE}/${filename}`;
}

export function loadSyncState(baseDir: string): SyncState {
  const fp = path.join(baseDir, SYNC_STATE_FILE);
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf-8'));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[yaoyao-memory:cloud-sync] Operation failed: ${msg}`);
    return { lastSync: 0, uploaded: [], downloaded: [] };
  }
}

export function saveSyncState(baseDir: string, state: SyncState): void {
  const fp = path.join(baseDir, SYNC_STATE_FILE);
  fs.writeFileSync(fp, JSON.stringify(state, null, 2), 'utf-8');
}

export function markSynced(filePath: string, provider: string, baseDir: string): void {
  try {
    const rel = path.relative(baseDir, filePath);
    const markerDir = path.join(baseDir, '.sync-meta');
    const markerPath = path.join(markerDir, rel + SYNC_MARKER);
    fs.mkdirSync(markerDir, { recursive: true });
    fs.writeFileSync(markerPath, JSON.stringify({ provider, time: Date.now() }), 'utf-8');
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[yaoyao-memory]  best effort : ${msg}`);
  }
}
