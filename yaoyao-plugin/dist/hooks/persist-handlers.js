/**
 * hooks/persist-handlers.ts — Persistence layer handlers for auto-capture.
 *
 * Encapsulates L0 markdown + L1 FTS5 + L2 vector writes.
 * Pure factory, no orchestration logic.
 */
export function createPersistHandlers(api, db, store, embedding) {
    return {
        flushBatch: async (tasks) => {
            const rows = [];
            for (const task of tasks) {
                try {
                    const rowId = db.indexTurn(task.userContent, task.asstContent, task.date, task.meta);
                    if (rowId > 0 && embedding) {
                        rows.push({ rowId, text: `${task.userContent}\n${task.asstContent}`, meta: task.meta });
                    }
                }
                catch (e2) {
                    api.logger.error?.(`[yaoyao-memory:persist] indexTurn failed: ${e2 instanceof Error ? e2.message : String(e2)}`);
                }
            }
            if (rows.length > 0 && embedding) {
                try {
                    const vectors = await embedding.embedBatch(rows.map((r) => r.text));
                    for (let i = 0; i < rows.length; i++) {
                        if (vectors && vectors[i])
                            db.storeVector(rows[i].rowId, vectors[i]);
                    }
                }
                catch (e2) {
                    api.logger.debug?.(`[yaoyao-memory:persist] Batch vector store failed: ${e2 instanceof Error ? e2.message : String(e2)}`);
                }
            }
        },
        writeDailyEntry: (date, entry) => {
            store.appendToDaily(date, entry);
        },
    };
}
