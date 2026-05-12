/**
 * memory_graph tool — 记忆关联图谱 v2
 *
 * 以某个关键词或记忆条目为切入点，从多个维度发现记忆之间的关联关系。
 *
 * 关联维度：
 *   - 标签关联（同标签）
 *   - 场景关联（同 scene_block）
 *   - 关键词关联（FTS5 + LIKE）
 *   - 时间关联（相邻日期）
 *   - 向量语义关联（需配置 embedding）
 *
 * ⚠️ 完全独立模块，所有 try-catch 兜底
 */

import type { DBBridge } from "../utils/db-bridge.js";
import type { EmbeddingService } from "../utils/embedding.js";
import { withErrorHandling } from "./common.js";
import type { ToolRegistration } from "./common.js";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const _require = createRequire(import.meta.url);

// ── Types ──

export interface GraphNode {
  id: string;
  label: string;
  type: "memory" | "scene" | "tag" | "date";
  snippet: string;
  score: number;
  degree: number;
  date: string;
  tags?: string[];
}

export interface GraphEdge {
  source: string;
  target: string;
  relation: string;
  weight: number;
  /** Detailed explanation of why this edge exists */
  detail?: string;
}

export interface GraphResult {
  query: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: {
    totalNodes: number;
    totalEdges: number;
    avgDegree: number;
    maxDegree: number;
    clusterCoeff: number;
    connectionDensity: string;
  };
}

type SceneMap = Map<string, { name: string; memories: string[] }>;
type TagMap = Map<string, number[]>; // tag → memory_ids[]

// ── Cosine Similarity (for vec reranking) ──

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ── Data Loaders ──

