/**
 * Backup Manager — creates and restores snapshots of memory data.
 *
 * v1.9.0: Accepts an explicit `dbPath` so the unified DB at
 * `~/.openclaw/memory/main.sqlite` can be backed up. Falls back to
 * the legacy `baseDir/.yaoyao.db` location for backward compatibility.
 */
import path from "node:path";
import fs from "node:fs";
import { createBackup } from "./backup-create.js";
import { restoreBackup } from "./backup-restore.js";
export function createBackupManager(baseDir, logger, dbPath) {
    const backupDir = path.join(baseDir, ".backups");
    const log = (msg) => logger?.info?.(`[yaoyao-memory:backup] ${msg}`);
    function ensureDir(dir) {
        if (!fs.existsSync(dir))
            fs.mkdirSync(dir, { recursive: true });
    }
    return {
        createBackup: (mode = "full") => createBackup(baseDir, backupDir, mode, logger, dbPath),
        listBackups: () => {
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
        },
        restoreBackup: (backupName) => restoreBackup(baseDir, backupDir, backupName, logger),
        pruneBackups: (keepCount = 10) => {
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
        },
    };
}
