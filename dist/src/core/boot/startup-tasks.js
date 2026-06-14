import { runTextCompaction } from "../../core/compactor/index.js";
import { evaluateAllTiers, DEFAULT_TIER_CONFIG, getTtlDaysByType } from "../../utils/tier-manager.js";
import { syncMarkdownToFTS } from "./md-sync.js";
/** Background startup tasks that don't block startup */
export function runStartupTasks(api, config, storage, store) {
    // ── 6a. Markdown → SQLite sync (fixes dual-storage drift) ──
    try {
        const syncResult = syncMarkdownToFTS(store.baseDir, storage, api.logger);
        if (syncResult.imported > 0) {
            api.logger.info?.(`[yaoyao-memory:md-sync] Imported ${syncResult.imported} turns from .md files`);
        }
    }
    catch (e) {
        api.logger.debug?.(`[yaoyao-memory:md-sync] Not available: ${e instanceof Error ? e.message : String(e)}`);
    }
    // ── 6b. Text compaction ──
    try {
        const allEntries = storage.getAllMeta ? storage.getAllMeta() : [];
        const cfg = {
            enabled: config.compaction?.enabled ?? true,
            minAgeDays: config.compaction?.minAgeDays ?? 7,
            similarityThreshold: config.compaction?.similarityThreshold ?? 0.5,
            minClusterSize: config.compaction?.minClusterSize ?? 2,
            maxEntriesToScan: config.compaction?.maxEntriesToScan ?? 200,
            dryRun: config.compaction?.dryRun ?? false,
        };
        if (cfg.enabled && allEntries.length > 0) {
            const result = runTextCompaction(allEntries.map(e => ({
                id: String(e.id), text: e.filename, category: "general",
                importance: 0.5, timestamp: Date.now(), scope: "global",
            })), cfg);
            if (result.clustersFound > 0) {
                api.logger.info?.(`[yaoyao-memory:compactor] ${result.clustersFound} clusters found`);
            }
        }
    }
    catch { /* best-effort */ }
    try {
        const rawDb = storage.getRawDb();
        const rows = rawDb.prepare("SELECT id, meta, access_count, created_at FROM yaoyao_meta WHERE meta IS NOT NULL").all();
        const tierable = rows.map(r => {
            let tier = "working", importance = 0.5, accessCount = r.access_count ?? 0, createdAt = r.created_at ?? Date.now(), decayScore = 0.5;
            let memoryType = null;
            try {
                const meta = JSON.parse(r.meta || "{}");
                tier = meta.tier || "working";
                importance = typeof meta.importance === "number" ? meta.importance : 0.5;
                accessCount = typeof meta.accessCount === "number" ? meta.accessCount : (r.access_count ?? 0);
                decayScore = typeof meta.decayScore === "number" ? meta.decayScore : 0.5;
                memoryType = typeof meta.memory_type === "string" ? meta.memory_type : null;
            }
            catch { /* ignore */ }
            // v1.9.0: re-derive decayScore with type-aware TTL so fact vs event
            // memories age on different curves. Older `decayScore` (if present)
            // is preserved as a baseline so we do not regress in a single tick.
            const ttlDays = getTtlDaysByType(memoryType);
            const ageMs = Date.now() - createdAt;
            const ageDays = ageMs / 86_400_000;
            const typeDecay = Math.max(0, 1 - ageDays / ttlDays);
            decayScore = Math.max(decayScore, typeDecay);
            return { id: String(r.id), tier, importance, accessCount, createdAt, decayScore };
        });
        const transitions = evaluateAllTiers(tierable, DEFAULT_TIER_CONFIG);
        if (transitions.length > 0) {
            api.logger.info?.(`[yaoyao-memory:tier] ${transitions.length} tier transitions pending`);
        }
    }
    catch { /* best-effort */ }
}
