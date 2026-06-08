/**
 * utils/db-bridge.ts — BACKWARD COMPATIBILITY SHIM
 *
 * Re-exports createStorage as createDB for existing consumers.
 * New code should import directly from "../storage/bridge.ts".
 */

import { createStorage } from '../storage/bridge.ts';
export type { SearchResult, EmbeddedSearchResult, DBStats, UnifiedDB } from '../storage/bridge.ts';

// Backward-compat: createDB was the old name
export { createStorage as createDB };

// Backward-compat type alias (used in 20+ feature files)
export type DBBridge = import('../storage/bridge.ts').Storage;
