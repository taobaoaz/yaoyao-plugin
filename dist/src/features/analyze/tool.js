/**
 * features/analyze/tool.ts — memory_analyze tool (modular).
 *
 * Placeholder: sentiment / mood analysis has been moved to yaoyao-soul plugin.
 * This file exists to prevent import errors if the tool registry attempts to load it.
 */
import { withErrorHandling } from "../../tools/common.js";
export function createAnalyzeTool() {
    return {
        id: "memory_analyze",
        name: "memory_analyze",
        label: "Memory Analyze",
        description: "📊 情绪与画像分析功能已迁移至 yaoyao-soul 插件。如需使用，请安装 yaoyao-soul。",
        parameters: {
            type: "object",
            properties: {},
            required: [],
        },
        execute: withErrorHandling(async (_id, _params) => {
            return {
                content: [{
                        type: "text",
                        text: "⚠️ memory_analyze 已迁移至 yaoyao-soul 插件。\n\n如需情绪分析、画像生成等功能，请安装 yaoyao-soul：\ncd ~/.openclaw/plugins\ngit clone https://github.com/taobaoaz/yaoyao-soul.git",
                    }],
            };
        }),
    };
}
