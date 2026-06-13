/**
 * storage/query-api.ts — Query API factory for Storage.
 *
 * Encapsulates all read-only and config query methods.
 */
import type { UnifiedDB } from "../platform/db/compat.ts";
import type { VectorStore } from "./vector-store.ts";
import type { DBStats, SearchResult } from "./types.ts";
import * as queryHelpers from "./query-helpers.ts";

export interface QueryApi {
  getStats(): DBStats;
  getAllTags(): Array<{ tag: string; memory_id: number }>;
  getAllMeta(): Array<{ id: number; filename: string }>;
  getConfig(key: string, defaultValue?: string | null): string | null;
  setConfig(key: string, value: string): void;
  updateMetadata(id: number, metadata: string): void;
  incrementAccessCount(id: number): void;
  getMemoryMeta(id: number): string | null;
  searchByMetaRelations(limit: number): Array<{ id: number; date: string; user_text: string | null; meta: string }>;
  countTags(): { total: number; unique: number };
  getRecentRawMemories(limit: number): Array<{ id: number; user_text: string; asst_text: string; date: string }>;
  searchByLike(query: string, limit: number): Array<{ id: number; user_text: string; asst_text: string; date: string }>;
  batchSetConfig(entries: Array<{ key: string; value: string }>): void;
}

export function createQueryApi(ensureDB: () => UnifiedDB, vector: VectorStore | null): QueryApi {
  return {
    getStats(): DBStats {
      try { return queryHelpers.getStats(ensureDB(), vector); } catch { return { totalMemories: 0, datesSummary: [], ftsEnabled: false, vecEnabled: false, totalVectors: 0, dimensions: 0 }; }
    },
    getAllTags(): Array<{ tag: string; memory_id: number }> {
      return queryHelpers.getAllTags(ensureDB());
    },
    getAllMeta(): Array<{ id: number; filename: string }> {
      return queryHelpers.getAllMeta(ensureDB());
    },
    getConfig(key: string, defaultValue?: string | null): string | null {
      return queryHelpers.getConfig(ensureDB(), key, defaultValue);
    },
    setConfig(key: string, value: string): void {
      queryHelpers.setConfig(ensureDB(), key, value);
    },
    updateMetadata(id: number, metadata: string): void {
      queryHelpers.updateMetadata(ensureDB(), id, metadata);
    },
    incrementAccessCount(id: number): void {
      queryHelpers.incrementAccessCount(ensureDB(), id);
    },
    getMemoryMeta(id: number): string | null {
      return queryHelpers.getMemoryMeta(ensureDB(), id);
    },
    searchByMetaRelations(limit: number): Array<{ id: number; date: string; user_text: string | null; meta: string }> {
      return queryHelpers.searchByMetaRelations(ensureDB(), limit);
    },
    countTags(): { total: number; unique: number } {
      return queryHelpers.countTags(ensureDB());
    },
    getRecentRawMemories(limit: number): Array<{ id: number; user_text: string; asst_text: string; date: string }> {
      return queryHelpers.getRecentRawMemories(ensureDB(), limit);
    },
    searchByLike(query: string, limit: number): Array<{ id: number; user_text: string; asst_text: string; date: string }> {
      return queryHelpers.searchByLike(ensureDB(), query, limit);
    },
    batchSetConfig(entries: Array<{ key: string; value: string }>): void {
      queryHelpers.batchSetConfig(ensureDB(), entries);
    },
  };
}
