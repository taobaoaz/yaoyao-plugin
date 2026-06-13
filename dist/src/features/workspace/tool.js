/**
 * features/workspace/tool.ts — memory_workspace tool (v1.8.0).
 *
 * Allows the agent to read and update workspace configuration files.
 */

import { withErrorHandling } from "../../tools/common.js";

const ALLOWED_FILES = ["MEMORY.md", "USER.md", "IDENTITY.md", "SOUL.md", "TOOLS.md"];

export function createWorkspaceTool(store) {
    return {
        id: "memory_workspace",
        name: "memory_workspace",
        label: "Workspace Files",
        description: "读取或更新 workspace 配置文件（MEMORY.md 长期精选记忆、USER.md 用户画像、IDENTITY.md 身份声明、SOUL.md 人格、TOOLS.md 工具笔记）。支持 get / append / write 三种操作。",
        parameters: {
            type: "object",
            properties: {
                action: {
                    type: "string",
                    enum: ["get", "append", "write"],
                    default: "get",
                    description: "get=读取文件内容, append=追加内容到文件末尾, write=覆盖文件内容",
                },
                file: {
                    type: "string",
                    enum: ALLOWED_FILES,
                    description: "目标文件名",
                },
                content: {
                    type: "string",
                    description: "要写入或追加的内容（action=get 时忽略）",
                },
            },
            required: ["action", "file"],
        },
        execute: withErrorHandling(async (_id, params) => {
            const action = String(params.action || "get");
            const file = String(params.file || "");
            const content = String(params.content || "");

            if (!ALLOWED_FILES.includes(file)) {
                return { content: [{ type: "text", text: `❌ 不支持的文件: ${file}。允许: ${ALLOWED_FILES.join(", ")}` }] };
            }

            if (action === "get") {
                const data = store.readWorkspaceFile(file);
                if (data === null) {
                    return { content: [{ type: "text", text: `📄 ${file} 不存在或为空。` }] };
                }
                const truncated = data.length > 8000 ? data.slice(0, 8000) + "\n\n... (截断，总长度 " + data.length + " 字符)" : data;
                return { content: [{ type: "text", text: `📄 **${file}**\n\n${truncated}` }] };
            }

            if (action === "append") {
                if (!content.trim()) {
                    return { content: [{ type: "text", text: `❌ 追加内容不能为空` }] };
                }
                const ok = store.appendToWorkspaceFile(file, content);
                return { content: [{ type: "text", text: ok ? `✅ 已追加到 ${file}` : `❌ 写入 ${file} 失败` }] };
            }

            if (action === "write") {
                if (!content.trim()) {
                    return { content: [{ type: "text", text: `❌ 写入内容不能为空` }] };
                }
                const ok = store.writeWorkspaceFile(file, content);
                return { content: [{ type: "text", text: ok ? `✅ 已更新 ${file}` : `❌ 写入 ${file} 失败` }] };
            }

            return { content: [{ type: "text", text: `❌ 未知操作: ${action}` }] };
        }),
    };
}