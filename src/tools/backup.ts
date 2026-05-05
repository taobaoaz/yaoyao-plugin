/**
 * Backup Tool — snapshot backup of memory data (powered by createBackupManager).
 */
import type { MemoryStore } from "../utils/memory-store.js";
import { createBackupManager } from "../utils/backup.js";
import { withErrorHandling } from "./common.js";
import type { ToolRegistration } from "./common.js";

export function createBackupTool(store: MemoryStore): ToolRegistration {
  return {
    name: "memory_backup",
    label: "Memory Backup",
    description: "Create a timestamped backup snapshot of all memory data (SQLite DB + daily log files). Also lists recent backups.",
    parameters: {
      type: "object",
      properties: {
        label: { type: "string", description: "Optional label (e.g. 'before-migration')", default: "" },
        action: { type: "string", enum: ["create", "list", "prune"], description: "create (default), list, or prune (keep 10)", default: "create" },
      },
    },
    execute: withErrorHandling(async (_id: string, params: Record<string, unknown>) => {
      const mgr = createBackupManager(store.baseDir);
      const action = String(params.action ?? "create");

      if (action === "list") {
        const backups = mgr.listBackups();
        if (backups.length === 0) return { content: [{ type: "text", text: "暂无备份。" }] };
        const lines = backups.map(b => `📦 ${b.name} (${b.sizeKB}KB, ${b.files} 个文件)`);
        return { content: [{ type: "text", text: `📋 备份列表 (共 ${backups.length} 个):\n\n${lines.join("\n")}` }] };
      }

      if (action === "prune") {
        mgr.pruneBackups(10);
        return { content: [{ type: "text", text: "✅ 已清理旧备份，保留最近 10 个。" }] };
      }

      const backupName = mgr.createBackup();
      if (!backupName) return { content: [{ type: "text", text: "❌ 备份失败" }] };
      return { content: [{ type: "text", text: `✅ 备份完成\n\n📁 名称: ${backupName}` }] };
    }),
  };
}
