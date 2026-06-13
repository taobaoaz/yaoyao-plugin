/**
 * features/backup/tool.ts — memory_backup tool (modular).
 *
 * Assembles utils/backup logic + MemoryStore + formatting.
 */
import { createBackupManager } from "../../utils/backup.js";
import { clampNum } from "../../utils/clamp.js";
import { withErrorHandling } from "../../tools/common.js";
export function createBackupTool(store) {
    return {
        id: "memory_backup",
        name: "memory_backup",
        label: "Memory Backup",
        description: "创建记忆数据的时间戳快照备份。支持全量备份和增量备份（仅备份修改过的文件），也可列出和清理备份。",
        parameters: {
            type: "object",
            properties: {
                action: { type: "string", enum: ["create", "list", "prune"], description: "create（默认）、list 列出备份、prune 清理（默认保留最近 10 个）", default: "create" },
                mode: { type: "string", enum: ["full", "incremental"], description: "备份模式：full 全量、incremental 仅备份自上次备份以来新增/修改的文件", default: "full" },
                keep: { type: "number", description: "prune 时保留的备份数量（默认 10，范围 1-100）", default: 10 },
            },
            required: [],
        },
        execute: withErrorHandling(async (_id, params) => {
            const mgr = createBackupManager(store.baseDir);
            const action = String(params.action ?? "create");
            const mode = String(params.mode || "full");
            if (action === "list") {
                const backups = mgr.listBackups();
                if (backups.length === 0)
                    return { content: [{ type: "text", text: "暂无备份。" }] };
                const lines = backups.map(b => {
                    const modeIcon = b.name.includes("-incremental-") ? "🔄" : "📦";
                    const modeLabel = b.name.includes("-incremental-") ? "增量" : "全量";
                    return `${modeIcon} ${b.name} (${b.sizeKB}KB, ${b.files} 个文件, ${modeLabel})`;
                });
                return { content: [{ type: "text", text: `📋 备份列表 (共 ${backups.length} 个):\n\n${lines.join("\n")}` }] };
            }
            if (action === "prune") {
                const keep = clampNum(params.keep, 10, 1, 100);
                mgr.pruneBackups(keep);
                return { content: [{ type: "text", text: `✅ 已清理旧备份，保留最近 ${keep} 个。` }] };
            }
            const backupName = mgr.createBackup(mode);
            if (!backupName) {
                return { content: [{ type: "text", text: mode === "incremental" ? "ℹ️ 自上次备份以来无变更，增量备份已跳过。" : "❌ 备份失败" }] };
            }
            const modeEmoji = mode === "incremental" ? "🔄" : "📦";
            return { content: [{ type: "text", text: `${modeEmoji} 备份完成\n\n📁 名称: ${backupName}\n📋 模式: ${mode === "incremental" ? "增量" : "全量"}` }] };
        }),
    };
}
