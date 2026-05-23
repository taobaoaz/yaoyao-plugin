/**
 * core/search/multi-signal.ts — BARREL (re-exports)
 *
 * Split into signal-fusion.ts + multi-signal-formatter.ts.
 * New code should import from the specific submodule.
 */
export { multiSignalFusion } from "./signal-fusion.js";
export { formatMultiSignalResults } from "./multi-signal-formatter.js";
