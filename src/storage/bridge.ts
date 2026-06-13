/**
 * storage/bridge.ts — Thin storage facade.
 *
 * Single entry point that delegates to:
 *   - fts.ts          (FTS5 indexing & search)
 *   - vector-store.ts (vector search)
 *   - hybrid.ts       (RRF / weighted fusion)
 *   - schema.ts       (table definitions)
 *
 * Previously utils/db-bridge.ts was a 629-line monolith.
 * Now each engine lives in its own <200-line file.
 */
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { getProp } from "../utils/config.ts";
import { clampNum } from "../utils/clamp.ts";
import { createCompatDB, type UnifiedDB, type DBCompatResult } from "../platform/db/compat.ts";
import type { PluginLogger } from "../openclaw-sdk/plugin-entry.ts";
import type { YaoyaoMemoryConfig } from "../utils/memory-store.ts";
import { ensureSchema } from "./schema.ts";
import { createFtsEngine, type FtsEngine, createVectorStore, type VectorStore, createHybridSearch, type HybridSearch } from "./engine-barrel.ts";
import type { SearchResult, EmbeddedSearchResult } from "./types.ts";
import * as hybridHelpers from "./hybrid-helpers.ts";
import { setupWAL, setLoggerRef } from "./wal-setup.ts";
import { createQueryApi } from "./query-api.ts";

export type { SearchResult, EmbeddedSearchResult, DBStats } from "./types.ts";
export type { UnifiedDB, SQLiteRow } from "../platform/db/types.ts";
export { createCompatDB } from "../platform/db/compat.ts";


export function createStorage(config: YaoyaoMemoryConfig, logger?: PluginLogger) {
  const baseDir = path.resolve(
    config.memoryDir || path.join(os.homedir(), ".openclaw", "workspace", "memory")
  );
  if (/[\x00-\x1f]/.test(baseDir)) throw new TypeError("memoryDir contains invalid control characters");

  setLoggerRef(logger);
  const dbPath = path.join(baseDir, ".yaoyao.db");
  const log = (msg: string) => logger?.debug?.(`[yaoyao:storage] ${msg}`);

  // Config
  const snippetMaxLen = clampNum(getProp(config, "snippetMaxLen", 500), 500, 100, 5000);
  const searchMaxLimit = clampNum(getProp(config, "searchMaxLimit", 100), 100, 10, 1000);
  const likeFallbackScore = clampNum(getProp(config, "likeFallbackScore", 0.5), 0.5, 0.1, 1);

  // Init state
  let db: UnifiedDB | null = null;
  let initFailed = false;
  let initAttempts = 0;
  const MAX_INIT_ATTEMPTS = 3;
  let dbBackend: DBCompatResult | null = null;

  // Engines (lazily initialized)
  let fts: FtsEngine | null = null;
  let vector: VectorStore | null = null;
  let hybrid: HybridSearch | null = null;

  // WAL checkpoint timer
  let walCheckTimer: ReturnType<typeof setInterval> | null = null;

  function ensureDB(): UnifiedDB {
    if (!db && !initFailed) init();
    if (!db) throw new Error("Database failed to initialize");
    return db;
  }

  /** Initialize database — create tables, engines. Retries up to 3×. */
  function init(): boolean {
    if (db) return true;
    if (initFailed && initAttempts >= MAX_INIT_ATTEMPTS) {
      logger?.error?.(`[yaoyao:storage] Init exceeded ${MAX_INIT_ATTEMPTS} attempts — giving up`);
      return false;
    }
    initAttempts++;
    initFailed = false; // reset to allow this attempt
    try {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });

      dbBackend = createCompatDB(dbPath, { allowExtension: true }, logger);
      db = dbBackend.db;

      // WAL setup
      setupWAL(db, dbPath, dbBackend, log);

      // WAL passive checkpoint timer
      walCheckTimer = setInterval(() => {
        try { db?.exec("PRAGMA wal_checkpoint(PASSIVE)"); } catch { /* ignore */ }
      }, 60 * 60 * 1000);
      walCheckTimer.unref();

      // Create tables
      ensureSchema(db);

      // Initialize engines
      fts = createFtsEngine({ snippetMaxLen, searchMaxLimit, likeFallbackScore });
      vector = createVectorStore(config, logger);
      vector.init(db);
      hybrid = createHybridSearch();

      const dbType = dbBackend.backend;
      const vecName = vector.name;
      log(`Storage initialized: ${dbPath} (db=${dbType}, vec=${vecName})`);
      return true;
    } catch (err: unknown) {
      logger?.error?.(`[yaoyao:storage] Init attempt ${initAttempts} failed: ${(err as Error).message}`);
      initFailed = true;
      return false;
    }
  }

  // ── Public API (mirrors DBBridge interface for backward compat) ──

  const queryApi = createQueryApi(ensureDB, vector);

  return {
    init,

    indexTurn(userText: string, asstText: string, date: string, meta?: string): number {
      return fts!.indexTurn(ensureDB(), userText, asstText, date, meta);
    },

    search(query: string, limit: number = 10): SearchResult[] {
      return fts!.search(ensureDB(), query, limit);
    },

    searchAll(limit: number = 10): SearchResult[] {
      return fts!.searchAll(ensureDB(), limit);
    },

    vectorSearch(embedding: Float32Array, limit: number = 10): EmbeddedSearchResult[] {
      return vector!.search(embedding, limit);
    },

    hybridSearch(query: string, embedding: Float32Array | null, limit: number = 10): EmbeddedSearchResult[] {
      return hybridHelpers.hybridSearch(ensureDB(), query, embedding, limit, fts!, vector!, hybrid!);
    },

    rrfHybridSearch(query: string, embedding: Float32Array | null, limit: number = 10, k = 60): EmbeddedSearchResult[] {
      return hybridHelpers.rrfHybridSearch(ensureDB(), query, embedding, limit, k, fts!, vector!, hybrid!);
    },

    storeVector(metaId: number, embedding: Float32Array): boolean {
      return vector!.store(metaId, embedding);
    },

    deleteByDate(date: string): number {
      const d = ensureDB();
      const count = fts!.deleteByDate(d, date);
      if (count > 0) {
        fts!.scheduleRebuild(d);
        vector!.deleteOrphans();
      }
      return count;
    },

    deleteByKeyword(keyword: string): number {
      const d = ensureDB();
      const count = fts!.deleteByKeyword(d, keyword);
      if (count > 0) {
        fts!.scheduleRebuild(d);
        vector!.deleteOrphans();
      }
      return count;
    },

    getLatestMemory(limit: number = 1): SearchResult[] {
      return fts!.searchAll(ensureDB(), limit);
    },

    getLocalDate(tz?: string): string {
      try {
        return new Date().toLocaleDateString("sv-SE", { timeZone: tz || "Asia/Shanghai" });
      } catch {
        return new Date().toISOString().slice(0, 10);
      }
    },

    close(): void {
      if (walCheckTimer) { clearInterval(walCheckTimer); walCheckTimer = null; }
      vector?.close();
      if (db) { try { db.close(); } catch { /* ignore */ } db = null; }
      fts = null;
      hybrid = null;
      initFailed = false;
    },

    /** Backward-compat: direct raw DB access for tools that need it. */
    getRawDb(): UnifiedDB {
      return ensureDB();
    },

    /** Backward-compat alias */
    dbPath,

    ...queryApi,
  };
}

export type Storage = ReturnType<typeof createStorage>;
