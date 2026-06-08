/**
 * hooks/capture-barrel.ts — Barrel for capture-related imports.
 *
 * Reduces import statement count in auto-capture.ts.
 * Pure re-exports, no logic.
 */
export { shouldCaptureTurn, trackSessionActivity } from './capture-filter.ts';
export {
  getCaptureConfig,
  buildCaptureContext,
  estimateConversation,
  shouldSkipContent,
  handleMermaidOffload,
} from './capture-pipeline.ts';
export { runAntiHallucination, buildMetaObj } from './capture-meta.ts';
export { evaluateWatermark } from './capture-watermark.ts';
export { createPersistHandlers } from './persist-handlers.ts';
