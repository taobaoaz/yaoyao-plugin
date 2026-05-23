/**
 * Memory store — core storage abstraction.
 * Wraps the OpenClaw workspace memory/ directory with file I/O.
 *
 * Security hardening (v1.5.1+):
 *   - baseDir 创建时权限 0o700（仅 owner 可访问）
 *   - memoryDir 配置禁止 .. 和相对路径
 *   - daily 文件写入后 chmod 0o600
 */
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
/** Validate memoryDir config to prevent path traversal */
function validateMemoryDir(rawDir) {
    if (!rawDir) {
        return path.join(os.homedir(), ".openclaw", "workspace", "memory");
    }
    const resolved = path.resolve(rawDir);
    // Reject parent directory references
    if (rawDir.includes("..") || !path.isAbsolute(resolved)) {
        throw new Error(`Invalid memoryDir "${rawDir}": must be absolute and not contain parent references`);
    }
    return resolved;
}
export function createMemoryStore(config, logger) {
    let baseDir = validateMemoryDir(config.memoryDir);
    const log = (msg) => logger?.debug?.(`[yaoyao-memory:store] ${msg}`);
    function ensureDir(dir) {
        if (!fs.existsSync(dir)) {
            try {
                fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
                log(`Created directory: ${dir}`);
            }
            catch (err) {
                logger?.warn?.(`[yaoyao-memory:store] Failed to create directory ${dir}: ${err}`);
                throw err; // re-throw so caller can decide (fallback to memory-only mode)
            }
        }
        else {
            try {
                fs.chmodSync(dir, 0o700);
            }
            catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                console.warn(`[yaoyao-memory:store] chmod failed (ignore on Windows): ${msg}`);
            }
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
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn(`[yaoyao-memory:store] Operation failed: ${msg}`);
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
            try {
                fs.chmodSync(fp, 0o600);
            }
            catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                console.warn(`[yaoyao-memory:store] chmod failed (ignore on Windows): ${msg}`);
            }
            log(`Created daily file: ${fp}`);
        }
        return fp;
    }
    /** Append content to a daily log file. Creates the file if it doesn't exist. */
    function appendToDaily(date, content) {
        const fp = getDailyFile(date);
        fs.appendFileSync(fp, content, "utf-8");
        try {
            fs.chmodSync(fp, 0o600);
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn(`[yaoyao-memory:store] chmod failed (ignore on Windows): ${msg}`);
        }
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
            catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                console.warn(`[yaoyao-memory:store] skip unreadable: ${msg}`);
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
    };
}
