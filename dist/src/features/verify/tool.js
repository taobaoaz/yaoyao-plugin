import { withErrorHandling } from "../../tools/common.js";
import { scoreEvidence, detectSpeculative } from "../../core/verify/verify.js";
export function createVerifyTool(db) {
    return {
        name: "memory_verify",
        label: "Memory Verify",
        description: "🔍 防幻觉验证 — 核实一个说法是否与存储的记忆一致。" +
            "输入一个待验证的陈述，工具会在所有历史记忆中搜索证据，" +
            "返回：confirmed(确认) / partial(部分支持) / unconfirmed(无证据) / contradicted(矛盾)。",
        parameters: {
            type: "object",
            properties: {
                claim: {
                    type: "string",
                    description: "待验证的说法或陈述（例如：'用户上周提到在用 Next.js'）",
                },
            },
            required: ["claim"],
        },
        execute: withErrorHandling(async (_id, params) => {
            const claim = String(params.claim ?? "").trim();
            if (!claim) {
                return { content: [{ type: "text", text: "❌ 请提供待验证的说法（claim 参数）。" }] };
            }
            const specCheck = detectSpeculative(claim);
            let results = [];
            try {
                results = db.search(claim, 20);
            }
            catch (e) {
                return {
                    content: [{
                            type: "text",
                            text: `⚠️ 搜索记忆时出错：${e instanceof Error ? e.message : String(e)}`,
                        }],
                };
            }
            const verdict = scoreEvidence(claim, results);
            const emojiMap = {
                confirmed: "✅",
                partial: "🟡",
                unconfirmed: "❓",
                contradicted: "⚠️",
            };
            const emoji = emojiMap[verdict.verdict] ?? "❓";
            let text = `${emoji} **${verdict.verdict.toUpperCase()}**（置信度 ${(verdict.confidence * 100).toFixed(0)}%）\n\n`;
            text += `**说法**：${claim}\n\n`;
            text += `**理由**：${verdict.reasoning}\n`;
            if (specCheck.isSpeculative) {
                text += `\n⚠️ **注意**：该说法本身含有推测性措辞（${specCheck.markers.join(", ")}），`;
                text += `即使记忆中有支持，也可能是 AI 的自我强化幻觉。建议要求提供具体出处。\n`;
            }
            if (verdict.evidence.length > 0) {
                text += `\n**相关记忆**：\n`;
                for (const ev of verdict.evidence) {
                    text += `- 【${ev.filename}】(重叠 ${(ev.overlap * 100).toFixed(0)}%)\n  ${ev.snippet.slice(0, 200).replace(/\n/g, " ")}\n\n`;
                }
            }
            return { content: [{ type: "text", text }] };
        }),
    };
}
