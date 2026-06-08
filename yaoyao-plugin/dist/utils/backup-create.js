/**
 * utils/backup-create.ts — Backup creation logic.
 */
import path from 'node:path';
import fs from 'node:fs';
export function createBackup(baseDir, backupDir, mode = 'full', logger) {
    const log = (msg) => logger?.info?.(`[yaoyao-memory:backup] ${msg}`);
    function ensureDir(dir) {
        if (!fs.existsSync(dir))
            fs.mkdirSync(dir, { recursive: true });
    }
    try {
        ensureDir(backupDir);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const backupName = `memory-backup-${mode}-${timestamp}`;
        const backupPath = path.join(backupDir, backupName);
        ensureDir(backupPath);
        let fileCount = 0;
        const lastBackupFile = path.join(backupDir, '.last-backup.json');
        let lastBackupMs = 0;
        if (mode === 'incremental') {
            try {
                if (fs.existsSync(lastBackupFile)) {
                    let meta;
                    try {
                        meta = JSON.parse(fs.readFileSync(lastBackupFile, 'utf-8'));
                    }
                    catch (e) {
                        const msg = e instanceof Error ? e.message : String(e);
                        console.warn(`[yaoyao-memory:backup] Parse last backup failed: ${msg}`);
                        meta = { timestamp: new Date().toISOString() };
                    }
                    lastBackupMs = new Date(meta.timestamp).getTime();
                    log(`Incremental backup, last backup at ${meta.timestamp}`);
                }
            }
            catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                console.warn(`[yaoyao-memory:backup] Read last backup failed: ${msg}`);
            }
        }
        if (fs.existsSync(baseDir)) {
            let files;
            try {
                files = fs.readdirSync(baseDir).filter((f) => f.endsWith('.md'));
            }
            catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                console.warn(`[yaoyao-memory:backup] Read baseDir failed: ${msg}`);
                files = [];
            }
            for (const f of files) {
                const filePath = path.join(baseDir, f);
                if (lastBackupMs > 0 && fs.statSync(filePath).mtimeMs <= lastBackupMs)
                    continue;
                fs.copyFileSync(filePath, path.join(backupPath, f));
                fileCount++;
            }
            const sceneDir = path.join(baseDir, 'scene_blocks');
            if (fs.existsSync(sceneDir)) {
                const sceneBackupDir = path.join(backupPath, 'scene_blocks');
                fs.mkdirSync(sceneBackupDir, { recursive: true });
                let files;
                try {
                    files = fs.readdirSync(sceneDir).filter((f) => f.endsWith('.md'));
                }
                catch (e) {
                    const msg = e instanceof Error ? e.message : String(e);
                    console.warn(`[yaoyao-memory:backup] Read sceneDir failed: ${msg}`);
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
        const dbPath = path.join(baseDir, '.yaoyao.db');
        if (fs.existsSync(dbPath)) {
            const backupDb = lastBackupMs === 0 || fs.statSync(dbPath).mtimeMs > lastBackupMs;
            if (backupDb || fileCount > 0) {
                fs.copyFileSync(dbPath, path.join(backupPath, '.yaoyao.db'));
                fileCount++;
            }
        }
        const feedbackPath = path.join(baseDir, '.feedback.jsonl');
        if (fs.existsSync(feedbackPath)) {
            if (lastBackupMs === 0 || fs.statSync(feedbackPath).mtimeMs > lastBackupMs) {
                fs.copyFileSync(feedbackPath, path.join(backupPath, '.feedback.jsonl'));
                fileCount++;
            }
        }
        const meta = { timestamp, mode, fileCount };
        fs.writeFileSync(path.join(backupPath, '.meta.json'), JSON.stringify(meta, null, 2));
        fs.writeFileSync(lastBackupFile, JSON.stringify({ timestamp }));
        if (fileCount === 0 && mode === 'incremental') {
            fs.rmSync(backupPath, { recursive: true, force: true });
            log(`No changes since last backup, incremental backup skipped`);
            return null;
        }
        log(`Backup created: ${backupName} (${fileCount} files, ${mode})`);
        return backupName;
    }
    catch (err) {
        logger?.error?.(`[yaoyao-memory:backup] Create failed: ${err instanceof Error ? err.message : String(err)}`);
        return null;
    }
}
