/**
 * features/conflict/tool.ts — memory_judge + memory_conflicts tools.
 *
 * Thin tool layer: param validation → core/conflict → formatter output.
 * Formatted output via conflict/formatter.ts.
 */
import type { DBBridge } from "../../utils/db-bridge.ts";
import { withErrorHandling } from "../../tools/common.ts";
import type { ToolRegistration, ToolHandlerResult } from "../../tools/common.ts";
import { detectConflicts, formatConflictCandidates } from "../../core/conflict/detect.ts";
import type { ConflictRelation } from "../../core/conflict/detect.ts";
import { VALID_RELATIONS, formatRelation, formatJudgeResult } from "./formatter.ts";

/**
 * memory_judge — Judge a conflict between two memories.
 */
export function createJudgeTool(db: DBBridge): ToolRegistration {
  const rawDb = db.getRawDb();
  return {
    id: "memory_judge",
    name: "memory_judge",
    label: "Judge Memory Conflict",
    description:
      "🧑⚖️ 裁决两条记忆之间的关系。关系类型：supersedes / conflicts_with / compatible / related / not_conflict。",
    parameters: {
      type: "object",
      properties: {
        memoryId: { type: "number", description: "目标记忆的 ID" },
        relation: {
          type: "string",
          enum: VALID_RELATIONS,
          description: "新记忆与目标的关系",
        },
        reason: { type: "string", description: "裁决理由" },
        evidence: { type: "string", description: "可选：用户的原始表达或确认内容", default: "" },
      },
      required: ["memoryId", "relation", "reason"],
    },
    execute: withErrorHandling(async (_id: string, params: Record<string, unknown>): Promise<ToolHandlerResult> => {
      const memoryId = Number(params.memoryId);
      const relation = String(params.relation ?? "");
      const reason = String(params.reason ?? "").trim();
      const evidence = params.evidence ? String(params.evidence).trim() : "";

      if (!Number.isFinite(memoryId) || memoryId <= 0) {
        return { content: [{ type: "text", text: "❌ 无效的 memoryId" }] };
      }
      if (!VALID_RELATIONS.includes(relation as ConflictRelation)) {
        return { content: [{ type: "text", text: `❌ 无效的 relation。可选: ${VALID_RELATIONS.join(", ")}` }] };
      }
      const typedRelation = relation as ConflictRelation;
      if (!reason) {
        return { content: [{ type: "text", text: "❌ 请提供裁决理由（reason 参数）" }] };
      }

      const judgedAt = new Date().toISOString();

      // Store in the target memory's meta field
      const sql = "SELECT meta FROM memory_meta WHERE id = ?";
      const existing = rawDb.prepare(sql).get(memoryId) as { meta: string | null } | undefined;

      let meta: Record<string, unknown> = {};
      if (existing?.meta) {
        try { meta = JSON.parse(existing.meta); } catch { meta = {}; }
      }

      const relationsArray: Array<Record<string, unknown>> = Array.isArray(meta.relations)
        ? meta.relations as Array<Record<string, unknown>>
        : [];
      if (!Array.isArray(meta.relations)) meta.relations = relationsArray;

      relationsArray.push({ relation: typedRelation, reason, evidence: evidence || undefined, judgedAt });

      rawDb.prepare("UPDATE memory_meta SET meta = ? WHERE id = ?").run(JSON.stringify(meta), memoryId);

      return {
        content: [{
          type: "text",
          text: formatJudgeResult({ memoryId, relation: typedRelation, reason, evidence, judgedAt }),
        }],
      };
    }),
  };
}

/**
 * memory_conflicts — List or scan conflict relations.
 */
export function createConflictsTool(db: DBBridge): ToolRegistration {
  const rawDb = db.getRawDb();
  return {
    id: "memory_conflicts",
    name: "memory_conflicts",
    label: "Memory Conflicts List",
    description:
      "📋 查看或扫描记忆冲突关系。action=list 列出已有关系; action=scan 对新文本进行冲突检测。",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "scan"],
          description: "操作: list=列出已有冲突, scan=对新文本进行冲突扫描",
          default: "list",
        },
        text: { type: "string", description: "（仅 scan）待检测的文本内容" },
        limit: { type: "number", description: "返回结果上限（默认 20）", default: 20 },
      },
    },
    execute: withErrorHandling(async (_id: string, params: Record<string, unknown>): Promise<ToolHandlerResult> => {
      const action = String(params.action ?? "list");
      const limit = Math.min(Math.max(Number(params.limit ?? 20), 1), 100);

      if (action === "list") {
        const rows = rawDb.prepare(
          "SELECT id, date, user_text, meta FROM memory_meta " +
          "WHERE meta IS NOT NULL AND json_extract(meta, '$.relations') IS NOT NULL " +
          "ORDER BY id DESC LIMIT ?"
        ).all(limit) as Array<{ id: number; date: string; user_text: string | null; meta: string }>;

        if (rows.length === 0) {
          return { content: [{ type: "text", text: "📋 当前没有已裁决的冲突关系。" }] };
        }

        const lines = ["📋 **已裁决的冲突关系**", ""];
        for (const row of rows) {
          try {
            const meta = JSON.parse(row.meta);
            const relations = meta.relations as Array<{ relation: string; reason: string; judgedAt: string }> | undefined;
            if (!relations || relations.length === 0) continue;

            lines.push(`**记忆 ID ${row.id}** [${row.date}]`, `内容: ${(row.user_text ?? "").slice(0, 80)}...`);
            for (const rel of relations) {
              lines.push(`  ${formatRelation(rel.relation as ConflictRelation)} — ${rel.reason}（${rel.judgedAt.slice(0, 10)}）`);
            }
            lines.push("");
          } catch { /* skip */ }
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      // scan
      const text = String(params.text ?? "").trim();
      if (!text) return { content: [{ type: "text", text: "❌ scan 模式需要提供 text 参数" }] };

      const results = db.search(text, limit);
      const candidates = detectConflicts(text, results, { maxCandidates: Math.min(limit, 5) });

      if (candidates.length === 0) {
        return { content: [{ type: "text", text: "✅ 扫描完成，未检测到冲突。" }] };
      }

      const report = formatConflictCandidates(candidates) + `\n共扫描 ${results.length} 条相关记忆，发现 ${candidates.length} 个冲突候选。`;
      return { content: [{ type: "text", text: report }] };
    }),
  };
}
