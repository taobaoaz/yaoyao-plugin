/**
 * utils/discover-memory-files.ts — Discover memory markdown files in workspace.
 *
 * Scans workspace root and memory/ directory for relevant markdown files.
 * Zero external dependencies beyond node:fs / node:path.
 */
import fs from "node:fs";
import path from "node:path";
const ROOT_MEMORY_FILES = [
    "MEMORY.md", "memory.md",
    "USER.md", "user.md",
    "SOUL.md", "soul.md",
    "AGENTS.md", "agents.md",
    "TOOLS.md", "tools.md",
    "HEARTBEAT.md", "heartbeat.md",
    "DREAMS.md", "dreams.md",
    "BOOTSTRAP.md", "bootstrap.md",
    "IDENTITY.md", "identity.md",
];
/** Discover all memory-relevant markdown files in workspace. */
export function discoverMemoryFiles(workspaceDir, store) {
    const results = [];
    const seenPaths = new Set();
    // 1. Root-level known files
    for (const name of ROOT_MEMORY_FILES) {
        const fp = path.join(workspaceDir, name);
        if (fs.existsSync(fp) && !seenPaths.has(fp)) {
            results.push({ path: fp, filename: name, type: "root" });
            seenPaths.add(fp);
        }
    }
    // 2. Daily files from store
    const dailyFiles = store.listFiles().filter(f => f.type === "daily");
    for (const file of dailyFiles) {
        if (!seenPaths.has(file.path)) {
            results.push({
                path: file.path,
                filename: file.filename,
                type: "daily",
                date: file.date,
            });
            seenPaths.add(file.path);
        }
    }
    // 3. Other .md files in memory/ directory
    const memDir = store.baseDir;
    if (fs.existsSync(memDir)) {
        for (const entry of fs.readdirSync(memDir, { withFileTypes: true })) {
            if (!entry.isFile() || !entry.name.endsWith(".md"))
                continue;
            const fp = path.join(memDir, entry.name);
            if (!seenPaths.has(fp)) {
                results.push({ path: fp, filename: entry.name, type: "memory_misc" });
                seenPaths.add(fp);
            }
        }
    }
    return results;
}
