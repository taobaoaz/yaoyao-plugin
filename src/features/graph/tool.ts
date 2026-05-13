/**
 * features/graph/tool.ts — memory_graph tool (modular).
 */

import { clampNum } from "../../utils/clamp.js";
import type { DBBridge } from "../../utils/db-bridge.js";
import type { EmbeddingService } from "../../utils/embedding.js";
import { withErrorHandling } from "../../tools/common.js";
import type { ToolRegistration } from "../../tools/common.js";
import fs from "node:fs";
import path from "node:path";
import { buildGraph, formatGraph, type GraphWeights } from "../../core/graph/graph.js";

function loadScenes(memoryDir: string): Map<string, { name: string; memories: string[] }> {
  const scenes = new Map<string, { name: string; memories: string[] }>();
  const sceneDir = path.join(memoryDir, "scene_blocks");
  try {
    if (!fs.existsSync(sceneDir)) return scenes;
    for (const file of fs.readdirSync(sceneDir)) {
      if (!file.endsWith(".md")) continue;
      const content = fs.readFileSync(path.join(sceneDir, file), "utf-8");
      const nameMatch = content.match(/^#\s*(.+)$/m);
      const name = nameMatch?.[1]?.trim() || file.replace(".md", "");
      const memories: string[] = [];
      for (const line of content.split("\n")) {
        const t = line.trim();
        if (t.startsWith("- ") || t.startsWith("* ")) {
          const raw = t.slice(2).trim();
          const normalized = raw.endsWith(".md") ? raw : `${raw}.md`;
          memories.push(normalized);
        }
      }
      scenes.set(name, { name, memories });
    }
  } catch { /* best effort */ }
  return scenes;
}

function loadTagsFromMeta(db: DBBridge): Map<string, number[]> {
  const tags = new Map<string, number[]>();
  try {
    const rows = db.getAllTags();
    for (const r of rows) {
      if (!tags.has(r.tag)) tags.set(r.tag, []);
      tags.get(r.tag)!.push(r.memory_id);
    }
  } catch { /* best effort */ }
  return tags;
}

let _filenameIdCache: Map<string, number> | null = null;
let _filenameIdCacheVersion = -1;

function buildFilenameToIdMap(db: DBBridge): Map<string, number> {
  const stats = db.getStats();
  const version = stats.totalMemories;
  if (_filenameIdCache && _filenameIdCacheVersion === version) {
    return _filenameIdCache;
  }
  const map = new Map<string, number>();
  try {
    const rows = db.getAllMeta();
    for (const r of rows) {
      map.set(r.filename, r.id);
    }
  } catch { /* best effort */ }
  _filenameIdCache = map;
  _filenameIdCacheVersion = version;
  return map;
}

export function createGraphTool(db: DBBridge, _dbPath: string, memoryDir: string, embedding?: EmbeddingService | null): ToolRegistration {
  return {
    name: "memory_graph",
    label: "Memory Graph (Knowledge)",
    description: "构建记忆关联图谱。以某个关键词或记忆条目为切入点，多维度发现关联 - 标签关联、场景关联、关键词关联、时间关联、向量语义关联（需配置embedding）。",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "切入点关键词，如'项目A'、'用户张三'、'2026-03-15'等",
        },
        depth: {
          type: "number",
          description: "关联深度（1-3），越大探索越广但也可能引入噪音",
          default: 2,
        },
        format: {
          type: "string",
          enum: ["text", "json"],
          description: "输出格式：text 返回可读描述，json 返回结构化数据",
          default: "text",
        },
        tagWeight: { type: "number", description: "标签节点权重（0-1，默认 0.7）", default: 0.7 },
        tagEdgeWeight: { type: "number", description: "标签边权重（0-1，默认 0.8）", default: 0.8 },
        sceneWeight: { type: "number", description: "场景节点权重（0-1，默认 0.8）", default: 0.8 },
        sceneEdgeWeight: { type: "number", description: "场景边权重（0-1，默认 0.9）", default: 0.9 },
        sceneInnerWeight: { type: "number", description: "场景内边权重（0-1，默认 0.5）", default: 0.5 },
        dateWeight: { type: "number", description: "日期边权重（0-1，默认 0.3）", default: 0.3 },
        orphanWeight: { type: "number", description: "孤立节点权重（0-1，默认 0.6）", default: 0.6 },
        unseenWeight: { type: "number", description: "未访问节点权重（0-1，默认 0.7）", default: 0.7 },
        nodeLimitMul: { type: "number", description: "节点数上限倍数（默认 15）", default: 15 },
        edgeLimitMul: { type: "number", description: "边数上限倍数（默认 30）", default: 30 },
        nodeLimitMax: { type: "number", description: "节点数绝对上限（默认 200）", default: 200 },
        edgeLimitMax: { type: "number", description: "边数绝对上限（默认 400）", default: 400 },
      },
      required: ["query"],
    },
    execute: withErrorHandling(async (_id: string, params: Record<string, unknown>) => {
      const query = String(params.query || "").trim();
      const depth = clampNum(params.depth, 2, 1, 3);
      const format = String(params.format || "text");

      if (!query) return { content: [{ type: "text", text: "请输入搜索关键词。" }] };

      const scenes = loadScenes(memoryDir);
      const tags = loadTagsFromMeta(db);

      let queryVec: Float32Array | null = null;
      if (embedding) {
        try {
          queryVec = await embedding.embed(query);
        } catch { /* best effort */ }
      }

      const weights: GraphWeights = {
        tagNode: clampNum(params.tagWeight, 0.7, 0, 1),
        tagEdge: clampNum(params.tagEdgeWeight, 0.8, 0, 1),
        sceneNode: clampNum(params.sceneWeight, 0.8, 0, 1),
        sceneEdge: clampNum(params.sceneEdgeWeight, 0.9, 0, 1),
        sceneInner: clampNum(params.sceneInnerWeight, 0.5, 0, 1),
        dateEdge: clampNum(params.dateWeight, 0.3, 0, 1),
        orphanNode: clampNum(params.orphanWeight, 0.6, 0, 1),
        unseenNode: clampNum(params.unseenWeight, 0.7, 0, 1),
        nodeLimitMul: clampNum(params.nodeLimitMul, 15, 1, 100),
        edgeLimitMul: clampNum(params.edgeLimitMul, 30, 1, 100),
        nodeLimitMax: clampNum(params.nodeLimitMax, 200, 1, 1000),
        edgeLimitMax: clampNum(params.edgeLimitMax, 400, 1, 2000),
      };

      const ftsLimit = Math.min(20, 5 + depth * 5);
      const initialResults = db.search(query, ftsLimit);
      const memFilenameMap = buildFilenameToIdMap(db);

      const graph = buildGraph(
        query,
        initialResults,
        scenes,
        tags,
        memFilenameMap,
        weights,
      );

      if (format === "json") {
        return { content: [{ type: "text", text: JSON.stringify(graph, null, 2) }] };
      }
      return { content: [{ type: "text", text: formatGraph(graph) }] };
    }),
  };
}
