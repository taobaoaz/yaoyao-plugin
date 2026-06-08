import { detectAtRisk, formatRetainCheck, formatBoostResult, formatImportantResult, } from "../../core/retain/retain.js";
import { loadBoostRecords, appendBoostRecord, loadImportantTags, saveImportantTags, } from "./store.js";
export async function handleCheck(store, db) {
    const baseDir = store.baseDir;
    const boostRecords = loadBoostRecords(baseDir);
    const importantTags = loadImportantTags(baseDir);
    const allMemories = [];
    try {
        const results = db.search('', 500);
        for (const r of results) {
            const keyword = r.snippet
                .slice(0, 60)
                .replace(/[^\w\u4e00-\u9fff\s]/g, '')
                .trim() || 'untitled';
            allMemories.push({
                keyword,
                filename: r.filename || 'unknown',
                snippet: r.snippet.slice(0, 120),
            });
        }
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[yaoyao-memory]  best effort : ${msg}`);
    }
    const atRisk = detectAtRisk(allMemories, boostRecords, importantTags, 7);
    const text = formatRetainCheck(allMemories.length, boostRecords.length, importantTags.length, atRisk);
    return { content: [{ type: 'text', text }] };
}
export async function handleBoost(store, db, keyword, filename, reason) {
    const baseDir = store.baseDir;
    const record = { keyword, filename, boostedAt: new Date().toISOString(), reason };
    try {
        appendBoostRecord(baseDir, record);
    }
    catch (err) {
        return {
            content: [
                {
                    type: 'text',
                    text: `❌ 写入强化记录失败: ${err instanceof Error ? err.message : String(err) || '未知错误'}`,
                },
            ],
        };
    }
    let matchedCount = 0;
    try {
        matchedCount = db.search(keyword, 20).length;
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[yaoyao-memory]  best effort : ${msg}`);
    }
    const text = formatBoostResult(keyword, filename, reason, record.boostedAt, matchedCount);
    return { content: [{ type: 'text', text }] };
}
export async function handleImportant(store, keyword, filename, reason) {
    const baseDir = store.baseDir;
    const tags = loadImportantTags(baseDir);
    if (tags.some((t) => t.keyword === keyword && (filename ? t.filename === filename : true))) {
        return {
            content: [
                {
                    type: 'text',
                    text: `ℹ️ 该记忆已标记为重要: keyword="${keyword}"${filename ? `, filename="${filename}"` : ''}`,
                },
            ],
        };
    }
    const tag = { keyword, filename, reason, taggedAt: new Date().toISOString() };
    tags.push(tag);
    try {
        saveImportantTags(baseDir, tags);
    }
    catch (err) {
        return {
            content: [
                {
                    type: 'text',
                    text: `❌ 写入重要标签失败: ${err instanceof Error ? err.message : String(err) || '未知错误'}`,
                },
            ],
        };
    }
    const text = formatImportantResult(keyword, filename, reason, tag.taggedAt);
    return { content: [{ type: 'text', text }] };
}
