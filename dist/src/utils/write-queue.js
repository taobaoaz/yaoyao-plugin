/**
 * WriteQueue — lightweight async batch flush for memory captures.
 *
 * Buffers L0 (markdown) + L1 (FTS5) + L2 (vector) writes off the main event loop
 * to avoid blocking agent_end hooks and the OpenClaw gateway thread.
 */
export function createWriteQueue(flushHandler, logger, audit, maxSize = 1000) {
    const pending = [];
    let scheduled = false;
    let flushing = false;
    let droppedCount = 0;
    function enqueue(task) {
        // Truncate oversized content to prevent memory bloat
        const safeTask = {
            ...task,
            userContent: task.userContent.slice(0, 10000),
            asstContent: task.asstContent.slice(0, 10000),
        };
        // Hard cap: if full, drop oldest tasks to make room
        if (pending.length >= maxSize) {
            const toDrop = pending.splice(0, pending.length - maxSize + 1);
            droppedCount += toDrop.length;
            logger?.warn?.(`[yaoyao-memory:write-queue] Queue overflow: dropped ${toDrop.length} oldest tasks (totalDropped=${droppedCount})`);
        }
        pending.push(safeTask);
        if (!scheduled && !flushing) {
            scheduled = true;
            setImmediate(runFlush);
        }
    }
    async function runFlush() {
        scheduled = false;
        if (flushing || pending.length === 0)
            return;
        flushing = true;
        // Snapshot and clear pending in one go
        const batch = pending.splice(0, pending.length);
        try {
            await flushHandler(batch);
            logger?.debug?.(`[yaoyao-memory:write-queue] Flushed ${batch.length} tasks`);
        }
        catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            logger?.warn?.(`[yaoyao-memory:write-queue] Flush failed: ${errMsg} — retrying once`);
            // Retry once
            try {
                await flushHandler(batch);
                logger?.debug?.(`[yaoyao-memory:write-queue] Retry succeeded for ${batch.length} tasks`);
            }
            catch (retryErr) {
                const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
                logger?.error?.(`[yaoyao-memory:write-queue] Retry failed: ${retryMsg}`);
                // Audit: record dropped tasks
                if (audit) {
                    audit.write({
                        component: "write-queue",
                        event: "flush-failed",
                        summary: `L1/L2 异步写入失败（重试一次后仍失败），${batch.length} 条任务被丢弃（L0 .md 已同步落盘）`,
                        details: {
                            "丢弃任务数": batch.length,
                            "影响日期": batch.map(t => t.date).join(", "),
                            "错误类型": retryMsg.slice(0, 200),
                            "建议": "检查磁盘空间、权限、或切换 capture.mode 为 sync",
                        },
                    });
                }
                // Best-effort: re-enqueue tasks that failed?  For now we drop them
                // to avoid infinite retry loops.  L0 markdown already written synchronously
                // as safety net, so data loss is minimal.
            }
        }
        finally {
            flushing = false;
            // If new tasks arrived while we were flushing, schedule again
            if (pending.length > 0 && !scheduled) {
                scheduled = true;
                setImmediate(runFlush);
            }
        }
    }
    return { enqueue, get pendingCount() { return pending.length; }, drain: async () => {
            const drainTimeout = Date.now() + 10000;
            if (flushing) {
                // Wait for current flush to complete
                while (flushing && Date.now() < drainTimeout) {
                    await new Promise(r => setTimeout(r, 10));
                }
            }
            if (pending.length > 0) {
                await runFlush();
            }
            // Double-check after any async gap
            while (flushing && Date.now() < drainTimeout) {
                await new Promise(r => setTimeout(r, 10));
            }
        }, retry: async () => {
            // Re-run flush for any remaining tasks (used after a failure)
            if (pending.length > 0 && !flushing) {
                await runFlush();
            }
        } };
}
