/**
 * Manifest Manager — 记录插件元数据到 `.metadata/manifest.json`。
 * 腾讯方案：记录 store 绑定信息、seed 运行记录、版本历史。
 * 零外部依赖，纯 Node.js fs。
 */

import fs from 'node:fs';
import path from 'node:path';

export interface ManifestData {
  /** Plugin version at first install */
  pluginVersion: string;
  /** Timestamp of first initialization (ISO 8601) */
  firstInitAt: string;
  /** Timestamp of last operation (ISO 8601) */
  lastOperationAt?: string;
  /** Last operation type */
  lastOperationType?: string;
  /** Store backend binding */
  storeBackend?: string;
  /** Number of seed runs performed */
  seedRunCount?: number;
  /** Last seed run timestamp */
  lastSeedAt?: string;
  /** Total memory entries indexed */
  totalEntries?: number;
}

const MANIFEST_DIR = '.metadata';
const MANIFEST_FILE = 'manifest.json';

/** Ensure manifest directory exists with correct permissions */
function ensureManifestDir(baseDir: string): string {
  const dir = path.join(baseDir, MANIFEST_DIR);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  return dir;
}

/** Read manifest or return default */
export function readManifest(baseDir: string): ManifestData | null {
  const file = path.join(ensureManifestDir(baseDir), MANIFEST_FILE);
  if (!fs.existsSync(file)) return null;
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    return JSON.parse(raw) as ManifestData;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[yaoyao-memory:utils] Operation failed: ${msg}`);
    return null;
  }
}

/** Write manifest atomically */
export function writeManifest(baseDir: string, data: ManifestData): void {
  const dir = ensureManifestDir(baseDir);
  const file = path.join(dir, MANIFEST_FILE);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/** Initialize manifest if not exists */
export function initManifest(baseDir: string, pluginVersion: string): ManifestData {
  const existing = readManifest(baseDir);
  if (existing) {
    // Update last operation timestamp on each startup
    existing.lastOperationAt = new Date().toISOString();
    existing.lastOperationType = 'startup';
    writeManifest(baseDir, existing);
    return existing;
  }
  const data: ManifestData = {
    pluginVersion,
    firstInitAt: new Date().toISOString(),
    lastOperationAt: new Date().toISOString(),
    lastOperationType: 'init',
    storeBackend: 'sqlite',
    seedRunCount: 0,
  };
  writeManifest(baseDir, data);
  return data;
}

/** Record a seed run */
export function recordSeedRun(baseDir: string, entryCount: number): void {
  const manifest = readManifest(baseDir);
  if (!manifest) return;
  manifest.seedRunCount = (manifest.seedRunCount ?? 0) + 1;
  manifest.lastSeedAt = new Date().toISOString();
  manifest.lastOperationAt = new Date().toISOString();
  manifest.lastOperationType = `seed:${entryCount}`;
  manifest.totalEntries = (manifest.totalEntries ?? 0) + entryCount;
  writeManifest(baseDir, manifest);
}

/** Record an operation (generic) */
export function recordOperation(
  baseDir: string,
  type: string,
  meta?: Record<string, unknown>,
): void {
  const manifest = readManifest(baseDir);
  if (!manifest) return;
  manifest.lastOperationAt = new Date().toISOString();
  manifest.lastOperationType = type;
  if (meta?.totalEntries !== undefined) {
    manifest.totalEntries = meta.totalEntries as number;
  }
  writeManifest(baseDir, manifest);
}
