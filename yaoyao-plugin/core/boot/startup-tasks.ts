/**
 * core/boot/startup-tasks.ts — Background startup tasks.
 *
 * Extracted from app.ts's runStartupTasks function.
 */
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { YaoyaoMemoryConfig } from "../../utils/memory-store.ts";
import type { Storage } from "../../storage/bridge.ts";
import type { MemoryTier } from "../../utils/tier-manager.ts";
import { runTextCompaction } from "../../core/compactor/index.ts";
import { evaluateAllTiers, DEFAULT_TIER_CONFIG } from "../../utils/tier-manager.ts";
import type { TierableMemory } from "../../utils/tier-manager.ts";

/** Background tasks that don't block startup */
export function runStartupTasks(
  api: OpenClawPluginApi,
  config: YaoyaoMemoryConfig,
  storage: Storage,
  store: { baseDir: string },
): void {
  try {
    const allEntries = storage.getAllMeta ? storage.getAllMeta() : [];
    const cfg = {
      enabled: (config.compaction?.enabled as boolean) ?? true,
      minAgeDays: (config.compaction?.minAgeDays as number) ?? 7,
      similarityThreshold: (config.compaction?.similarityThreshold as number) ?? 0.5,
      minClusterSize: (config.compaction?.minClusterSize as number) ?? 2,
      maxEntriesToScan: (config.compaction?.maxEntriesToScan as number) ?? 200,
      dryRun: (config.compaction?.dryRun as boolean) ?? false,
    };
    if (cfg.enabled && allEntries.length > 0) {
      const result = runTextCompaction(
        allEntries.map(e => ({
          id: String(e.id), text: e.filename, category: "general" as const,
          importance: 0.5, timestamp: Date.now(), scope: "global",
        })),
        cfg,
      );
      if (result.clustersFound > 0) {
        api.logger.info?.(`[yaoyao-memory:compactor] ${result.clustersFound} clusters found`);
      }
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    api.logger.warn?.(`[yaoyao-memory:startup] Compaction failed: ${msg}`);
  }

  try {
    const rawDb = storage.getRawDb();
    const rows = rawDb.prepare(
      "SELECT id, metadata, access_count, created_at FROM memory_meta WHERE metadata IS NOT NULL"
    ).all() as Array<{ id: number; metadata: string | null; access_count: number | null; created_at: number | null }>;
    const tierable: TierableMemory[] = rows.map(r => {
      let tier = "working" as MemoryTier, importance = 0.5, accessCount = r.access_count ?? 0, createdAt = r.created_at ?? Date.now(), decayScore = 0.5;
      try {
        const meta = JSON.parse(r.metadata || "{}") as Record<string, unknown>;
        tier = (meta.tier as MemoryTier) || "working";
        importance = typeof meta.importance === "number" ? meta.importance : 0.5;
        accessCount = typeof meta.accessCount === "number" ? meta.accessCount : (r.access_count ?? 0);
        decayScore = typeof meta.decayScore === "number" ? meta.decayScore : 0.5;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        api.logger.debug?.(`[yaoyao-memory:startup] Parse metadata failed for id=${r.id}: ${msg}`);
      }
      return { id: String(r.id), tier, importance, accessCount, createdAt, decayScore };
    });
    const transitions = evaluateAllTiers(tierable, DEFAULT_TIER_CONFIG);
    if (transitions.length > 0) {
      api.logger.info?.(`[yaoyao-memory:tier] ${transitions.length} tier transitions pending`);
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    api.logger.warn?.(`[yaoyao-memory:startup] Tier evaluation failed: ${msg}`);
  }
}
