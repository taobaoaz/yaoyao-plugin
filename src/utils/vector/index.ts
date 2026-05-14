/**
 * Vector backend factory — creates sqlite-vec (default) or hnswlib (optional).
 */
import type { UnifiedDB } from "../../platform/db/compat.js";
import type { PluginLogger } from "openclaw/plugin-sdk/plugin-entry";
import type { YaoyaoMemoryConfig } from "../memory-store.js";
import type { VectorBackend } from "./types.js";
import { SqliteVecBackend } from "./sqlite-vec.js";
import { HnswlibBackend } from "./hnswlib.js";

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
