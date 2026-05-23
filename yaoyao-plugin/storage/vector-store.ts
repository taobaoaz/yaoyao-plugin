/**
 * storage/vector-store.ts — Vector search storage operations.
 *
 * Thin wrapper around the pluggable vector backend.
 * Extracted from db-bridge.ts.
 */
import type { UnifiedDB } from "../platform/db/types.ts";
import type { YaoyaoMemoryConfig } from "../utils/memory-store.ts";
import type { PluginLogger } from "openclaw/plugin-sdk/plugin-entry";
import { createVectorBackend } from "../utils/vector/index.ts";
import type { VectorBackend } from "../utils/vector/types.ts";
import type { EmbeddedSearchResult } from "./types.ts";

export function createVectorStore(config: YaoyaoMemoryConfig, logger?: PluginLogger) {
  let backend: VectorBackend | null = null;
  let vecEnabled = false;

  return {
    /** Initialize vector backend. Must be called after DB is available. */
    init(db: UnifiedDB): void {
      backend = createVectorBackend(db, config, logger);
      vecEnabled = backend?.isAvailable ?? false;
    },

    get isAvailable(): boolean {
      return vecEnabled;
    },

    get name(): string {
      return backend?.name ?? "none";
    },

    /** Vector similarity search. */
    search(embedding: Float32Array, limit: number = 10): EmbeddedSearchResult[] {
      return backend?.vectorSearch(embedding, limit) ?? [];
    },

    /** Store a vector embedding. */
    store(metaId: number, embedding: Float32Array): boolean {
      return backend?.storeVector(metaId, embedding) ?? false;
    },

    /** Get vector count. */
    count(): number {
      return backend?.getVectorCount?.() ?? 0;
    },

    /** Get dimensions. */
    dimensions(): number {
      if (backend?.getDimensions) return backend.getDimensions();
      return (config.embedding && typeof config.embedding === 'object' && 'dimensions' in config.embedding)
        ? Number((config.embedding as Record<string, unknown>).dimensions ?? 0)
        : 0;
    },

    /** Clean up orphaned vectors. */
    deleteOrphans(): void {
      try { backend?.deleteOrphans?.(); } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[yaoyao-memory]  best effort : ${msg}`);
    }
    },

    /** Close backend. */
    close(): void {
      backend?.close();
      backend = null;
      vecEnabled = false;
    },
  };
}

export type VectorStore = ReturnType<typeof createVectorStore>;
