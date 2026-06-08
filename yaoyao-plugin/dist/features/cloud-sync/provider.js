/**
 * features/cloud-sync/provider.ts — Barrel: re-exports all cloud-sync submodules.
 *
 * Kept for backward compatibility with existing imports.
 * New code should import from the specific submodule.
 */
export { loadSyncState, saveSyncState, remotePath, markSynced } from "./state.js";
export { doUpload, doDownload, doBidirectional, } from "./sync-ops.js";
export { TEMPLATE } from "./template.js";
