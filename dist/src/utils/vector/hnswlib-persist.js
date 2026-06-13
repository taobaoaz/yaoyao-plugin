/**
 * utils/vector/hnswlib-persist.ts — HNSW index persistence helpers.
 */
import fs from "node:fs";
export function createPersistManager(ctx) {
    let flushTimer = null;
    let dirty = false;
    function scheduleFlush() {
        if (flushTimer)
            clearTimeout(flushTimer);
        flushTimer = setTimeout(() => flush(), 2000);
    }
    function flush(sync = false) {
        if (!dirty || !ctx.index)
            return;
        dirty = false;
        try {
            if (sync) {
                ctx.index.writeIndexSync(ctx.indexPath);
            }
            const meta = {
                dimensions: ctx.dimensions,
                model: ctx.config.embedding?.model,
                count: ctx.index.getCurrentCount?.() ?? 0,
                space: "cosine",
            };
            fs.writeFileSync(ctx.metaPath, JSON.stringify(meta, null, 2), "utf-8");
            ctx.logger?.debug?.("[yaoyao-memory:vec] HNSW index flushed to disk");
        }
        catch (err) {
            ctx.logger?.warn?.(`[yaoyao-memory:vec] flush failed: ${err.message}`);
        }
        if (flushTimer) {
            clearTimeout(flushTimer);
            flushTimer = null;
        }
    }
    function markDirty() {
        dirty = true;
        scheduleFlush();
    }
    function cleanup() {
        if (flushTimer) {
            clearTimeout(flushTimer);
            flushTimer = null;
        }
    }
    return { scheduleFlush, flush, markDirty, cleanup };
}
