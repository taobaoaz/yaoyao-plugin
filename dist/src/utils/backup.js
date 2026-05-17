/**
 * Backup Manager — creates and restores snapshots of memory data.
 *
 * Backs up both the SQLite DB (.yaoyao.db) and all memory/*.md files
 * into timestamped backup directories under memory/.backups/.
 * Restores from a chosen backup point.
 */
import path from "node:path";
import fs from "node:fs";
export function createBackupManager(baseDir, logger) {
    const backupDir = path.join(baseDir, ".backups");
    const log = (msg) => logger?.info?.(`[yaoyao-memory:backup] ${msg}`);
    function ensureDir(dir) {
        if (!fs.existsSync(dir))
            fs.mkdirSync(dir, { recursive: true });
    }
    /** Create a timestamped backup of all memory data. Returns backup name or null. */
    function createBackup(mode = "full") {
        try {
            ensureDir(backupDir);
            const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
            const backupName = `memory-backup-${mode}-${timestamp}`;
            const backupPath = path.join(backupDir, backupName);
            ensureDir(backupPath);
            let fileCount = 0;
            const lastBackupFile = path.join(backupDir, ".last-backup.json");
            // 增量模式：只备份自上次备份以来的新/修改文件
            let lastBackupMs = 0;
            if (mode === "incremental") {
                try {
                    if (fs.existsSync(lastBackupFile)) {
                        let meta;
                        try {
                            meta = JSON.parse(fs.readFileSync(lastBackupFile, "utf-8"));
                        }
                        catch {
                            meta = { timestamp: new Date().toISOString() };
                        }
                        lastBackupMs = new Date(meta.timestamp).getTime();
                        log(`Incremental backup, last backup at ${meta.timestamp}`);
                    }
                }
                catch { /* no previous backup, fallback to full */ }
            }
            // Backup .md files (daily logs)
            if (fs.existsSync(baseDir)) {
                let files;
                try {
                    files = fs.readdirSync(baseDir).filter(f => f.endsWith(".md"));
                }
                catch {
                    files = [];
                }
                for (const f of files) {
                    const filePath = path.join(baseDir, f);
                    if (lastBackupMs > 0 && fs.statSync(filePath).mtimeMs <= lastBackupMs)
                        continue;
                    fs.copyFileSync(filePath, path.join(backupPath, f));
                    fileCount++;
                }
                // Also backup scene_blocks/ if exists
                const sceneDir = path.join(baseDir, "scene_blocks");
                if (fs.existsSync(sceneDir)) {
                    const sceneBackupDir = path.join(backupPath, "scene_blocks");
                    fs.mkdirSync(sceneBackupDir, { recursive: true });
                    let files;
                    try {
                        files = fs.readdirSync(sceneDir).filter(f => f.endsWith(".md"));
                    }
                    catch {
                        files = [];
                    }
                    for (const f of files) {
                        const filePath = path.join(sceneDir, f);
                        if (lastBackupMs > 0 && fs.statSync(filePath).mtimeMs <= lastBackupMs)
                            continue;
                        fs.copyFileSync(filePath, path.join(sceneBackupDir, f));
                        fileCount++;
                    }
                }
            }
            // Backup SQLite DB (always for full, for incremental check mtime)
            const dbPath = path.join(baseDir, ".yaoyao.db");
            if (fs.existsSync(dbPath)) {
                const backupDb = lastBackupMs === 0 || fs.statSync(dbPath).mtimeMs > lastBackupMs;
                if (backupDb || fileCount > 0) {
                    fs.copyFileSync(dbPath, path.join(backupPath, ".yaoyao.db"));
                    fileCount++;
                }
            }
            // Also backup .feedback.jsonl (L4 feedback)
            const feedbackPath = path.join(baseDir, ".feedback.jsonl");
            if (fs.existsSync(feedbackPath)) {
                if (lastBackupMs === 0 || fs.statSync(feedbackPath).mtimeMs > lastBackupMs) {
                    fs.copyFileSync(feedbackPath, path.join(backupPath, ".feedback.jsonl"));
                    fileCount++;
                }
            }
            // Save backup metadata
            const meta = { timestamp, mode, fileCount };
            fs.writeFileSync(path.join(backupPath, ".meta.json"), JSON.stringify(meta, null, 2));
            // Update last backup timestamp
            fs.writeFileSync(lastBackupFile, JSON.stringify({ timestamp }));
            if (fileCount === 0 && mode === "incremental") {
                fs.rmSync(backupPath, { recursive: true, force: true });
                log(`No changes since last backup, incremental backup skipped`);
                return null;
            }
            log(`Backup created: ${backupName} (${fileCount} files, ${mode})`);
            return backupName;
        }
        catch (err) {
            logger?.error?.(`[yaoyao-memory:backup] Create failed: ${err.message}`);
            return null;
        }
    }
    /** List all available backups, most recent first. */
    function listBackups() {
        try {
            ensureDir(backupDir);
            const results = [];
            for (const name of fs.readdirSync(backupDir)
                .filter(f => f.startsWith("memory-backup-"))
                .sort((a, b) => b.localeCompare(a))
                .slice(0, 30)) {
                const p = path.join(backupDir, name);
                try {
                    const stat = fs.statSync(p);
                    if (!stat.isDirectory())
                        continue;
                    const files = fs.readdirSync(p);
                    const size = files.reduce((sum, f) => sum + (fs.statSync(path.join(p, f)).size || 0), 0);
                    results.push({
                        name,
                        timestamp: name.replace("memory-backup-", "").replace(/-/g, ":").slice(0, 19),
                        sizeKB: Math.round(size / 1024),
                        files: files.length,
                        createdAt: stat.mtime.toISOString(),
                    });
                }
                catch { /* skip */ }
            }
            return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        }
        catch {
            return [];
        }
    }
    /** Restore memory data from a backup. Overwrites current files. */
    function restoreBackup(backupName) {
        try {
            const backupPath = path.join(backupDir, backupName);
            if (!fs.existsSync(backupPath)) {
                logger?.error?.(`[yaoyao-memory:backup] Not found: ${backupName}`);
                return false;
            }
            let files;
            try {
                files = fs.readdirSync(backupPath);
            }
            catch {
                files = [];
            }
            // Pre-restore snapshot
            const preDir = path.join(backupDir, `pre-restore-${Date.now()}`);
            fs.mkdirSync(preDir, { recursive: true });
            for (const f of files) {
                const src = path.join(baseDir, f);
                const backupSrc = path.join(backupPath, f);
                const stat = fs.statSync(backupSrc);
                if (stat.isDirectory()) {
                    // Restore subdirectory (e.g., scene_blocks/)
                    const destDir = src;
                    fs.mkdirSync(destDir, { recursive: true });
                    fs.mkdirSync(path.join(preDir, f), { recursive: true });
                    let subs;
                    try {
                        subs = fs.readdirSync(backupSrc);
                    }
                    catch {
                        subs = [];
                    }
                    for (const sub of subs) {
                        const subSrc = path.join(destDir, sub);
                        if (fs.existsSync(subSrc))
                            fs.copyFileSync(subSrc, path.join(preDir, f, sub));
                        fs.copyFileSync(path.join(backupSrc, sub), subSrc);
                    }
                }
                else {
                    if (fs.existsSync(src))
                        fs.copyFileSync(src, path.join(preDir, f));
                    fs.copyFileSync(backupSrc, src);
                }
            }
            log(`Restored from ${backupName} (snapshot: ${preDir})`);
            return true;
        }
        catch (err) {
            logger?.error?.(`[yaoyao-memory:backup] Restore failed: ${err.message}`);
            return false;
        }
    }
    /** Prune old backups, keeping only the N most recent. */
    function pruneBackups(keepCount = 10) {
        try {
            ensureDir(backupDir);
            let backups;
            try {
                backups = fs.readdirSync(backupDir)
                    .filter(f => f.startsWith("memory-backup-"))
                    .map(f => ({ name: f, mtime: fs.statSync(path.join(backupDir, f)).mtimeMs }))
                    .sort((a, b) => b.mtime - a.mtime);
            }
            catch {
                backups = [];
            }
            for (const d of backups.slice(keepCount)) {
                fs.rmSync(path.join(backupDir, d.name), { recursive: true, force: true });
                log(`Pruned: ${d.name}`);
            }
        }
        catch { /* best effort */ }
    }
    return { createBackup, listBackups, restoreBackup, pruneBackups };
}
