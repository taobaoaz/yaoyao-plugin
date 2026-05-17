/**
 * AuditLog — lightweight human-readable audit trail for yaoyao-memory.
 *
 * Writes structured entries to `memory/audit/audit-YYYY-MM-DD.md`.
 * Each entry is self-contained, timestamped, and human-readable.
 *
 * v2: Async batch flush to avoid blocking the event loop.
 */
import fs from "node:fs";
import path from "node:path";
export function createAuditLog(baseDir, logger, opts = {}) {
    const auditDir = path.join(baseDir, "audit");
    const bufferSize = opts.bufferSize ?? 50;
    const flushIntervalMs = opts.flushIntervalMs ?? 5000;
    let buffer = [];
    let flushTimer = null;
    let flushing = false;
    let headerEnsuredForDate = ""; // cache: which date's header has been written
    function ensureDir() {
        if (!fs.existsSync(auditDir)) {
            fs.mkdirSync(auditDir, { recursive: true });
        }
    }
    function dailyAuditPath() {
        const date = new Date().toISOString().slice(0, 10);
        return path.join(auditDir, `audit-${date}.md`);
    }
    function buildHeader(date) {
        return `# ${date} 审计日志\n\n> 由 yaoyao-memory 自动生成，记录关键操作与降级决策\n\n---\n\n`;
    }
    function scheduleFlush() {
        if (!flushTimer && buffer.length > 0) {
            flushTimer = setTimeout(flush, flushIntervalMs);
        }
    }
    async function flush() {
        if (flushing || buffer.length === 0)
            return;
        flushing = true;
        flushTimer = null;
        const batch = buffer.splice(0);
        const fp = dailyAuditPath();
        const date = path.basename(fp).slice(6, 16); // audit-YYYY-MM-DD.md
        try {
            ensureDir();
            // Ensure header only once per day
            let header = "";
            if (headerEnsuredForDate !== date || !fs.existsSync(fp)) {
                header = buildHeader(date);
                headerEnsuredForDate = date;
            }
            const content = header + batch.join("");
            await fs.promises.appendFile(fp, content, "utf-8");
        }
        catch (err) {
            logger?.debug?.(`[yaoyao-memory:audit] Flush failed: ${err instanceof Error ? err.message : String(err)}`);
            // Re-enqueue failed batch to retry on next flush
            buffer.unshift(...batch);
        }
        finally {
            flushing = false;
            if (buffer.length > 0) {
                scheduleFlush();
            }
        }
    }
    function write(entry) {
        try {
            const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
            let lines = `\n## ${ts} [${entry.component}] ${entry.event}\n\n`;
            lines += `- **摘要**: ${entry.summary}\n`;
            if (entry.details && Object.keys(entry.details).length > 0) {
                for (const [k, v] of Object.entries(entry.details)) {
                    if (v === undefined)
                        continue;
                    const display = typeof v === "object"
                        ? JSON.stringify(v).slice(0, 500)
                        : String(v);
                    lines += `- **${k}**: ${display}\n`;
                }
            }
            lines += "\n";
            buffer.push(lines);
            if (buffer.length >= bufferSize) {
                flush();
            }
            else {
                scheduleFlush();
            }
        }
        catch (err) {
            logger?.debug?.(`[yaoyao-memory:audit] Format failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    /** Record an audit event (alias for write). */
    function record(event, details) {
        write({ component: "yaoyao-memory", event, summary: event, details });
    }
    /** Synchronous flush for graceful shutdown */
    function flushSync() {
        if (buffer.length === 0)
            return;
        const batch = buffer.splice(0);
        const fp = dailyAuditPath();
        const date = path.basename(fp).slice(6, 16);
        try {
            ensureDir();
            let header = "";
            if (headerEnsuredForDate !== date || !fs.existsSync(fp)) {
                header = buildHeader(date);
                headerEnsuredForDate = date;
            }
            fs.appendFileSync(fp, header + batch.join(""), "utf-8");
        }
        catch (err) {
            logger?.error?.(`[yaoyao-memory:audit] Sync flush failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    return { write, flush, flushSync, record };
}
