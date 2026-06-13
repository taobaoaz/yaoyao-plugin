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
import { syncMarkdownToFTS } from "./md-sync.ts";

/** Background startup tasks that don't block startup */
export function runStartupTasks(
  api: OpenClawPluginApi,
  config: YaoyaoMemoryConfig,
  storage: Storage,
  store: { baseDir: string },
): void {
  // ── 6a. Markdown → SQLite sync (fixes dual-storage drift) ──
  try {
    const syncResult = syncMarkdownToFTS(store.baseDir, storage, api.logger);
    if (syncResult.imported > 0) {
      api.logger.info?.(`[yaoyao-memory:md-sync] Imported ${syncResult.imported} turns from .md files`);
    }
  } catch (e) {
    api.logger.debug?.(`[yaoyao-memory:md-sync] Not available: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ── 6b. Text compaction ──
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
          id: String(e.id), text: (e.snippet ?? e.filename), category: "general" as const,
          importance: 0.5, timestamp: Date.now(), scope: "global",
        })),
        cfg,
      );
      if (result.clustersFound > 0) {
        api.logger.info?.(`[yaoyao-memory:compactor] ${result.clustersFound} clusters found`);
      }
    }
  } catch { /* best-effort */ }

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
      } catch { /* ignore */ }
      return { id: String(r.id), tier, importance, accessCount, createdAt, decayScore };
    });
    const transitions = evaluateAllTiers(tierable, DEFAULT_TIER_CONFIG);
    if (transitions.length > 0) {
      api.logger.info?.(`[yaoyao-memory:tier] ${transitions.length} tier transitions pending`);
    }
  } catch { /* best-effort */ }
}
