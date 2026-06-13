/**
 * utils/import-manifest.ts — Manifest IO for memory import tracking.
 *
 * Tracks file mtimes to avoid re-importing unchanged files.
 * Zero external dependencies beyond node:fs / node:path.
 */
import fs from 'node:fs';
import path from 'node:path';
const IMPORT_MANIFEST_FILE = '.metadata/import-manifest.json';
/** Read the import manifest from disk. */
export function readImportManifest(baseDir) {
    const file = path.join(baseDir, IMPORT_MANIFEST_FILE);
    if (!fs.existsSync(file))
        return {};
    try {
        return JSON.parse(fs.readFileSync(file, 'utf-8'));
    }
    catch {
        return {};
    }
}
/** Atomically write the import manifest to disk. */
export function writeImportManifest(baseDir, data) {
    const dir = path.join(baseDir, '.metadata');
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, 'import-manifest.json');
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
}
