import { SqliteVecBackend } from "./sqlite-vec.js";
import { HnswlibBackend } from "./hnswlib.js";
export function createVectorBackend(db, config, logger) {
    const requested = (config.embedding?.vectorBackend || 'sqlite-vec').toLowerCase().trim();
    if (requested === 'hnswlib') {
        const hnsw = new HnswlibBackend();
        if (hnsw.init(db, config, logger)) {
            return hnsw;
        }
        logger?.warn?.(`[yaoyao-memory:vec] hnswlib requested but unavailable — falling back to sqlite-vec. ` +
            'Install with: npm install hnswlib-node');
    }
    // Default or fallback
    const sqlite = new SqliteVecBackend();
    sqlite.init(db, config, logger);
    return sqlite;
}
