/**
 * features/save/tool.ts — memory_save tool (modular).
 *
 * v1.6.0+: Integrated conflict detection (engram-inspired).
 * After saving, auto-detects conflicts with existing memories and
 * returns candidates for agent/user judgment.
 */

import type { MemoryStore } from "../../utils/memory-store.ts";
import type { DBBridge } from "../../utils/db-bridge.ts";
import { withErrorHandling } from "../../tools/common.ts";
import type { ToolRegistration } from "../../tools/common.ts";
import {
  detectConflicts,
  formatConflictCandidates,
  suggestRelation,
  canAutoResolve,
} from "../../core/conflict/detect.ts";

export function createSaveTool(store: MemoryStore, db: DBBridge, conflictDetection = true): ToolRegistration {
  return {
    id: "memory_save",
    name: "memory_save",
    label: "Memory Save",
    description:
      "Manually save an important memory to long-term storage. Use this when you want to explicitly " +
      "record something the AI should remember. Automatically checks for conflicts with existing memories.",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", description: "The memory content to save" },
        date: { type: "string", description: "Date string (YYYY-MM-DD). Defaults to today.", default: "" },
        tags: { type: "string", description: "Optional tags (comma-separated) like 'decision,preference,learning'", default: "" },
        skipConflictCheck: {
          type: "boolean",
          description: "Skip automatic conflict detection (default: false)",
          default: false,
        },
      },
      required: ["content"],
    },
    execute: withErrorHandling(async (_id: string, params: Record<string, unknown>) => {
      const content = String(params.content ?? "").trim();
      if (!content) return { content: [{ type: "text", text: "请输入要保存的记忆内容。" }] };

      const date = params.date ? String(params.date).trim() : new Date().toISOString().slice(0, 10);
      const tags = params.tags ? String(params.tags).trim() : "";
      const skipConflict = params.skipConflictCheck === true;
      const tagStr = tags ? ` [${tags}]` : "";

      const timestamp = new Date().toISOString().slice(0, 19).replace("T", " ");
      const entry = `\n### ${timestamp}\n💾 ${content}${tagStr}\n`;

      // Write to daily log
      store.appendToDaily(date, entry);

      // Index in FTS5
      const rowId = db.indexTurn(content, "", date);

      // ── Conflict detection ──
      let conflictOutput = "";
      if (conflictDetection && !skipConflict && content.length > 10) {
        try {
          const similar = db.search(content, 10);
          const candidates = detectConflicts(content, similar, { maxCandidates: 3 });

          if (candidates.length > 0) {
            // Try auto-resolve for high-confidence non-destructive relations
            const autoResolved: number[] = [];
            const pending: typeof candidates = [];

            for (const c of candidates) {
              const rel = suggestRelation(c);
              if (canAutoResolve(c, rel)) {
                // For compatible/related/not_conflict, auto-record the judgment
                try {
                  const metaRaw = db.getMemoryMeta(c.memoryId);
                  const meta = metaRaw ? tryParseJSON(metaRaw) : {};
                  if (!Array.isArray(meta.relations)) meta.relations = [] as Array<Record<string, unknown>>;
                  (meta.relations as Array<Record<string, unknown>>).push({
                    relation: rel,
                    reason: `自动裁决: ${c.reason}（置信度 ${(c.confidence * 100).toFixed(0)}%）`,
                    judgedAt: new Date().toISOString(),
                  });
                  db.updateMetadata(c.memoryId, JSON.stringify(meta));
                  autoResolved.push(c.memoryId);
                } catch (e: unknown) {
                  const msg = e instanceof Error ? e.message : String(e);
                  console.warn(`[yaoyao-memory:save] Auto-judge failed: ${msg}`);
                  pending.push(c);
                }
              } else {
                pending.push(c);
              }
            }

            if (autoResolved.length > 0) {
              conflictOutput += `\n🤖 自动裁决 ${autoResolved.length} 条非冲突关系。\n`;
            }

            if (pending.length > 0) {
              conflictOutput += "\n" + formatConflictCandidates(pending);
            }
          }
        } catch (err) {
          // Conflict detection is best-effort; don't block save
          conflictOutput = `\n⚠️ 冲突检测异常（已跳过）: ${err instanceof Error ? err.message : String(err)}`;
        }
      }

      const saveMsg = `✅ 记忆已保存到 ${date}.md\n行号: ${rowId > 0 ? rowId : "索引失败"}${tagStr ? `\n标签: ${tags}` : ""}`;

      return {
        content: [{
          type: "text",
          text: combineMessages(saveMsg, conflictOutput),
        }],
      };
    }),
  };
}

function tryParseJSON(s: string): Record<string, unknown> {
  try { return JSON.parse(s); } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[yaoyao-memory:save] Parse JSON failed: ${msg}`);
    return {};
  }
}

function combineMessages(a: string, b: string): string {
  if (!b) return a;
  return a + "\n" + b;
}
