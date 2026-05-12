/**
 * memory_import_workspace — Import workspace markdown files into Yaoyao index.
 *
 * Scans ~/.openclaw/workspace/ for .md files (MEMORY.md, USER.md, etc.),
 * parses them into sections, and indexes into FTS5.
 *
 * Idempotent: tracks imported files via memory_config table.
 */
import { withErrorHandling } from "./common.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
const DEFAULT_WORKSPACE = path.join(os.homedir(), ".openclaw", "workspace");
const TARGET_FILES = [
    "MEMORY.md",
    "USER.md",
    "SOUL.md",
    "IDENTITY.md",
    "AGENTS.md",
    "TOOLS.md",
    "HEARTBEAT.md",
];
export function createImportWorkspaceTool(store, db) {
    return {
        name: "memory_import_workspace",
        label: "Import Workspace Files",
        description: "📂 导入 workspace 下的 Markdown 文件到 Yaoyao 索引（MEMORY.md、USER.md 等）。增量导入，幂等安全。",
        parameters: {
            type: "object",
            properties: {
                files: {
                    type: "array",
                    items: { type: "string" },
                    description: "指定文件名（默认自动扫描 MEMORY.md/USER.md/SOUL.md 等）",
                },
                dryRun: {
                    type: "boolean",
                    description: "仅预览不实际导入（默认 false）",
                    default: false,
                },
            },
        },
        execute: withErrorHandling(async (_id, params) => {
            const dryRun = params.dryRun === true;
            const requestedFiles = (params.files && Array.isArray(params.files) && params.files.length > 0)
                ? params.files
                : TARGET_FILES;
            const workspaceDir = DEFAULT_WORKSPACE;
            if (!fs.existsSync(workspaceDir)) {
                return { content: [{ type: "text", text: "⚪ workspace 目录不存在。" }] };
            }
            // Find existing target files
            const foundFiles = [];
            for (const fname of requestedFiles) {
                const fp = path.join(workspaceDir, fname);
                if (fs.existsSync(fp)) {
                    const stat = fs.statSync(fp);
                    foundFiles.push({ name: fname, path: fp, size: stat.size, mtime: stat.mtimeMs });
                }
            }
            if (foundFiles.length === 0) {
                return { content: [{ type: "text", text: "⚪ 未找到可导入的 workspace 文件。" }] };
            }
            if (dryRun) {
                const lines = foundFiles.map(f => `  - ${f.name} (${(f.size / 1024).toFixed(1)} KB)`);
                return { content: [{ type: "text", text: [
                                `📋 预览: 发现 ${foundFiles.length} 个文件可导入`,
                                `目录: ${workspaceDir}`,
                                "",
                                ...lines,
                                "",
                                "使用 dryRun: false 执行实际导入。",
                            ].join("\n") }] };
            }
            // Import
            let imported = 0;
            let sections = 0;
            const today = new Date().toISOString().slice(0, 10);
            for (const file of foundFiles) {
                try {
                    // Check if already imported (by filename + mtime)
                    const checkpointKey = `ws_import_${file.name}`;
                    const lastMtime = db.getConfig(checkpointKey, "0");
                    if (String(Math.floor(file.mtime)) === lastMtime) {
                        continue; // already imported this version
                    }
                    const content = fs.readFileSync(file.path, "utf-8");
                    if (content.trim().length < 20)
                        continue;
                    // Split by ## headers into sections
                    const parts = content.split(/^(#{1,3}\s+.+)$/gm).filter(Boolean);
                    // Combine headers with their content
                    const fileSections = [];
                    let currentHeader = file.name;
                    for (const part of parts) {
                        if (/^#{1,3}\s+/.test(part)) {
                            currentHeader = part.trim();
                        }
                        else {
                            const text = part.trim();
                            if (text.length >= 10) {
                                fileSections.push({ header: currentHeader, text });
                            }
                        }
                    }
                    // If no headers found, import as single section
                    if (fileSections.length === 0 && content.trim().length >= 10) {
                        fileSections.push({ header: file.name, text: content.trim() });
                    }
                    // Index each section
                    for (const sec of fileSections) {
                        const sourceTag = `[ws:${file.name}#${sec.header.replace(/\s+/g, "_").slice(0, 30)}]`;
                        const rowId = db.indexTurn(`${sourceTag} ${sec.text.slice(0, 1900)}`, "", today);
                        if (rowId > 0)
                            sections++;
                    }
                    // Update checkpoint
                    db.setConfig(checkpointKey, String(Math.floor(file.mtime)));
                    imported++;
                }
                catch {
                    // Skip this file, continue with others
                }
            }
            return { content: [{ type: "text", text: [
                            `✅ Workspace 导入完成`,
                            `扫描: ${foundFiles.length} 个文件`,
                            `导入文件: ${imported} 个`,
                            `导入段落: ${sections} 条`,
                            `跳过（未变化）: ${foundFiles.length - imported} 个`,
                        ].join("\n") }] };
        }),
    };
}
