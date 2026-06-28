/**
 * features/setup/tool.ts — memory_setup tool.
 *
 * Lets the agent (or user) re-check yaoyao's configuration state on demand
 * and get a structured guide. Complements the automatic first-run prompt:
 * the prompt fires once, but this tool is always callable for a refresh.
 */
import { withErrorHandling } from "../../tools/common.js";
import { runInstallCheck } from "../../utils/install-check.js";
import { collectSetupInput, safeMemoryCount } from "./collector.js";
import { detectSetup } from "./detector.js";
import { renderSetupReport } from "./guide.js";
export function createSetupTool(deps) {
    return {
        id: "memory_setup",
        name: "memory_setup",
        label: "配置自检与引导",
        description: "🚀 检查 yaoyao-memory 的当前配置状态（运行模式、共存桥、向量搜索、数据量），" +
            "返回结构化的优化建议和安装向导路径。agent 可在首次使用或排查配置问题时调用。" +
            "首次对话会自动提示一次；本工具可随时复查。",
        parameters: {
            type: "object",
            properties: {
                refresh: {
                    type: "boolean",
                    default: false,
                    description: "true=忽略'已引导'标记，强制重新评估并再次提示（用于配置变更后）",
                },
            },
        },
        execute: withErrorHandling(async (_id, _params) => {
            // runInstallCheck is idempotent and cheap; safe to call per-invocation.
            const cap = runInstallCheck();
            const memoryCount = safeMemoryCount(deps.store);
            const input = collectSetupInput(deps.config, cap, deps.store.baseDir, memoryCount);
            const state = detectSetup(input);
            const report = renderSetupReport(state);
            return { content: [{ type: "text", text: report }] };
        }),
    };
}
