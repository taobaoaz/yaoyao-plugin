import { createVectorBackend } from "../utils/vector/index.js";
export function createVectorStore(config, logger) {
    let backend = null;
    let vecEnabled = false;
    return {
        /** Initialize vector backend. Must be called after DB is available. */
        init(db) {
            backend = createVectorBackend(db, config, logger);
            vecEnabled = backend?.isAvailable ?? false;
        },
        get isAvailable() {
            return vecEnabled;
        },
        get name() {
            return backend?.name ?? "none";
        },
        /** Vector similarity search. */
        search(embedding, limit = 10) {
            return backend?.vectorSearch(embedding, limit) ?? [];
        },
        /** Store a vector embedding. */
        store(metaId, embedding) {
            return backend?.storeVector(metaId, embedding) ?? false;
        },
        /** Get vector count. */
        count() {
            return backend?.getVectorCount?.() ?? 0;
        },
        /** Get dimensions. */
        dimensions() {
            if (backend?.getDimensions)
                return backend.getDimensions();
            return (config.embedding && typeof config.embedding === 'object' && 'dimensions' in config.embedding)
                ? Number(config.embedding.dimensions ?? 0)
                : 0;
        },
        /** Clean up orphaned vectors. */
        deleteOrphans() {
            try {
                backend?.deleteOrphans?.();
            }
            catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                console.warn(`[yaoyao-memory]  best effort : ${msg}`);
            }
        },
        /** Close backend. */
        close() {
            backend?.close();
            backend = null;
            vecEnabled = false;
        },
    };
}
