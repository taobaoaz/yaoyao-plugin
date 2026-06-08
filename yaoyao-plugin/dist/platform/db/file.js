import fs from 'node:fs';
import path from 'node:path';
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB cap per file
export class FileDB {
    baseDir;
    indexPath;
    index; // date -> [filenames]
    constructor(baseDir) {
        this.baseDir = baseDir;
        // Build a simple in-memory index from existing files
        this.indexPath = path.join(baseDir, '.filedb_index.json');
        this.index = new Map();
        try {
            if (fs.existsSync(this.indexPath)) {
                const raw = fs.readFileSync(this.indexPath, 'utf-8');
                let parsed;
                try {
                    parsed = JSON.parse(raw);
                }
                catch (e) {
                    const msg = e instanceof Error ? e.message : String(e);
                    console.warn(`[yaoyao-memory:db] Parse index failed: ${msg}`);
                    parsed = {};
                }
                for (const [k, v] of Object.entries(parsed)) {
                    if (Array.isArray(v))
                        this.index.set(k, v);
                }
            }
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn(`[yaoyao-memory:db] Read index failed: ${msg}`);
        }
        try {
            if (!fs.existsSync(baseDir)) {
                fs.mkdirSync(baseDir, { recursive: true });
            }
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn(`[yaoyao-memory:db] Create baseDir failed: ${msg}`);
        }
    }
    exec(_sql) {
        /* no-op */
    }
    prepare(sql) {
        // Minimal SQL parsing for FileDB
        const lower = sql.toLowerCase().trim();
        // ── SELECT ... FROM memory_meta ──
        if (lower.startsWith('select')) {
            const isCount = /count\(\*\)/.test(lower);
            const limitMatch = lower.match(/limit\s+(\d+)/);
            const limit = limitMatch ? parseInt(limitMatch[1], 10) : 10;
            const dateMatch = lower.match(/date\s*=\s*\?/);
            const orderDesc = lower.includes('order by id desc');
            return {
                run: () => ({ lastInsertRowid: 0, changes: 0 }),
                all: (...args) => {
                    try {
                        if (isCount) {
                            const files = fs
                                .readdirSync(this.baseDir)
                                .filter((f) => f.endsWith('.md') && f.match(/^\d{4}-\d{2}-\d{2}\.md$/));
                            return [{ c: files.length }];
                        }
                        if (dateMatch && args.length > 0) {
                            const date = String(args[0]);
                            const filePath = path.join(this.baseDir, `${date}.md`);
                            if (fs.existsSync(filePath)) {
                                const size = fs.statSync(filePath).size;
                                return [{ id: 1, date, user_text: filePath, asst_text: '', size }];
                            }
                            return [];
                        }
                        if (orderDesc || lower.includes('order by')) {
                            return this._listAll(orderDesc ? limit : limit);
                        }
                        return searchFiles(this.baseDir, args[0] || '', limit);
                    }
                    catch (e) {
                        const msg = e instanceof Error ? e.message : String(e);
                        console.warn(`[yaoyao-memory:db] Select all failed: ${msg}`);
                        return [];
                    }
                },
                get: (...args) => {
                    try {
                        if (isCount) {
                            const files = fs.readdirSync(this.baseDir).filter((f) => f.endsWith('.md'));
                            return { c: files.length };
                        }
                        if (dateMatch && args.length > 0) {
                            const date = String(args[0]);
                            const filePath = path.join(this.baseDir, `${date}.md`);
                            return fs.existsSync(filePath)
                                ? { id: 1, date, user_text: filePath, asst_text: '' }
                                : undefined;
                        }
                        const rows = searchFiles(this.baseDir, args[0] || '', 1);
                        return rows[0];
                    }
                    catch (e) {
                        const msg = e instanceof Error ? e.message : String(e);
                        console.warn(`[yaoyao-memory:db] Select get failed: ${msg}`);
                        return undefined;
                    }
                },
            };
        }
        // ── DELETE FROM memory_meta ──
        if (lower.startsWith('delete')) {
            const dateMatch = lower.match(/date\s*=\s*\?/);
            return {
                run: (...args) => {
                    try {
                        if (dateMatch && args.length > 0) {
                            const filePath = path.join(this.baseDir, `${String(args[0])}.md`);
                            if (fs.existsSync(filePath)) {
                                fs.unlinkSync(filePath);
                                return { lastInsertRowid: 0, changes: 1 };
                            }
                        }
                        return { lastInsertRowid: 0, changes: 0 };
                    }
                    catch (e) {
                        const msg = e instanceof Error ? e.message : String(e);
                        console.warn(`[yaoyao-memory:db] Delete failed: ${msg}`);
                        return { lastInsertRowid: 0, changes: 0 };
                    }
                },
                all: () => [],
                get: () => undefined,
            };
        }
        // ── INSERT ──
        if (lower.startsWith('insert')) {
            return {
                run: (...args) => {
                    try {
                        const date = String(args[0] || '');
                        const text = String(args[1] || '');
                        const filePath = path.join(this.baseDir, `${date}.md`);
                        fs.appendFileSync(filePath, text + '\n');
                        return { lastInsertRowid: 1, changes: 1 };
                    }
                    catch (e) {
                        const msg = e instanceof Error ? e.message : String(e);
                        console.warn(`[yaoyao-memory:db] Insert failed: ${msg}`);
                        return { lastInsertRowid: 0, changes: 0 };
                    }
                },
                all: () => [],
                get: () => undefined,
            };
        }
        // ── Default no-op ──
        return {
            run: () => ({ lastInsertRowid: 0, changes: 0 }),
            all: () => [],
            get: () => undefined,
        };
    }
    close() {
        /* no-op */
    }
    _listAll(limit) {
        return listFiles(this.baseDir, limit);
    }
}
import { searchFiles, listFiles, countFiles } from "./file-search.js";
export { searchFiles, listFiles, countFiles };
export function createFileDB(dbPath) {
    const baseDir = path.dirname(dbPath);
    try {
        fs.mkdirSync(baseDir, { recursive: true });
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[yaoyao-memory:db] Create baseDir failed: ${msg}`);
    }
    return new FileDB(baseDir);
}
