/**
 * Tier Manager — Three-tier memory promotion/demotion (from Brain v1.1.0)
 * Zero external dependency, adapted for yaoyao's pure-local decay.
 *
 * Tiers:
 * - Core (decay floor 0.9): Identity-level facts, almost never forgotten
 * - Working (decay floor 0.7): Active context, ages out without reinforcement
 * - Peripheral (decay floor 0.5): Low-priority or aging memories
 */

export type MemoryTier = 'core' | 'working' | 'peripheral';

export interface TierConfig {
  /** Minimum access count for Core promotion (default: 10) */
  coreAccessThreshold: number;
  /** Minimum decay score for Core promotion (default: 0.7) */
  coreDecayThreshold: number;
  /** Minimum importance for Core promotion (default: 0.8) */
  coreImportanceThreshold: number;
  /** Decay score below which to demote to Peripheral (default: 0.15) */
  peripheralDecayThreshold: number;
  /** Age in days after which infrequent memories demote to Peripheral (default: 60) */
  peripheralAgeDays: number;
  /** Minimum access count for Working promotion from Peripheral (default: 3) */
  workingAccessThreshold: number;
  /** Minimum decay score for Working promotion from Peripheral (default: 0.4) */
  workingDecayThreshold: number;
}

export const DEFAULT_TIER_CONFIG: TierConfig = {
  coreAccessThreshold: 10,
  coreDecayThreshold: 0.7,
  coreImportanceThreshold: 0.8,
  peripheralDecayThreshold: 0.15,
  peripheralAgeDays: 60,
  workingAccessThreshold: 3,
  workingDecayThreshold: 0.4,
};

export interface TierTransition {
  memoryId: string;
  fromTier: MemoryTier;
  toTier: MemoryTier;
  reason: string;
}

export interface TierableMemory {
  id: string;
  tier: MemoryTier;
  importance: number;
  accessCount: number;
  createdAt: number;
  decayScore: number; // 0-1, higher = more alive
}

export function evaluateTier(
  memory: TierableMemory,
  cfg: TierConfig = DEFAULT_TIER_CONFIG,
  now: number = Date.now(),
): TierTransition | null {
  const ageDays = (now - memory.createdAt) / 86400000;

  // Promotion checks (high decay + high access + high importance)
  if (memory.tier === 'peripheral') {
    if (
      memory.accessCount >= cfg.workingAccessThreshold &&
      memory.decayScore >= cfg.workingDecayThreshold
    ) {
      return {
        memoryId: memory.id,
        fromTier: 'peripheral',
        toTier: 'working',
        reason: `access=${memory.accessCount}, decay=${memory.decayScore.toFixed(2)}`,
      };
    }
  }

  if (memory.tier === 'working') {
    if (
      memory.accessCount >= cfg.coreAccessThreshold &&
      memory.decayScore >= cfg.coreDecayThreshold &&
      memory.importance >= cfg.coreImportanceThreshold
    ) {
      return {
        memoryId: memory.id,
        fromTier: 'working',
        toTier: 'core',
        reason: `access=${memory.accessCount}, decay=${memory.decayScore.toFixed(2)}, importance=${memory.importance}`,
      };
    }
  }

  // Demotion checks (low decay or old age)
  if (memory.tier === 'core') {
    if (
      memory.decayScore < cfg.coreDecayThreshold ||
      (ageDays > cfg.peripheralAgeDays && memory.accessCount < cfg.coreAccessThreshold / 2)
    ) {
      return {
        memoryId: memory.id,
        fromTier: 'core',
        toTier: 'working',
        reason: `decay=${memory.decayScore.toFixed(2)} or age=${ageDays.toFixed(0)}d`,
      };
    }
  }

  if (memory.tier === 'working') {
    if (
      memory.decayScore < cfg.peripheralDecayThreshold ||
      (ageDays > cfg.peripheralAgeDays && memory.accessCount < cfg.workingAccessThreshold)
    ) {
      return {
        memoryId: memory.id,
        fromTier: 'working',
        toTier: 'peripheral',
        reason: `decay=${memory.decayScore.toFixed(2)} or age=${ageDays.toFixed(0)}d`,
      };
    }
  }

  return null;
}

export function evaluateAllTiers(
  memories: TierableMemory[],
  cfg: TierConfig = DEFAULT_TIER_CONFIG,
  now: number = Date.now(),
): TierTransition[] {
  return memories
    .map((m) => evaluateTier(m, cfg, now))
    .filter((t): t is TierTransition => t !== null);
}
