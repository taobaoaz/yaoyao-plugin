/**
 * features/import-oc/tool.ts — memory_import_oc tool (modular).
 */
import { withErrorHandling } from "../../tools/common.js";
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createCompatDB } from "../../storage/bridge.js";
function getOCLocation() {
    const defaultPath = path.join(os.homedir(), '.openclaw', 'memory', 'main.sqlite');
    if (fs.existsSync(defaultPath))
        return defaultPath;
    return null;
}
function contentHash(text) {
    return crypto
        .createHash('sha256')
        .update(String(text || ''))
        .digest('hex')
        .slice(0, 32);
}
export function createImportOCTool(store, db) {
    return {
        id: 'memory_import_oc',
        name: 'memory_import_oc',
        label: 'Import OpenClaw Chunks',
        description: '📦 将 OpenClaw 原生记忆 chunks 导入 Yaoyao 索引。增量导入，幂等安全，不修改源数据。',
        parameters: {
            type: 'object',
            properties: {
                limit: {
                    type: 'number',
                    description: '最多导入条数（默认 500，0=全部）',
                    default: 500,
                },
                dryRun: {
                    type: 'boolean',
                    description: '仅预览不实际导入（默认 false）',
                    default: false,
                },
            },
            required: [],
        },
        execute: withErrorHandling(async (_id, params) => {
            const limit = Number(params.limit) || 500;
            const dryRun = params.dryRun === true;
            const ocDbPath = getOCLocation();
            if (!ocDbPath) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: '⚪ 未发现 OpenClaw 原生记忆数据（~/.openclaw/memory/main.sqlite 不存在）。无需导入。',
                        },
                    ],
                };
            }
            let chunks;
            try {
                const { db: ocDb } = createCompatDB(ocDbPath);
                ocDb.exec('PRAGMA busy_timeout = 3000');
                try {
                    const sql = limit > 0
                        ? 'SELECT c.id, c.path, c.text, c.start_line, c.end_line, f.updated_at FROM chunks c LEFT JOIN files f ON c.path = f.path ORDER BY c.id DESC LIMIT ?'
                        : 'SELECT c.id, c.path, c.text, c.start_line, c.end_line, f.updated_at FROM chunks c LEFT JOIN files f ON c.path = f.path ORDER BY c.id DESC';
                    const stmt = ocDb.prepare(sql);
                    chunks =
                        limit > 0
                            ? stmt.all(limit)
                            : stmt.all();
                }
                finally {
                    try {
                        ocDb.close();
                    }
                    catch (e) {
                        const msg = e instanceof Error ? e.message : String(e);
                        console.warn(`[yaoyao-memory]  ignore : ${msg}`);
                    }
                }
            }
            catch (err) {
                const msg = err instanceof Error ? (err instanceof Error ? err.message : String(err)) : String(err);
                return { content: [{ type: 'text', text: `❌ 读取 OpenClaw 记忆失败: ${msg}` }] };
            }
            if (chunks.length === 0) {
                return { content: [{ type: 'text', text: '⚪ OpenClaw 记忆库为空，无需导入。' }] };
            }
            const lastImportedId = Number(db.getConfig('oc_import_last_id', '0') || '0');
            const newChunks = chunks.filter((c) => c.id > lastImportedId);
            if (newChunks.length === 0) {
                return {
                    content: [
                        { type: 'text', text: `✅ 已是最新。共 ${chunks.length} 条 chunks，全部已导入。` },
                    ],
                };
            }
            if (dryRun) {
                const sample = newChunks
                    .slice(0, 5)
                    .map((c) => `  - [${c.path}:${c.start_line}-${c.end_line}] ${String(c.text || '').slice(0, 80)}...`);
                return {
                    content: [
                        {
                            type: 'text',
                            text: [
                                `📋 预览: 发现 ${newChunks.length} 条新 chunks 可导入`,
                                `来源: ${ocDbPath}`,
                                `最后已导入 ID: ${lastImportedId}`,
                                '',
                                '示例:',
                                ...sample,
                                newChunks.length > 5 ? `...还有 ${newChunks.length - 5} 条` : '',
                                '',
                                '使用 dryRun: false 执行实际导入。',
                            ].join('\n'),
                        },
                    ],
                };
            }
            let imported = 0;
            let skipped = 0;
            let maxId = lastImportedId;
            const now = new Date().toISOString().slice(0, 10);
            const newHashes = [];
            for (const chunk of newChunks) {
                try {
                    const text = String(chunk.text || '').trim();
                    if (text.length < 10) {
                        skipped++;
                        continue;
                    }
                    const dateMatch = String(chunk.path || '').match(/(\d{4}-\d{2}-\d{2})/);
                    const date = dateMatch
                        ? dateMatch[1]
                        : chunk.updated_at
                            ? String(chunk.updated_at).slice(0, 10)
                            : now;
                    const hash = contentHash(text);
                    const existing = db.getConfig(`oc_hash_${hash}`, null);
                    if (existing) {
                        skipped++;
                        continue;
                    }
                    const sourceTag = `[oc-import:${chunk.path}:${chunk.start_line}]`;
                    const rowId = db.indexTurn(`${sourceTag} ${text.slice(0, 1900)}`, '', date);
                    if (rowId > 0) {
                        imported++;
                        maxId = Math.max(maxId, chunk.id);
                        newHashes.push({ key: `oc_hash_${hash}`, value: String(rowId) });
                    }
                    else {
                        skipped++;
                    }
                }
                catch (e) {
                    const msg = e instanceof Error ? e.message : String(e);
                    console.warn(`[yaoyao-memory:import-oc] Import chunk failed: ${msg}`);
                    skipped++;
                }
            }
            // 批量写入去重 hash，减少 WAL 频繁 checkpoint
            if (newHashes.length > 0) {
                try {
                    db.batchSetConfig(newHashes.map((h) => ({ key: h.key, value: h.value })));
                }
                catch (e) {
                    const msg = e instanceof Error ? e.message : String(e);
                    console.warn(`[yaoyao-memory:import-oc] Batch write failed (non-blocking): ${msg}`);
                }
            }
            db.setConfig('oc_import_last_id', String(maxId));
            return {
                content: [
                    {
                        type: 'text',
                        text: [
                            `✅ 导入完成`,
                            `来源: OpenClaw 原生记忆 (${ocDbPath})`,
                            `新发现: ${newChunks.length} 条`,
                            `成功导入: ${imported} 条`,
                            `跳过: ${skipped} 条（太短/重复）`,
                            `检查点: last_id=${maxId}`,
                        ].join('\n'),
                    },
                ],
            };
        }),
    };
}
