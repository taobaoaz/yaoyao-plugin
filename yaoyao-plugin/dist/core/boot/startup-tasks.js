import { runTextCompaction } from "../../core/compactor/index.js";
import { evaluateAllTiers, DEFAULT_TIER_CONFIG } from "../../utils/tier-manager.js";
/** Background tasks that don't block startup */
export function runStartupTasks(api, config, storage, store) {
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
            const result = runTextCompaction(allEntries.map((e) => ({
                id: String(e.id),
                text: e.filename,
                category: 'general',
                importance: 0.5,
                timestamp: Date.now(),
                scope: 'global',
            })), cfg);
            if (result.clustersFound > 0) {
                api.logger.info?.(`[yaoyao-memory:compactor] ${result.clustersFound} clusters found`);
            }
        }
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        api.logger.warn?.(`[yaoyao-memory:startup] Compaction failed: ${msg}`);
    }
    try {
        const rawDb = storage.getRawDb();
        const rows = rawDb
            .prepare('SELECT id, metadata, access_count, created_at FROM memory_meta WHERE metadata IS NOT NULL')
            .all();
        const tierable = rows.map((r) => {
            let tier = 'working', importance = 0.5, accessCount = r.access_count ?? 0, decayScore = 0.5;
            const createdAt = r.created_at ?? Date.now();
            try {
                const meta = JSON.parse(r.metadata || '{}');
                tier = meta.tier || 'working';
                importance = typeof meta.importance === 'number' ? meta.importance : 0.5;
                accessCount =
                    typeof meta.accessCount === 'number' ? meta.accessCount : (r.access_count ?? 0);
                decayScore = typeof meta.decayScore === 'number' ? meta.decayScore : 0.5;
            }
            catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                api.logger.debug?.(`[yaoyao-memory:startup] Parse metadata failed for id=${r.id}: ${msg}`);
            }
            return { id: String(r.id), tier, importance, accessCount, createdAt, decayScore };
        });
        const transitions = evaluateAllTiers(tierable, DEFAULT_TIER_CONFIG);
        if (transitions.length > 0) {
            api.logger.info?.(`[yaoyao-memory:tier] ${transitions.length} tier transitions pending`);
        }
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        api.logger.warn?.(`[yaoyao-memory:startup] Tier evaluation failed: ${msg}`);
    }
}
