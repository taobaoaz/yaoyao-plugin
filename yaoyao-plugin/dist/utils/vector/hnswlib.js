/**
 * HnswlibBackend — optional high-performance ANN vector search.
 *
 * Requires `hnswlib-node` to be installed manually (C++ addon).
 * Falls back to sqlite-vec if hnswlib-node is unavailable or crashes.
 */
import path from 'node:path';
import fs from 'node:fs';
import { clampNum } from "../clamp.js";
import { requireHnswlib } from "./hnswlib-loader.js";
import { createPersistManager } from "./hnswlib-persist.js";
export class HnswlibBackend {
    name = 'hnswlib';
    isAvailable = false;
    db = null;
    config = {};
    logger;
    index = null;
    hnswlib = null;
    indexDir = '';
    indexPath = '';
    metaPath = '';
    dimensions = 1024;
    dim = 1024;
    ef = 200;
    indexType = 'hnsw';
    snippetMaxLen = 500;
    searchMaxLimit = 100;
    maxElements = 50000;
    persist = createPersistManager({
        index: null,
        indexPath: '',
        metaPath: '',
        dimensions: 1024,
        config: {},
        logger: undefined,
    });
    init(db, config, logger) {
        this.db = db;
        this.config = config;
        this.logger = logger;
        this.dimensions = config.embedding?.dimensions ?? 1024;
        this.snippetMaxLen = Math.min(Math.max(config.snippetMaxLen ?? 500, 100), 2000);
        this.searchMaxLimit = Math.min(Math.max(config.searchMaxLimit ?? 100, 10), 1000);
        this.maxElements = clampNum(config.embedding?.hnswMaxElements, 50000, 1000, 500000);
        const memoryDir = config.memoryDir || path.join(process.env.HOME || '.', '.openclaw', 'workspace', 'memory');
        this.indexDir = path.join(memoryDir, '.hnsw');
        this.indexPath = path.join(this.indexDir, 'index.bin');
        this.metaPath = path.join(this.indexDir, 'meta.json');
        this.persist = createPersistManager({
            index: this.index,
            indexPath: this.indexPath,
            metaPath: this.metaPath,
            dimensions: this.dimensions,
            config,
            logger,
        });
        try {
            this.hnswlib = requireHnswlib();
            if (!this.hnswlib) {
                logger?.warn?.('[yaoyao-memory:vec] hnswlib-node not installed — install with: npm install hnswlib-node');
                return false;
            }
            this.index = new this.hnswlib.HierarchicalNSW('cosine', this.dimensions);
            if (!fs.existsSync(this.indexDir)) {
                fs.mkdirSync(this.indexDir, { recursive: true, mode: 0o700 });
            }
            if (fs.existsSync(this.indexPath) && fs.existsSync(this.metaPath)) {
                let meta;
                try {
                    meta = JSON.parse(fs.readFileSync(this.metaPath, 'utf-8'));
                }
                catch (e) {
                    const msg = e instanceof Error ? e.message : String(e);
                    console.warn(`[yaoyao-memory:vec] Operation failed: ${msg}`);
                    meta = {
                        dim: this.dim,
                        ef_construction: this.ef,
                        max_elements: this.maxElements,
                        indexType: this.indexType,
                        dimensions: this.dimensions,
                        count: 0,
                        space: 'cosine',
                    };
                }
                if (meta.dimensions === this.dimensions) {
                    this.index.readIndexSync(this.indexPath);
                    this.isAvailable = true;
                    logger?.info?.(`[yaoyao-memory:vec] hnswlib backend loaded: ${meta.count} vectors, dim=${meta.dimensions}`);
                    return true;
                }
                logger?.warn?.(`[yaoyao-memory:vec] HNSW dimensions changed (${meta.dimensions} → ${this.dimensions}), rebuilding...`);
            }
            this.index.initIndex({ maxElements: this.maxElements, allowReplaceDeleted: true });
            this.isAvailable = true;
            logger?.info?.(`[yaoyao-memory:vec] hnswlib backend initialized (maxElements=${this.maxElements}, dim=${this.dimensions})`);
            return true;
        }
        catch (e) {
            logger?.warn?.(`[yaoyao-memory:vec] hnswlib init failed: ${e instanceof Error ? e.message : String(e)}`);
            this.isAvailable = false;
            return false;
        }
    }
    storeVector(metaId, embedding) {
        if (metaId <= 0 || !this.isAvailable || !this.index)
            return false;
        try {
            const vec = Array.from(embedding);
            this.index.addPoint(vec, metaId);
            this.persist.markDirty();
            return true;
        }
        catch (err) {
            this.logger?.warn?.(`[yaoyao-memory:vec] storeVector error: ${err instanceof Error ? err.message : String(err)}`);
            return false;
        }
    }
    vectorSearch(embedding, limit = 10) {
        if (!this.isAvailable || !this.index || !this.db)
            return [];
        try {
            const k = Math.min(Math.max(limit, 1), this.searchMaxLimit);
            const vec = Array.from(embedding);
            const result = this.index.searchKnn(vec, k);
            if (!result.neighbors.length)
                return [];
            const placeholders = result.neighbors.map(() => '?').join(',');
            const stmt = this.db.prepare(`SELECT id, date, user_text, asst_text FROM memory_meta WHERE id IN (${placeholders})`);
            const rows = stmt.all(...result.neighbors);
            const rowMap = new Map(rows.map((r) => [r.id, r]));
            const results = [];
            for (let i = 0; i < result.neighbors.length; i++) {
                const id = result.neighbors[i];
                const distance = result.distances[i];
                const row = rowMap.get(id);
                if (!row)
                    continue;
                const similarity = 1 - distance;
                const snippet = `${row.user_text || ''} ${row.asst_text || ''}`.trim();
                results.push({
                    id,
                    filename: row.date ? `${row.date}.md` : 'memory.db',
                    snippet: snippet.slice(0, this.snippetMaxLen),
                    score: Math.max(0, similarity),
                    date: row.date || '',
                    asst_text: (row.asst_text || '').slice(0, this.snippetMaxLen),
                    vectorScore: Math.max(0, similarity),
                    hybridScore: Math.max(0, similarity),
                });
            }
            return results;
        }
        catch (err) {
            this.logger?.warn?.(`[yaoyao-memory:vec] vectorSearch error: ${err instanceof Error ? err.message : String(err)}`);
            return [];
        }
    }
    close() {
        this.persist.flush(true);
        this.persist.cleanup();
        this.index = null;
        this.hnswlib = null;
        this.isAvailable = false;
    }
    deleteOrphans() {
        if (!this.isAvailable || !this.index || !this.db)
            return;
        try {
            const rows = this.db.prepare('SELECT id FROM memory_meta').all();
            const validIds = new Set(rows.map((r) => r.id));
            const count = this.index.getCurrentCount?.() ?? 0;
            this.logger?.debug?.('[yaoyao-memory:vec] HNSW deleteOrphans: no-op (filtered at search time)');
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn(`[yaoyao-memory]  best effort : ${msg}`);
        }
    }
    getVectorCount() {
        return this.index?.getCurrentCount?.() ?? 0;
    }
    getDimensions() {
        return this.dimensions;
    }
}
