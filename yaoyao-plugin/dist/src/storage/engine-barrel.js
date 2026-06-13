/**
 * storage/engine-barrel.ts — Barrel for storage engine imports.
 *
 * Reduces import statement count in bridge.ts.
 * Pure re-exports, no logic.
 */
export { createFtsEngine } from "./fts.js";
export { createVectorStore } from "./vector-store.js";
export { createHybridSearch } from "./hybrid.js";
