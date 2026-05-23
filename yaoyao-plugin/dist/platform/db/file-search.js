/**
 * platform/db/file-search.ts — FileDB search and listing operations.
 */
import fs from "node:fs";
import path from "node:path";
const MAX_FILE_BYTES = 10 * 1024 * 1024;
export function searchFiles(baseDir, query, limit) {
    const results = [];
    let files;
    try {
        files = fs.readdirSync(baseDir).filter(f => f.endsWith(".md") && f.match(/^\d{4}-\d{2}-\d{2}\.md$/));
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[yaoyao-memory:db] Search read baseDir failed: ${msg}`);
        return [];
    }
    const q = query.toLowerCase();
    for (const file of files) {
        const filePath = path.join(baseDir, file);
        let content;
        try {
            const stat = fs.statSync(filePath);
            if (stat.size > MAX_FILE_BYTES)
                continue;
            content = fs.readFileSync(filePath, "utf-8");
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn(`[yaoyao-memory:db] Read file failed: ${msg}`);
            continue;
        }
        if (content.toLowerCase().includes(q)) {
            const lines = content.split("\n");
            const idx = lines.findIndex(l => l.toLowerCase().includes(q));
            const snippet = idx >= 0 ? lines[idx].slice(0, 200) : "";
            results.push({
                id: results.length + 1,
                rowid: results.length + 1,
                date: file.replace(".md", ""),
                snippet: snippet,
                rank: -results.length,
            });
        }
    }
    return results.slice(0, limit);
}
export function listFiles(baseDir, limit) {
    let files;
    try {
        files = fs.readdirSync(baseDir).filter(f => f.endsWith(".md") && f.match(/^\d{4}-\d{2}-\d{2}\.md$/));
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[yaoyao-memory:db] List files failed: ${msg}`);
        return [];
    }
    return files.slice(0, limit).map(f => ({
        rowid: f,
        date: f.replace(".md", ""),
        snippet: "",
        user_text: "",
        asst_text: "",
    }));
}
export function countFiles(baseDir) {
    try {
        return fs.readdirSync(baseDir).filter(f => f.endsWith(".md")).length;
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[yaoyao-memory:db] Count files failed: ${msg}`);
        return 0;
    }
}
