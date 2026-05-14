/**
 * features/export/tool.ts — memory_export tool (modular).
 */
import { clampNum } from "../../utils/clamp.js";
import { withErrorHandling } from "../../tools/common.js";
import { queryForExport, formatJSONL } from "../../core/export/export.js";
export function createExportTool(dbBridge) {
    return {
        name: "memory_export",
        label: "Export Memories",
        description: "以 JSONL 格式导出记忆数据，支持按日期和关键词筛选。输出可跨设备导入。",
        parameters: {
            type: "object",
            properties: {
                limit: {
                    type: "number",
                    description: "最大导出条数（1-5000，默认 100）",
                    default: 100,
                },
                dateFrom: {
                    type: "string",
                    description: "起始日期（含），格式 YYYY-MM-DD",
                    default: "",
                },
                dateTo: {
                    type: "string",
                    description: "结束日期（含），格式 YYYY-MM-DD",
                    default: "",
                },
                keyword: {
                    type: "string",
                    description: "关键词过滤（可选，在 user_text 和 asst_text 中匹配）",
                    default: "",
                },
            },
        },
        execute: withErrorHandling(async (_id, params) => {
            const limit = clampNum(params.limit, 100, 1, 5000);
            const dateFrom = String(params.dateFrom || "").trim();
            const dateTo = String(params.dateTo || "").trim();
            const keyword = String(params.keyword || "").trim();
            const rows = queryForExport(dbBridge.getRawDb(), limit, dateFrom || undefined, dateTo || undefined, keyword || undefined);
            const jsonl = formatJSONL(rows);
            return {
                content: [{ type: "text", text: jsonl }],
            };
        }),
    };
}