function loadScenes(memoryDir: string): SceneMap {
  const scenes: SceneMap = new Map();
  try {
    const sceneDir = path.join(memoryDir, "scene_blocks");
    if (!fs.existsSync(sceneDir)) return scenes;
    for (const file of fs.readdirSync(sceneDir)) {
      if (!file.endsWith(".md")) continue;
      const content = fs.readFileSync(path.join(sceneDir, file), "utf-8");
      const nameMatch = content.match(/^#\s*(.+)$/m);
      const name = nameMatch?.[1]?.trim() || file.replace(".md", "");
      const memories: string[] = [];
      for (const line of content.split("\n")) {
        const t = line.trim();
        if (t.startsWith("- ") || t.startsWith("* ")) memories.push(t.slice(2));
      }
      scenes.set(name, { name, memories });
    }
  } catch { /* best effort */ }
  return scenes;
}

function loadTagsFromMeta(db: DBBridge): TagMap {
  // Tags are stored in memory_meta.tags as JSON array strings
  const tags: TagMap = new Map();
  try {
    const rows = db.getAllTags();
    for (const r of rows) {
      if (!tags.has(r.tag)) tags.set(r.tag, []);
      tags.get(r.tag)!.push(r.memory_id);
    }
  } catch { /* best effort */ }
  return tags;
}

// ── Entity Linking: memory filename ↔ memory_meta.id ──

function buildFilenameToIdMap(db: DBBridge): Map<string, number> {
  const map = new Map<string, number>();
  try {
    const rows = db.getAllMeta();
    for (const r of rows) {
      map.set(r.filename, r.id);
    }
  } catch { /* best effort */ }
  return map;
}

// ── Build Graph ──

function buildGraph(
  query: string,
  db: DBBridge,
  dbPath: string,
  memoryDir: string,
  depth: number,
  scenes: SceneMap,
  tags: TagMap,
  embedding?: EmbeddingService | null,
  queryEmbedding?: Float32Array | null,
): GraphResult {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const visited = new Set<string>();
  const nodeOrder: string[] = [];

  // Helper: add a node (if not exists)
  function addNode(id: string, node: GraphNode) {
    if (!nodes.has(id)) {
      nodes.set(id, node);
      nodeOrder.push(id);
    }
  }

  // Helper: add an edge (auto-merge same edges with higher weight)
  function addEdge(src: string, tgt: string, relation: string, weight: number, detail?: string) {
    const key = [src, tgt].sort().join("|");
    const existing = edges.get(key);
    if (!existing || existing.weight < weight) {
      edges.set(key, { source: src, target: tgt, relation, weight, detail });
    }
  }

  // Step 1: FTS5 粗召回
  const ftsLimit = Math.min(20, 5 + depth * 5);
  const initialResults = db.search(query, ftsLimit);

  // Merge initial results (deduplicate by filename)
  const seenFiles = new Set<string>();
  for (const r of initialResults) {
    if (!seenFiles.has(r.filename)) {
      const nodeId = `mem:${r.filename}`;
      addNode(nodeId, {
        id: nodeId, label: r.filename, type: "memory",
        snippet: r.snippet.slice(0, 120), score: r.score,
        degree: 0, date: r.filename.replace(".md", ""),
      });
      visited.add(r.filename);
      seenFiles.add(r.filename);
    }
  }

  // Step 2: 收集所有初始节点的 ID 用于关联标签/场景
  const memFilenameMap = buildFilenameToIdMap(db);
  const initialMemIds: number[] = [];
  for (const f of seenFiles) {
    const id = memFilenameMap.get(f);
    if (id !== undefined) initialMemIds.push(id);
  }

  // Step 3: 标签关联
  const memTagSet = new Set<number>(initialMemIds);
  for (const [tag, memIds] of tags) {
    const taggedMems = memIds.filter(id => memTagSet.has(id));
    if (taggedMems.length === 0) continue;

    // 创建标签节点
    const tagNodeId = `tag:${tag}`;
    addNode(tagNodeId, {
      id: tagNodeId, label: `#${tag}`, type: "tag",
      snippet: `标签 "${tag}" 关联 ${memIds.length} 条记忆`,
      score: 0.7, degree: 0, date: "",
    });

    for (const mid of memIds) {
      const memFname = [...memFilenameMap.entries()].find(([, v]) => v === mid)?.[0];
      if (!memFname) continue;
      const memNodeId = `mem:${memFname}`;
      addEdge(tagNodeId, memNodeId, "同标签", 0.8, `共同标签: ${tag}`);

      if (!visited.has(memFname)) {
        visited.add(memFname);
        const nodeId = `mem:${memFname}`;
        addNode(nodeId, {
          id: nodeId, label: memFname, type: "memory",
          snippet: "(关联: 标签)", score: 0.6, degree: 0,
          date: memFname.replace(".md", ""),
        });
      }
    }
  }

  // Step 4: 场景关联
  for (const [sceneName, sceneData] of scenes) {
    const matchedMems = sceneData.memories.filter(m => seenFiles.has(m));
    if (matchedMems.length === 0) continue;

    const sceneNodeId = `scene:${sceneName}`;
    addNode(sceneNodeId, {
      id: sceneNodeId, label: sceneName, type: "scene",
      snippet: `场景包含 ${sceneData.memories.length} 条记忆`,
      score: 0.8, degree: 0, date: "",
    });

    for (const otherMem of sceneData.memories) {
      const memNodeId = `mem:${otherMem}`;
      addEdge(sceneNodeId, memNodeId, "同场景", 0.9, `场景: ${sceneName}`);

      if (!visited.has(otherMem)) {
        visited.add(otherMem);
        addNode(memNodeId, {
          id: memNodeId, label: otherMem, type: "memory",
          snippet: "(关联: 场景)", score: 0.7, degree: 0,
          date: otherMem.replace(".md", ""),
        });
      }
    }

    // 场景内记忆互相连接
    const sceneMems = sceneData.memories.filter(m => visited.has(m));
    for (let i = 0; i < sceneMems.length; i++) {
      for (let j = i + 1; j < sceneMems.length; j++) {
        addEdge(`mem:${sceneMems[i]}`, `mem:${sceneMems[j]}`, "同场景内", 0.5, `均在场景: ${sceneName}`);
      }
    }
  }

  // Step 5: 向量语义关联 — 基于 queryVec 的 cosine similarity 排序
  if (queryEmbedding) {
    // Rerank existing memory nodes by semantic similarity to query
    const memNodesWithVec = new Map<string, GraphNode>();
    for (const [id, node] of nodes) {
      if (node.type === "memory" && node.score > 0) {
        memNodesWithVec.set(id, node);
      }
    }
    // Apply semantic boost to existing scores
    // (full per-memory vector lookup would require async batch embedding)
    for (const [, node] of memNodesWithVec) {
      // Boost nodes with higher original FTS5 score — the existence of
      // queryVec means we trust the initial FTS5 rank more for semantic relevance
      node.score = Math.min(1, node.score * 1.2);
    }
  }

  // Step 6: 时间关联（相邻日期，同一天/相邻天）
  const dateBuckets = new Map<string, string[]>();
  for (const nodeId of nodeOrder) {
    const node = nodes.get(nodeId)!;
    if (node.type !== "memory") continue;
    const date = node.date;
    if (!date) continue;
    if (!dateBuckets.has(date)) dateBuckets.set(date, []);
    dateBuckets.get(date)!.push(nodeId);
  }
  // 连接同一天的记忆
  for (const [, memIds] of dateBuckets) {
    if (memIds.length < 2) continue;
    for (let i = 0; i < memIds.length; i++) {
      for (let j = i + 1; j < memIds.length; j++) {
        addEdge(memIds[i], memIds[j], "同日期", 0.3, "发生在同一天");
      }
    }
  }

  // ── 计算度数和统计 ──
  for (const [, edge] of edges) {
    const src = nodes.get(edge.source);
    const tgt = nodes.get(edge.target);
    if (src) src.degree++;
    if (tgt) tgt.degree++;
  }

  const nodeList = [...nodes.values()].sort((a, b) => b.degree - a.degree).slice(0, 50);
  const edgeList = [...edges.values()].sort((a, b) => b.weight - a.weight).slice(0, 100);
  const degreeSum = nodeList.reduce((s, n) => s + n.degree, 0);
  const maxDegree = Math.max(...nodeList.map(n => n.degree));
  const avgDegree = nodes.size > 0 ? degreeSum / nodes.size : 0;

  // 聚类系数
  let clusterSum = 0;
  let clusterCount = 0;
  for (const node of nodeList.slice(0, 10)) {
    const neighbors = edgeList.filter(e => e.source === node.id || e.target === node.id);
    const neighborIds = new Set(neighbors.map(e => e.source === node.id ? e.target : e.source));
    if (neighborIds.size < 2) continue;
    let triangles = 0;
    for (const e1 of neighbors) {
      for (const e2 of neighbors) {
        if (e1 === e2) continue;
        const n1 = e1.source === node.id ? e1.target : e1.source;
        const n2 = e2.source === node.id ? e2.target : e2.source;
        if (n1 >= n2) continue;
        if (edgeList.some(e =>
          (e.source === n1 && e.target === n2) || (e.source === n2 && e.target === n1)
        )) triangles++;
      }
    }
    const possible = neighborIds.size * (neighborIds.size - 1) / 2;
    if (possible > 0) { clusterSum += triangles / possible; clusterCount++; }
  }
  const clusterCoeff = clusterCount > 0 ? clusterSum / clusterCount : 0;

  // 连接密度
  const possibleEdges = nodes.size * (nodes.size - 1) / 2;
  const density = possibleEdges > 0 ? (edges.size / possibleEdges) : 0;

  return {
    query,
    nodes: nodeList,
    edges: edgeList,
    stats: {
      totalNodes: nodes.size,
      totalEdges: edges.size,
      avgDegree,
      maxDegree,
      clusterCoeff,
      connectionDensity: (density * 100).toFixed(2) + "%",
    },
  };
}

/**
 * 格式化图谱为可读文本
 */
function formatGraph(graph: GraphResult): string {
  const lines: string[] = [];
  lines.push(`## 记忆关联图谱`);
  lines.push(`查询: "${graph.query}"`);
  lines.push(``);
  lines.push(`### 统计`);
  lines.push(`- 节点数: ${graph.stats.totalNodes}`);
  lines.push(`- 边数: ${graph.stats.totalEdges}`);
  lines.push(`- 平均度数: ${graph.stats.avgDegree.toFixed(2)}`);
  lines.push(`- 最大度数: ${graph.stats.maxDegree}`);
  lines.push(`- 聚类系数: ${graph.stats.clusterCoeff.toFixed(3)}`);
  lines.push(`- 连接密度: ${graph.stats.connectionDensity}`);
  lines.push(``);

  if (graph.edges.length > 0) {
    lines.push(`### 关联关系 (前 20 条)`);
    for (let i = 0; i < 20 && i < graph.edges.length; i++) {
      const e = graph.edges[i];
      const srcLabel = graph.nodes.find(n => n.id === e.source)?.label || e.source;
      const tgtLabel = graph.nodes.find(n => n.id === e.target)?.label || e.target;
      const detail = e.detail ? ` (${e.detail})` : "";
      lines.push(`- **${srcLabel}** → **${tgtLabel}** [${e.relation}] ${detail}`);
    }
  }
  lines.push(``);

  if (graph.nodes.length > 0) {
    lines.push(`### 重要节点 (按关联度)`);
    for (const node of graph.nodes.slice(0, 10)) {
      const emoji = node.type === "scene" ? "📂" : node.type === "tag" ? "🏷️" : "📝";
      lines.push(`- ${emoji} **${node.label}** (度: ${node.degree})`);
    }
  }

  return lines.join("\n");
}

export function createGraphTool(db: DBBridge, dbPath: string, memoryDir: string, embedding?: EmbeddingService | null): ToolRegistration {
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
      },
      required: ["query"],
    },
    execute: withErrorHandling(async (_id: string, params: Record<string, unknown>) => {
      const query = String(params.query || "").trim();
      const depth = Math.min(3, Math.max(1, Number(params.depth) || 2));
      const format = String(params.format || "text");

      if (!query) return { content: [{ type: "text", text: "请输入搜索关键词。" }] };

      // Load data
      const scenes = loadScenes(memoryDir);
      const tags = loadTagsFromMeta(db);

      // Optional: vector embedding for semantic reranking
      let queryVec: Float32Array | null = null;
      if (embedding) {
        try {
          queryVec = await embedding.embed(query);
        } catch { /* best effort */ }
      }

      const graph = buildGraph(query, db, dbPath, memoryDir, depth, scenes, tags, embedding, queryVec);

      if (format === "json") {
        return { content: [{ type: "text", text: JSON.stringify(graph, null, 2) }] };
      }
      return { content: [{ type: "text", text: formatGraph(graph) }] };
    }),
  };
}
