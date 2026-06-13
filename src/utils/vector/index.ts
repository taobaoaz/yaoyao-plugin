/**
 * Vector backend factory — creates sqlite-vec (default) or hnswlib (optional).
 */
import type { UnifiedDB } from "../../platform/db/compat.ts";
import type { PluginLogger } from "../../openclaw-sdk/plugin-entry.ts";
import type { YaoyaoMemoryConfig } from "../memory-store.ts";
import type { VectorBackend } from "./types.ts";
import { SqliteVecBackend } from "./sqlite-vec.ts";
import { HnswlibBackend } from "./hnswlib.ts";

export function createVectorBackend(
  db: UnifiedDB,
  config: YaoyaoMemoryConfig,
  logger?: PluginLogger
): VectorBackend {
  const requested = (config.embedding?.vectorBackend || "sqlite-vec").toLowerCase().trim();

  if (requested === "hnswlib") {
    const hnsw = new HnswlibBackend();
    if (hnsw.init(db, config, logger)) {
      return hnsw;
    }
    logger?.warn?.(
      `[yaoyao-memory:vec] hnswlib requested but unavailable — falling back to sqlite-vec. ` +
      "Install with: npm install hnswlib-node"
    );
  }

  // Default or fallback
  const sqlite = new SqliteVecBackend();
  sqlite.init(db, config, logger);
  return sqlite;
}
