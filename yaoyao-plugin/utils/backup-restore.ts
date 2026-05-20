/**
 * utils/backup-restore.ts — Backup restore logic.
 */
import path from "node:path";
import fs from "node:fs";

type Logger = { info?: (s: string) => void; error?: (s: string) => void };

export function restoreBackup(
  baseDir: string,
  backupDir: string,
  backupName: string,
  logger?: Logger,
): boolean {
  const log = (msg: string) => logger?.info?.(`[yaoyao-memory:backup] ${msg}`);

  try {
    const backupPath = path.join(backupDir, backupName);
    if (!fs.existsSync(backupPath)) {
      logger?.error?.(`[yaoyao-memory:backup] Not found: ${backupName}`);
      return false;
    }

    let files: string[];
    try { files = fs.readdirSync(backupPath); } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[yaoyao-memory:backup] Read backup path failed: ${msg}`);
      files = [];
    }

    const preDir = path.join(backupDir, `pre-restore-${Date.now()}`);
    fs.mkdirSync(preDir, { recursive: true });

    for (const f of files) {
      const src = path.join(baseDir, f);
      const backupSrc = path.join(backupPath, f);
      const stat = fs.statSync(backupSrc);
      if (stat.isDirectory()) {
        const destDir = src;
        fs.mkdirSync(destDir, { recursive: true });
        fs.mkdirSync(path.join(preDir, f), { recursive: true });
        let subs: string[];
        try { subs = fs.readdirSync(backupSrc); } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn(`[yaoyao-memory:backup] Read backup source failed: ${msg}`);
          subs = [];
        }
        for (const sub of subs) {
          const subSrc = path.join(destDir, sub);
          if (fs.existsSync(subSrc)) fs.copyFileSync(subSrc, path.join(preDir, f, sub));
          fs.copyFileSync(path.join(backupSrc, sub), subSrc);
        }
      } else {
        if (fs.existsSync(src)) fs.copyFileSync(src, path.join(preDir, f));
        fs.copyFileSync(backupSrc, src);
      }
    }

    log(`Restored from ${backupName} (snapshot: ${preDir})`);
    return true;
  } catch (err: unknown) {
    logger?.error?.(`[yaoyao-memory:backup] Restore failed: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}
