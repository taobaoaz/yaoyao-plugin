import * as queryHelpers from "./query-helpers.js";
export function createQueryApi(ensureDB, vector) {
    return {
        getStats() {
            try {
                return queryHelpers.getStats(ensureDB(), vector);
            }
            catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                console.warn(`[yaoyao-memory:storage] Operation failed: ${msg}`);
                return { totalMemories: 0, datesSummary: [], ftsEnabled: false, vecEnabled: false, totalVectors: 0, dimensions: 0 };
            }
        },
        getAllTags() {
            return queryHelpers.getAllTags(ensureDB());
        },
        getAllMeta() {
            return queryHelpers.getAllMeta(ensureDB());
        },
        getConfig(key, defaultValue) {
            return queryHelpers.getConfig(ensureDB(), key, defaultValue);
        },
        setConfig(key, value) {
            queryHelpers.setConfig(ensureDB(), key, value);
        },
        updateMetadata(id, metadata) {
            queryHelpers.updateMetadata(ensureDB(), id, metadata);
        },
        incrementAccessCount(id) {
            queryHelpers.incrementAccessCount(ensureDB(), id);
        },
        getMemoryMeta(id) {
            return queryHelpers.getMemoryMeta(ensureDB(), id);
        },
        searchByMetaRelations(limit) {
            return queryHelpers.searchByMetaRelations(ensureDB(), limit);
        },
        countTags() {
            return queryHelpers.countTags(ensureDB());
        },
        getRecentRawMemories(limit) {
            return queryHelpers.getRecentRawMemories(ensureDB(), limit);
        },
        searchByLike(query, limit) {
            return queryHelpers.searchByLike(ensureDB(), query, limit);
        },
        batchSetConfig(entries) {
            queryHelpers.batchSetConfig(ensureDB(), entries);
        },
    };
}
