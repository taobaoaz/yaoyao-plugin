/**
 * Memory store — core storage abstraction.
 * Wraps the OpenClaw workspace memory/ directory with file I/O.
 */
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
export function createMemoryStore(config, logger) {
    const baseDir = config.memoryDir || path.join(os.homedir(), ".openclaw", "workspace", "memory");
    const log = (msg) => logger?.debug?.(`[yaoyao-memory:store] ${msg}`);

    /** Atomic write: write to temp file then rename */
    function safeWriteFile(fp, content) {
        const tmp = fp + ".tmp." + Date.now();
        try {
            fs.writeFileSync(tmp, content, "utf-8");
            fs.renameSync(tmp, fp);
            return true;
        } catch (err) {
            try { fs.unlinkSync(tmp); } catch {}
            throw err;
        }
    }
    function ensureDir(dir) {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            log(`Created directory: ${dir}`);
        }
    }
    function dailyFilePath(date) {
        const d = date || new Date().toISOString().slice(0, 10);
        return path.join(baseDir, `${d}.md`);
    }
    function readFile(filePath) {
        try {
            return fs.readFileSync(filePath, "utf-8");
        }
        catch {
            return null;
        }
    }
    function getDailyFile(date) {
        const fp = dailyFilePath(date);
        if (!fs.existsSync(fp)) {
            ensureDir(baseDir);
            const d = date || new Date().toISOString().slice(0, 10);
            const header = `# ${d} 记忆\n\n> 每日对话记录\n\n---\n\n_此文件由 yaoyao-memory 插件自动维护_\n`;
            fs.writeFileSync(fp, header, "utf-8");
            log(`Created daily file: ${fp}`);
        }
        return fp;
    }
    /** Append content to a daily log file. Creates the file if it doesn't exist.
     *  Detects pre-existing non-yaoyao format content and inserts a migration separator.
     */
    function appendToDaily(date, content) {
        const fp = getDailyFile(date);
        try {
            let existing = "";
            let needsMigrationHeader = false;
            if (fs.existsSync(fp)) {
                existing = fs.readFileSync(fp, "utf-8");
                // Check if file contains yaoyao format markers
                if (existing.length > 0 && !existing.includes("**User:**") && !existing.includes("### ")) {
                    // File exists but not in yaoyao format — add migration separator
                    needsMigrationHeader = true;
                }
            }
            if (needsMigrationHeader) {
                const separator = "\n---\n> *以下为 Yaoyao Memory 自动记录*\n\n";
                fs.appendFileSync(fp, separator + content, "utf-8");
            } else {
                fs.appendFileSync(fp, content, "utf-8");
            }
            return true;
        } catch (err) {
            // Fallback: log to fallback file if main write fails
            try {
                const fallback = path.join(baseDir, ".write-fallback.jsonl");
                const record = JSON.stringify({ date, content: content.slice(0, 200), error: err.message, ts: Date.now() });
                fs.appendFileSync(fallback, record + "\n", "utf-8");
            } catch {}
            log?.(`appendToDaily error: ${err.message}`);
            return false;
        }
    }

    /**
     * Reindex existing daily markdown files into FTS5.
     * Parses ### headers and content blocks, indexes into DB.
     * Idempotent: tracks reindexed dates via memory_config.
     */
    function reindexExistingDaily(db) {
        if (!db || !fs.existsSync(baseDir)) return 0;
        const files = fs.readdirSync(baseDir)
            .filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
            .sort();

        let indexed = 0;
        for (const file of files) {
            const date = file.replace(".md", "");
            const checkpointKey = `daily_reindex_${date}`;
            if (db.getConfig(checkpointKey, null)) continue; // already done

            try {
                const content = fs.readFileSync(path.join(baseDir, file), "utf-8");
                // Split by ### timestamps (yaoyao format)
                const entries = content.split(/^### /gm).filter(e => e.trim());

                for (const entry of entries) {
                    const lines = entry.split("\n");
                    let userText = "";
                    let asstText = "";
                    for (const line of lines) {
                        const userMatch = line.match(/^\*\*User:\*\*\s*(.*)/);
                        const asstMatch = line.match(/^\*\*AI:\*\*\s*(.*)/);
                        if (userMatch) userText = userMatch[1].trim();
                        if (asstMatch) asstText = asstMatch[1].trim();
                    }
                    if (userText && userText.length >= 3) {
                        db.indexTurn(userText.slice(0, 500), asstText.slice(0, 500), date);
                    }
                }

                // Also index non-yaoyao content (free-form notes)
                const nonYaoyaoContent = content
                    .replace(/^### .+$/gm, "")
                    .replace(/^\*\*(User|AI):\*\*.+$/gm, "")
                    .replace(/^---$/gm, "")
                    .trim();
                if (nonYaoyaoContent.length >= 20) {
                    db.indexTurn(`[daily-note] ${nonYaoyaoContent.slice(0, 1900)}`, "", date);
                }

                db.setConfig(checkpointKey, "1");
                indexed++;
            } catch {
                // Skip this file
            }
        }
        return indexed;
    }
    /** List all memory files in the directory. */
    function listFiles() {
        ensureDir(baseDir);
        const files = fs.readdirSync(baseDir).filter(f => f.endsWith(".md"));
        const results = [];
        for (const f of files) {
            const fp = path.join(baseDir, f);
            try {
                const stat = fs.statSync(fp);
                let type = "memory";
                if (/^\d{4}-\d{2}-\d{2}/.test(f))
                    type = "daily";
                else if (f.startsWith("archive") || f.includes("archive"))
                    type = "archive";
                results.push({
                    type,
                    path: fp,
                    filename: f,
                    date: /^\d{4}-\d{2}-\d{2}/.test(f) ? f.slice(0, 10) : undefined,
                    size: stat.size,
                    modified: stat.mtimeMs,
                });
            }
            catch {
                // skip unreadable
            }
        }
        results.sort((a, b) => b.modified - a.modified);
        return results;
    }
    return {
        baseDir,
        ensureDir,
        getDailyFile,
        appendToDaily,
        readFile,
        listFiles,
        dailyFilePath,
        reindexExistingDaily,
    };
}
