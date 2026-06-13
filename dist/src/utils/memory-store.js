/**
 * Memory store — core storage abstraction.
 *
 * v1.8.0: Added workspace file methods (MEMORY.md, USER.md, etc.)
 */

import path from "node:path";
import fs from "node:fs";
import os from "node:os";

function validateMemoryDir(rawDir) {
    if (!rawDir) {
        return path.join(os.homedir(), ".openclaw", "workspace", "memory");
    }
    const resolved = path.resolve(rawDir);
    if (rawDir.includes("..") || !path.isAbsolute(resolved)) {
        throw new Error(`Invalid memoryDir "${rawDir}": must be absolute and not contain parent references`);
    }
    return resolved;
}

const ALLOWED_WORKSPACE_FILES = new Set([
    "MEMORY.md", "USER.md", "IDENTITY.md", "SOUL.md", "TOOLS.md",
]);

export function createMemoryStore(config, logger) {
    let baseDir = validateMemoryDir(config.memoryDir);
    const workspaceDir = path.dirname(baseDir);

    const log = (msg) => logger?.debug?.(`[yaoyao-memory:store] ${msg}`);

    function ensureDir(dir) {
        if (!fs.existsSync(dir)) {
            try {
                fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
                log(`Created directory: ${dir}`);
            } catch (err) {
                logger?.warn?.(`[yaoyao-memory:store] Failed to create directory ${dir}: ${err}`);
                throw err;
            }
        } else {
            try { fs.chmodSync(dir, 0o700); } catch { }
        }
    }

    function dailyFilePath(date) {
        const d = date || new Date().toISOString().slice(0, 10);
        return path.join(baseDir, `${d}.md`);
    }

    function readFile(filePath) {
        try {
            return fs.readFileSync(filePath, "utf-8");
        } catch {
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
            try { fs.chmodSync(fp, 0o600); } catch { }
            log(`Created daily file: ${fp}`);
        }
        return fp;
    }

    function appendToDaily(date, content) {
        const fp = getDailyFile(date);
        fs.appendFileSync(fp, content, "utf-8");
        try { fs.chmodSync(fp, 0o600); } catch { }
    }

    function listFiles() {
        ensureDir(baseDir);
        const files = fs.readdirSync(baseDir).filter(f => f.endsWith(".md"));
        const results = [];

        for (const f of files) {
            const fp = path.join(baseDir, f);
            try {
                const stat = fs.statSync(fp);
                let type = "memory";
                if (/^\d{4}-\d{2}-\d{2}/.test(f)) type = "daily";
                else if (f.startsWith("archive") || f.includes("archive")) type = "archive";

                results.push({
                    type, path: fp, filename: f,
                    date: /^\d{4}-\d{2}-\d{2}/.test(f) ? f.slice(0, 10) : undefined,
                    size: stat.size, modified: stat.mtimeMs,
                });
            } catch { }
        }

        results.sort((a, b) => b.modified - a.modified);
        return results;
    }

    // === v1.8.0: Workspace File Methods ===

    function readWorkspaceFile(name) {
        if (!ALLOWED_WORKSPACE_FILES.has(name)) {
            log(`Workspace file access denied (not in whitelist): ${name}`);
            return null;
        }
        const fp = path.join(workspaceDir, name);
        try {
            if (!fs.existsSync(fp)) return null;
            return fs.readFileSync(fp, "utf-8");
        } catch {
            return null;
        }
    }

    function appendToWorkspaceFile(name, content) {
        if (!ALLOWED_WORKSPACE_FILES.has(name)) {
            log(`Workspace file write denied (not in whitelist): ${name}`);
            return false;
        }
        try {
            const fp = path.join(workspaceDir, name);
            fs.appendFileSync(fp, content, "utf-8");
            try { fs.chmodSync(fp, 0o600); } catch { }
            log(`Appended to workspace file: ${name}`);
            return true;
        } catch (err) {
            logger?.warn?.(`[yaoyao-memory:store] Failed to append to ${name}: ${err}`);
            return false;
        }
    }

    function writeWorkspaceFile(name, content) {
        if (!ALLOWED_WORKSPACE_FILES.has(name)) {
            log(`Workspace file write denied (not in whitelist): ${name}`);
            return false;
        }
        try {
            const fp = path.join(workspaceDir, name);
            fs.writeFileSync(fp, content, "utf-8");
            try { fs.chmodSync(fp, 0o600); } catch { }
            log(`Wrote workspace file: ${name}`);
            return true;
        } catch (err) {
            logger?.warn?.(`[yaoyao-memory:store] Failed to write ${name}: ${err}`);
            return false;
        }
    }

    return {
        baseDir, workspaceDir, ensureDir, getDailyFile, appendToDaily,
        readFile, listFiles, dailyFilePath,
        readWorkspaceFile, appendToWorkspaceFile, writeWorkspaceFile,
    };
}