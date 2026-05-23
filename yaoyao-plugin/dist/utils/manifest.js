/**
 * Manifest Manager — 记录插件元数据到 `.metadata/manifest.json`。
 * 腾讯方案：记录 store 绑定信息、seed 运行记录、版本历史。
 * 零外部依赖，纯 Node.js fs。
 */
import fs from "node:fs";
import path from "node:path";
const MANIFEST_DIR = ".metadata";
const MANIFEST_FILE = "manifest.json";
/** Ensure manifest directory exists with correct permissions */
function ensureManifestDir(baseDir) {
    const dir = path.join(baseDir, MANIFEST_DIR);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    return dir;
}
/** Read manifest or return default */
export function readManifest(baseDir) {
    const file = path.join(ensureManifestDir(baseDir), MANIFEST_FILE);
    if (!fs.existsSync(file))
        return null;
    try {
        const raw = fs.readFileSync(file, "utf-8");
        return JSON.parse(raw);
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[yaoyao-memory:utils] Operation failed: ${msg}`);
        return null;
    }
}
/** Write manifest atomically */
export function writeManifest(baseDir, data) {
    const dir = ensureManifestDir(baseDir);
    const file = path.join(dir, MANIFEST_FILE);
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
}
/** Initialize manifest if not exists */
export function initManifest(baseDir, pluginVersion) {
    const existing = readManifest(baseDir);
    if (existing) {
        // Update last operation timestamp on each startup
        existing.lastOperationAt = new Date().toISOString();
        existing.lastOperationType = "startup";
        writeManifest(baseDir, existing);
        return existing;
    }
    const data = {
        pluginVersion,
        firstInitAt: new Date().toISOString(),
        lastOperationAt: new Date().toISOString(),
        lastOperationType: "init",
        storeBackend: "sqlite",
        seedRunCount: 0,
    };
    writeManifest(baseDir, data);
    return data;
}
/** Record a seed run */
export function recordSeedRun(baseDir, entryCount) {
    const manifest = readManifest(baseDir);
    if (!manifest)
        return;
    manifest.seedRunCount = (manifest.seedRunCount ?? 0) + 1;
    manifest.lastSeedAt = new Date().toISOString();
    manifest.lastOperationAt = new Date().toISOString();
    manifest.lastOperationType = `seed:${entryCount}`;
    manifest.totalEntries = (manifest.totalEntries ?? 0) + entryCount;
    writeManifest(baseDir, manifest);
}
/** Record an operation (generic) */
export function recordOperation(baseDir, type, meta) {
    const manifest = readManifest(baseDir);
    if (!manifest)
        return;
    manifest.lastOperationAt = new Date().toISOString();
    manifest.lastOperationType = type;
    if (meta?.totalEntries !== undefined) {
        manifest.totalEntries = meta.totalEntries;
    }
    writeManifest(baseDir, manifest);
}
