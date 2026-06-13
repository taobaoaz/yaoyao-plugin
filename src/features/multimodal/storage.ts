/**
 * features/multimodal/storage.ts — File-based storage for multimodal memories (v1.8.x hidden feature).
 *
 * Layout under <root>:
 *   index.json              # full array of MultimodalMemory
 *   meta/<id>.json          # per-memory metadata mirror
 *   content/<id>.<ext>      # raw binary (only for sourceType=base64)
 *
 * Single-process safe; atomic index writes via tmp+rename.
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, statSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import type { MultimodalMemory, MultimodalListFilter, Modality } from "./types.ts";

const META_SUBDIR = "meta";
const CONTENT_SUBDIR = "content";
const INDEX_FILE = "index.json";

function ensureDir(p) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

function atomicWriteJson(filePath, data) {
  ensureDir(dirname(filePath));
  const tmp = filePath + ".tmp";
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  try {
    renameSync(tmp, filePath);
  } catch {
    try { if (existsSync(filePath)) unlinkSync(filePath); } catch { /* ignore */ }
    writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    try { unlinkSync(tmp); } catch { /* ignore */ }
  }
}

function readJson(filePath, fallback) {
  if (!existsSync(filePath)) return fallback;
  try { return JSON.parse(readFileSync(filePath, "utf-8")); } catch { return fallback; }
}

export function sha256OfBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function newMultimodalId() {
  return "mm_" + randomUUID().replace(/-/g, "").slice(0, 16);
}

function safeExt(ext) {
  return (ext || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) || "bin";
}

export class MultimodalStorage {
  private root: string;

  constructor(rootDir: string) {
    this.root = rootDir;
    ensureDir(this.root);
    ensureDir(join(this.root, META_SUBDIR));
    ensureDir(join(this.root, CONTENT_SUBDIR));
  }

  loadIndex(): MultimodalMemory[] {
    return readJson(join(this.root, INDEX_FILE), []) as MultimodalMemory[];
  }

  saveIndex(entries: MultimodalMemory[]): void {
    atomicWriteJson(join(this.root, INDEX_FILE), entries);
  }

  saveContent(id: string, ext: string, bytes: Buffer | Uint8Array): { contentPath: string; sizeBytes: number; sha256: string } {
    const extN = safeExt(ext);
    const contentPath = join(this.root, CONTENT_SUBDIR, id + "." + extN);
    writeFileSync(contentPath, bytes);
    const stat = statSync(contentPath);
    return { contentPath, sizeBytes: stat.size, sha256: sha256OfBytes(bytes) };
  }

  resolveContentPath(id: string, ext: string): string | null {
    const p = join(this.root, CONTENT_SUBDIR, id + "." + safeExt(ext));
    return existsSync(p) ? p : null;
  }

  upsert(entry: MultimodalMemory): void {
    const idx = this.loadIndex();
    const i = idx.findIndex(e => e.id === entry.id);
    if (i >= 0) idx[i] = entry; else idx.push(entry);
    this.saveIndex(idx);
    atomicWriteJson(join(this.root, META_SUBDIR, entry.id + ".json"), entry);
  }

  remove(id: string, ext?: string): boolean {
    const idx = this.loadIndex();
    const entry = idx.find(e => e.id === id);
    if (!entry) return false;
    const next = idx.filter(e => e.id !== id);
    this.saveIndex(next);
    try { unlinkSync(join(this.root, META_SUBDIR, id + ".json")); } catch { /* ignore */ }
    if (ext) {
      try { unlinkSync(join(this.root, CONTENT_SUBDIR, id + "." + safeExt(ext))); } catch { /* ignore */ }
    }
    return true;
  }

  get(id: string): MultimodalMemory | null {
    return this.loadIndex().find(e => e.id === id) || null;
  }

  list(filter: MultimodalListFilter = {}) {
    let items = this.loadIndex();
    if (filter.type) items = items.filter(e => e.type === filter.type);
    if (filter.tags && filter.tags.length > 0) {
      const want = new Set(filter.tags);
      items = items.filter(e => e.tags.some(t => want.has(t)));
    }
    items.sort((a, b) => b.createdAt - a.createdAt);
    const total = items.length;
    const offset = Math.max(0, filter.offset || 0);
    const limit = Math.max(1, Math.min(1000, filter.limit || 50));
    return { items: items.slice(offset, offset + limit), total };
  }

  linkMemory(id: string, memoryId: string): boolean {
    const entry = this.get(id);
    if (!entry) return false;
    if (!entry.linkedMemoryIds.includes(memoryId)) {
      entry.linkedMemoryIds.push(memoryId);
      entry.updatedAt = Date.now();
      this.upsert(entry);
    }
    return true;
  }
}
