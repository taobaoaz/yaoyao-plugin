/**
 * core/conflict/detect.ts — BARREL (re-exports for backward compat)
 *
 * Split into:
 *   types.ts        → types + markers + defaults
 *   detection.ts    → conflict detection algorithm
 *   relation.ts     → relation suggestion + serialization
 *   formatter.ts    → output formatting
 */
export type {
  ConflictRelation, ConflictCandidate, ConflictSignals,
  ConflictRelationRecord, DetectConflictOptions,
} from "./types.ts";
export { CONTRADICTION_MARKERS, PREFERENCE_MARKERS, DECISION_MARKERS, DETECT_DEFAULTS } from "./types.ts";
export { detectConflicts } from "./detection.ts";
export { suggestRelation, canAutoResolve, serializeRelationRecord, parseRelationRecord } from "./relation.ts";
export { formatConflictCandidates } from "./formatter.ts";
