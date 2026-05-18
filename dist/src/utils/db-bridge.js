/**
 * utils/db-bridge.ts — BACKWARD COMPATIBILITY SHIM
 *
 * Re-exports createStorage as createDB for existing consumers.
 * New code should import directly from "../storage/bridge.ts".
 */
import { createStorage } from "../storage/bridge.js";
// Backward-compat: createDB was the old name
export { createStorage as createDB };
