/**
 * features/multimodal/tool.ts — memory_multimodal tool (v1.8.x hidden feature).
 *
 * Action surface: save / get / list / search / link / delete.
 * Only registered when config.multimodal.enabled === true.
 */
import nodePath from "node:path";
import os from "node:os";
import { withErrorHandling, type ToolRegistration } from "../../tools/common.ts";
import { MultimodalProcessor } from "./processor.ts";
import type { Modality, SourceType } from "./types.ts";

const VALID_ACTIONS = ["save", "get", "list", "search", "link", "delete"] as const;
type Action = typeof VALID_ACTIONS[number];

export interface MultimodalToolConfig {
  storageDir?: string;
  maxFileSizeMb?: number;
}

export function createMultimodalTool(cfg: MultimodalToolConfig): ToolRegistration {
  const rootDir = cfg.storageDir || nodePath.join(os.homedir(), ".openclaw", "workspace", "memory", "multimodal");
  const maxMb = cfg.maxFileSizeMb || 50;
  const processor = new MultimodalProcessor(rootDir);

  return {
    id: "memory_multimodal",
    name: "memory_multimodal",
    label: "Multimodal Memory (hidden)",
    description:
      "多模态记忆（hidden feature，默认关闭）。支持 image / audio / video 三种模态。" +
      "动作: save / get / list / search / link / delete。sourceType 支持 url / path / base64。" +
      "注意: 此工具仅在 config.multimodal.enabled=true 时注册。",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: VALID_ACTIONS as unknown as string[], default: "list" },
        id: { type: "string" },
        type: { type: "string", enum: ["image", "audio", "video"] },
        description: { type: "string" },
        sourceType: { type: "string", enum: ["url", "path", "base64"] },
        source: { type: "string" },
        mimeType: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        metadata: { type: "object" },
        extractedText: { type: "string" },
        memoryId: { type: "string" },
        limit: { type: "number" },
        offset: { type: "number" },
      },
      required: ["action"],
    },
    execute: withErrorHandling(async (_id: string, params: Record<string, unknown>) => {
      const action = String(params.action || "list") as Action;
      if (!VALID_ACTIONS.includes(action)) {
        return { content: [{ type: "text", text: "❌ 无效 action: " + action }] };
      }

      if (action === "save") {
        const type = String(params.type || "") as Modality;
        const description = String(params.description || "");
        const sourceType = String(params.sourceType || "") as SourceType;
        const source = String(params.source || "");
        if (!["image", "audio", "video"].includes(type)) {
          return { content: [{ type: "text", text: "❌ type 必须为 image / audio / video" }] };
        }
        if (!description) return { content: [{ type: "text", text: "❌ description 不能为空" }] };
        if (!["url", "path", "base64"].includes(sourceType)) {
          return { content: [{ type: "text", text: "❌ sourceType 必须为 url / path / base64" }] };
        }
        if (!source) return { content: [{ type: "text", text: "❌ source 不能为空" }] };
        const result = processor.save({
          type, description, sourceType, source,
          mimeType: params.mimeType ? String(params.mimeType) : undefined,
          tags: Array.isArray(params.tags) ? (params.tags as unknown[]).map(String) : undefined,
          metadata: (params.metadata && typeof params.metadata === "object") ? (params.metadata as Record<string, unknown>) : undefined,
          extractedText: params.extractedText ? String(params.extractedText) : undefined,
          id: params.id ? String(params.id) : undefined,
        }, maxMb);
        if (!result.ok || !result.entry) {
          return { content: [{ type: "text", text: "❌ 保存失败: " + (result.error || "未知错误") }] };
        }
        return { content: [{ type: "text", text: "✅ 已保存多模态记忆:\n" + processor.formatEntry(result.entry) }] };
      }

      if (action === "get") {
        const id = String(params.id || "");
        if (!id) return { content: [{ type: "text", text: "❌ id 必填" }] };
        const e = processor.get(id);
        if (!e) return { content: [{ type: "text", text: "❌ 未找到: " + id }] };
        return { content: [{ type: "text", text: processor.formatEntry(e) }] };
      }

      if (action === "list") {
        const type = params.type ? (String(params.type) as Modality) : undefined;
        const tags = Array.isArray(params.tags) ? (params.tags as unknown[]).map(String) : undefined;
        const limit = params.limit ? Number(params.limit) : 50;
        const offset = params.offset ? Number(params.offset) : 0;
        const r = processor.list({ type, tags, limit, offset });
        if (r.items.length === 0) return { content: [{ type: "text", text: "📭 没有匹配的多模态记忆（共 0 条）" }] };
        const lines = ["📚 多模态记忆列表 (共 " + r.total + " 条，显示 " + r.items.length + " 条):"];
        for (const e of r.items) lines.push(processor.formatEntry(e));
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      if (action === "search") {
        const query = String(params.description || params.query || "");
        if (!query) return { content: [{ type: "text", text: "❌ description (查询) 必填" }] };
        const type = params.type ? (String(params.type) as Modality) : undefined;
        const limit = params.limit ? Number(params.limit) : 10;
        const r = processor.search(query, { type, limit });
        if (r.length === 0) return { content: [{ type: "text", text: `🔍 没有匹配 "${query}" 的多模态记忆` }] };
        const lines = [`🔍 多模态搜索结果 ("${query}", ${r.length} 条):`];
        for (const e of r) lines.push(processor.formatEntry(e, e.snippet));
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      if (action === "link") {
        const id = String(params.id || "");
        const memoryId = String(params.memoryId || "");
        if (!id || !memoryId) return { content: [{ type: "text", text: "❌ id 和 memoryId 都必填" }] };
        const ok = processor.link(id, memoryId);
        return { content: [{ type: "text", text: ok ? "🔗 已关联 " + id + " → " + memoryId : "❌ 关联失败: 多模态记忆不存在" }] };
      }

      if (action === "delete") {
        const id = String(params.id || "");
        if (!id) return { content: [{ type: "text", text: "❌ id 必填" }] };
        const ok = processor.delete(id);
        return { content: [{ type: "text", text: ok ? "🗑️  已删除 " + id : "❌ 删除失败: 多模态记忆不存在" }] };
      }

      return { content: [{ type: "text", text: "❌ 未实现的 action: " + action }] };
    }),
  };
}
