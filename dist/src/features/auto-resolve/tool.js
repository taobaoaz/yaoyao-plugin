import { withErrorHandling } from "../../tools/common.js";
import { resolveConflictPairs, autoResolveAll } from "../../utils/auto-resolver.js";
import { TABLES } from "../../storage/schema.js";
/**
 * Get a raw UnifiedDB handle from the DBBridge so we can run
 * INSERT/UPDATE in a transaction. The bridge surface today only
 * exposes a thin facade; the underlying handle is reachable via
 * getRawDb() (storage) but the tool receives a DBBridge, so we
 * fall back to a no-op path if it's not available.
 */
function getRawDb(db) {
    const anyDb = db;
    if (typeof anyDb.getRawDb === "function") {
        try {
            return anyDb.getRawDb();
        }
        catch {
            return null;
        }
    }
    return null;
}
export function createAutoResolveTool(db) {
    return {
        id: "memory_auto_resolve",
        name: "memory_auto_resolve",
        label: "Auto-resolve Memory Conflicts",
        description: "🪞 自动消解记忆冲突。基于（新鲜度 45% + 来源 30% + 访问 15% + 重要性 10%）给每对候选打分；胜者保留，败者在 meta.superseded_by 标记（不删）。视图 yaoyao_memories 已自动过滤。action=status 看现状；action=pair 消解指定 [a,b]；action=scan 批量扫描。",
        parameters: {
            type: "object",
            properties: {
                action: {
                    type: "string",
                    enum: ["status", "pair", "scan"],
                    description: "status: 概览；pair: 消解指定 [a,b]（参数 a, b）；scan: 全表扫描",
                    default: "status",
                },
                a: { type: "number", description: "（pair 模式）冲突对的第一个 id" },
                b: { type: "number", description: "（pair 模式）冲突对的第二个 id" },
                maxRows: { type: "number", description: "（scan 模式）扫描行数上限，默认 5000", default: 5000 },
                minScoreGap: { type: "number", description: "（scan 模式）分数差阈值，低于此视为平局，默认 0.05", default: 0.05 },
            },
            required: ["action"],
        },
        execute: withErrorHandling(async (_id, params) => {
            const action = String(params.action ?? "status");
            const raw = getRawDb(db);
            if (action === "status") {
                return { content: [{ type: "text", text: formatStatus(raw) }] };
            }
            if (!raw) {
                return { content: [{ type: "text", text: "❌ 内部错误: 无法访问底层 DB 句柄" }] };
            }
            if (action === "pair") {
                const a = Number(params.a);
                const b = Number(params.b);
                if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0 || a === b) {
                    return { content: [{ type: "text", text: "❌ 请提供有效的 a 和 b（均为正整数且 a ≠ b）" }] };
                }
                const res = resolveConflictPairs(raw, [[a, b]]);
                return { content: [{ type: "text", text: formatResult("pair", res) }] };
            }
            if (action === "scan") {
                const maxRows = Math.min(Math.max(Number(params.maxRows ?? 5000), 100), 50_000);
                const minScoreGap = Math.max(0, Math.min(Number(params.minScoreGap ?? 0.05), 0.5));
                const res = autoResolveAll(raw, { maxRows, minScoreGap });
                return { content: [{ type: "text", text: formatResult("scan", res) }] };
            }
            return { content: [{ type: "text", text: "❌ 未知 action。支持：status, pair, scan" }] };
        }),
    };
}
function formatStatus(raw) {
    const lines = ["📊 **自动消解状态**", ""];
    if (!raw) {
        lines.push("⚠️ 无法直接读 DB，以下数字可能为 0");
        return lines.join("\n");
    }
    try {
        const totalRow = raw.prepare(`SELECT COUNT(*) AS c FROM ${TABLES.meta}`).get();
        const supRow = raw.prepare(`SELECT COUNT(*) AS c FROM ${TABLES.meta} WHERE json_extract(meta, '$.superseded_by') IS NOT NULL`).get();
        const last = raw.prepare(`SELECT id, meta FROM ${TABLES.meta} WHERE json_extract(meta, '$.supersededAt') IS NOT NULL ORDER BY id DESC LIMIT 3`).all();
        const total = totalRow?.c ?? 0;
        const sup = supRow?.c ?? 0;
        const pct = total > 0 ? ((sup / total) * 100).toFixed(1) : "0.0";
        lines.push(`总记忆数: ${total}`);
        lines.push(`已 superseded: ${sup} (${pct}%)`);
        lines.push("");
        if (last.length > 0) {
            lines.push("最近 3 次消解:");
            for (const r of last) {
                try {
                    const m = JSON.parse(r.meta);
                    const sAt = Array.isArray(m.supersededAt) ? m.supersededAt.slice(-1)[0] : null;
                    const sb = typeof m.superseded_by === "number" ? m.superseded_by : null;
                    lines.push(`  · #${r.id} → superseded_by=${sb ?? "?"} @ ${sAt ? new Date(sAt).toISOString() : "?"}`);
                }
                catch { /* skip */ }
            }
        }
        else {
            lines.push("尚无消解记录");
        }
    }
    catch (err) {
        lines.push("❌ 读 DB 失败: " + (err instanceof Error ? err.message : String(err)));
    }
    return lines.join("\n");
}
function formatResult(action, res) {
    const lines = [
        `✅ **auto-resolve (${action}) 完成**`,
        "",
        `- 候选 pairs: ${res.consideredPairs}`,
        `- 已消解: ${res.resolvedPairs}`,
        `- 跳过（无变更 / 平局 / 已 superseded）: ${res.skippedPairs}`,
        "",
    ];
    if (res.actions.length > 0) {
        lines.push("**执行明细 (最多 20 条):**", "");
        for (const a of res.actions.slice(0, 20)) {
            lines.push(`  · #${a.loserId} → superseded_by=#${a.winnerId} (gap=${a.scoreGap.toFixed(3)}, ${a.reason})`);
        }
        if (res.actions.length > 20)
            lines.push(`  ...还有 ${res.actions.length - 20} 条`);
    }
    return lines.join("\n");
}
