/**
 * utils/check-barrel.ts — Barrel for health/install check utilities.
 *
 * Reduces import statement count in core/app.ts.
 * Pure re-exports, no logic.
 */
export { runHealthcheck } from "./healthcheck.js";
export { runInstallCheck, formatInstallCheck } from "./install-check.js";
export { detectScheduledResetRisks, formatResetRiskReport } from "./reset-detector.js";
