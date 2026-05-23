/**
 * hooks/capture-barrel.ts — Barrel for capture-related imports.
 *
 * Reduces import statement count in auto-capture.ts.
 * Pure re-exports, no logic.
 */
export { shouldCaptureTurn, trackSessionActivity } from "./capture-filter.js";
export { getCaptureConfig, buildCaptureContext, estimateConversation, shouldSkipContent, handleMermaidOffload } from "./capture-pipeline.js";
export { runAntiHallucination, buildMetaObj } from "./capture-meta.js";
export { evaluateWatermark } from "./capture-watermark.js";
export { createPersistHandlers } from "./persist-handlers.js";
