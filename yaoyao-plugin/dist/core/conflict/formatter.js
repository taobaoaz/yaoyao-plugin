import { suggestRelation, canAutoResolve } from "./relation.js";
export function formatConflictCandidates(candidates) {
    if (candidates.length === 0)
        return "";
    const lines = [
        "⚠️ **检测到潜在记忆冲突**",
        "",
        "以下记忆与当前保存内容存在相似或矛盾，请确认如何处理：",
        "",
    ];
    for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        const suggested = suggestRelation(c);
        const auto = canAutoResolve(c, suggested);
        lines.push(`**候选 ${i + 1}** [ID: ${c.memoryId}] — 置信度 ${(c.confidence * 100).toFixed(0)}%`, `- 时间: ${c.date}`, `- 内容: ${c.snippet.replace(/\n/g, " ")}`, `- 冲突信号: 文本相似 ${(c.signals.lexicalSimilarity * 100).toFixed(0)}% / ` +
            `语义重叠 ${(c.signals.semanticOverlap * 100).toFixed(0)}%` +
            (c.signals.hasContradictionMarkers ? " / ⚡含矛盾表述" : ""), `- 建议关系: **${suggested}**${auto ? " (可自动裁决)" : " (需用户确认)"}`, `- 判断依据: ${c.reason}`, "");
    }
    lines.push("💡 使用 memory_judge 工具进行裁决:", `  memory_judge(memoryId: <ID>, relation: "supersedes"|"conflicts_with"|"compatible"|"related"|"not_conflict", reason: "...")`);
    return lines.join("\n");
}
