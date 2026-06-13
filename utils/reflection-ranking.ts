/**
 * Reflection Ranking — Logistic decay scoring (from Brain v1.1.0)
 * Zero external dependency. Computes time-decayed memory relevance scores.
 */

export const REFLECTION_FALLBACK_SCORE_FACTOR = 0.75;

export interface ReflectionScoreInput {
  ageDays: number;
  midpointDays: number;
  k: number;
  baseWeight: number;
  quality: number;
  usedFallback: boolean;
}

/**
 * Logistic decay: 1 / (1 + e^(k * (age - midpoint)))
 * Returns 1.0 when age=0, ~0.5 at age=midpoint, →0 as age→∞.
 */
export function computeReflectionLogistic(ageDays: number, midpointDays: number, k: number): number {
  const safeAgeDays = Number.isFinite(ageDays) ? Math.max(0, ageDays) : 0;
  const safeMidpointDays = Number.isFinite(midpointDays) && midpointDays > 0 ? midpointDays : 1;
  const safeK = Number.isFinite(k) && k > 0 ? k : 0.1;
  return 1 / (1 + Math.exp(safeK * (safeAgeDays - safeMidpointDays)));
}

/**
 * Compute a composite reflection score combining:
 * - logistic time decay
 * - base weight (importance)
 * - quality (0-1)
 * - fallback penalty (if used fallback data)
 */
export function computeReflectionScore(input: ReflectionScoreInput): number {
  const logistic = computeReflectionLogistic(input.ageDays, input.midpointDays, input.k);
  const baseWeight = Number.isFinite(input.baseWeight) && input.baseWeight > 0 ? input.baseWeight : 1;
  const quality = Number.isFinite(input.quality) ? Math.max(0, Math.min(1, input.quality)) : 1;
  const fallbackFactor = input.usedFallback ? REFLECTION_FALLBACK_SCORE_FACTOR : 1;
  return logistic * baseWeight * quality * fallbackFactor;
}

/** Normalize a reflection line for aggregation/dedup. */
export function normalizeReflectionLineForAggregation(line: string): string {
  return String(line)
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/** Pre-configured decay defaults for different memory types. */
export const MEMORY_DECAY_DEFAULTS = {
  invariant: { midpointDays: 45, k: 0.22, baseWeight: 1.1, quality: 1 },
  derived: { midpointDays: 7, k: 0.65, baseWeight: 1, quality: 0.95 },
  decision: { midpointDays: 45, k: 0.25, baseWeight: 1.1, quality: 1 },
  userModel: { midpointDays: 21, k: 0.3, baseWeight: 1, quality: 0.95 },
  agentModel: { midpointDays: 10, k: 0.35, baseWeight: 0.95, quality: 0.93 },
  lesson: { midpointDays: 7, k: 0.45, baseWeight: 0.9, quality: 0.9 },
} as const;

export type MemoryDecayPreset = keyof typeof MEMORY_DECAY_DEFAULTS;

/**
 * Compute score using a named preset.
 */
export function computePresetReflectionScore(
  preset: MemoryDecayPreset,
  ageDays: number,
  usedFallback = false,
): number {
  const defaults = MEMORY_DECAY_DEFAULTS[preset];
  return computeReflectionScore({
    ageDays,
    midpointDays: defaults.midpointDays,
    k: defaults.k,
    baseWeight: defaults.baseWeight,
    quality: defaults.quality,
    usedFallback,
  });
}
