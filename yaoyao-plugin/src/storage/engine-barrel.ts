/**
 * storage/engine-barrel.ts — Barrel for storage engine imports.
 *
 * Reduces import statement count in bridge.ts.
 * Pure re-exports, no logic.
 */
export { createFtsEngine, type FtsEngine } from "./fts.ts";
export { createVectorStore, type VectorStore } from "./vector-store.ts";
export { createHybridSearch, type HybridSearch } from "./hybrid.ts";
