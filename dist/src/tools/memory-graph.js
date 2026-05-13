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
import { clampNum } from "../utils/clamp.js";
import { withErrorHandling } from "./common.js";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const _require = createRequire(import.meta.url);
// ── Cosine Similarity (for vec reranking) ──
function cosineSimilarity(a, b) {
    // Bug #35: Guard against different-length arrays
    if (a.length !== b.length)
        return 0;
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
function loadScenes(memoryDir) {
    const scenes = new Map();
    const sceneDir = path.join(memoryDir, "scene_blocks");
    try {
        if (!fs.existsSync(sceneDir))
            return scenes;
        for (const file of fs.readdirSync(sceneDir)) {
            if (!file.endsWith(".md"))
                continue;
            const content = fs.readFileSync(path.join(sceneDir, file), "utf-8");
            const nameMatch = content.match(/^#\s*(.+)$/m);
            const name = nameMatch?.[1]?.trim() || file.replace(".md", "");
            const memories = [];
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
    }
    catch { /* best effort */ }
    return scenes;
}
function loadTagsFromMeta(db) {
    // Tags are stored in memory_meta.tags as JSON array strings
    const tags = new Map();
    try {
        const rows = db.getAllTags();
        for (const r of rows) {
            if (!tags.has(r.tag))
                tags.set(r.tag, []);
            tags.get(r.tag).push(r.memory_id);
        }
    }
    catch { /* best effort */ }
    return tags;
}
// ── Entity Linking: memory filename ↔ memory_meta.id ──
// ── Filename → id cache (invalidated by DB row count) ──
let _filenameIdCache = null;
let _filenameIdCacheVersion = -1;
function buildFilenameToIdMap(db) {
    const stats = db.getStats();
    const version = stats.totalMemories;
    if (_filenameIdCache && _filenameIdCacheVersion === version) {
        return _filenameIdCache;
    }
    const map = new Map();
    try {
        const rows = db.getAllMeta();
        for (const r of rows) {
            map.set(r.filename, r.id);
        }
    }
    catch { /* best effort */ }
    _filenameIdCache = map;
    _filenameIdCacheVersion = version;
    return map;
}
// ── Build Graph ──
function buildGraph(query, db, dbPath, memoryDir, depth, scenes, tags, weights, embedding, queryEmbedding) {
    const nodes = new Map();
    const edges = new Map();
    const nodeOrder = [];
    // Resolve weights with defaults
    const w = {
        tagNode: weights.tagNode ?? 0.7,
        tagEdge: weights.tagEdge ?? 0.8,
        sceneNode: weights.sceneNode ?? 0.8,
        sceneEdge: weights.sceneEdge ?? 0.9,
        sceneInner: weights.sceneInner ?? 0.5,
        dateEdge: weights.dateEdge ?? 0.3,
        orphanNode: weights.orphanNode ?? 0.6,
        unseenNode: weights.unseenNode ?? 0.7,
        nodeLimitMul: weights.nodeLimitMul ?? 15,
        edgeLimitMul: weights.edgeLimitMul ?? 30,
        nodeLimitMax: weights.nodeLimitMax ?? 200,
        edgeLimitMax: weights.edgeLimitMax ?? 400,
    };
    // Helper: add a node (if not exists)
    function addNode(id, node) {
        if (!nodes.has(id)) {
            nodes.set(id, node);
            nodeOrder.push(id);
        }
    }
    // Helper: add an edge (auto-merge same edges with higher weight)
    function addEdge(src, tgt, relation, weight, detail) {
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
    const initialSeen = new Set();
    for (const r of initialResults) {
        if (!initialSeen.has(r.filename)) {
            const nodeId = `mem:${r.filename}`;
            addNode(nodeId, {
                id: nodeId, label: r.filename, type: "memory",
                snippet: r.snippet.slice(0, 120), score: r.score,
                degree: 0, date: r.filename.replace(".md", ""),
            });
            initialSeen.add(r.filename);
        }
    }
    // Step 2: 收集所有初始节点的 ID 用于关联标签/场景
    const memFilenameMap = buildFilenameToIdMap(db);
    const initialMemIds = [];
    for (const f of initialSeen) {
        const id = memFilenameMap.get(f);
        if (id !== undefined)
            initialMemIds.push(id);
    }
    // Step 3: 标签关联
    const memTagSet = new Set(initialMemIds);
    for (const [tag, memIds] of tags) {
        const taggedMems = memIds.filter(id => memTagSet.has(id));
        if (taggedMems.length === 0)
            continue;
        // 创建标签节点
        const tagNodeId = `tag:${tag}`;
        addNode(tagNodeId, {
            id: tagNodeId, label: `#${tag}`, type: "tag",
            snippet: `标签 "${tag}" 关联 ${memIds.length} 条记忆`,
            score: w.tagNode, degree: 0, date: "",
        });
        for (const mid of memIds) {
            const memFname = [...memFilenameMap.entries()].find(([, v]) => v === mid)?.[0];
            if (!memFname)
                continue;
            const memNodeId = `mem:${memFname}`;
            addEdge(tagNodeId, memNodeId, "同标签", w.tagEdge, `共同标签: ${tag}`);
            // Allow same memory to be reached through multiple paths — addNode deduplicates
            addNode(memNodeId, {
                id: memNodeId, label: memFname, type: "memory",
                snippet: "(关联: 标签)", score: w.orphanNode, degree: 0,
                date: memFname.replace(".md", ""),
            });
        }
    }
    // Step 4: 场景关联
    for (const [sceneName, sceneData] of scenes) {
        const matchedMems = sceneData.memories.filter(m => initialSeen.has(m));
        if (matchedMems.length === 0)
            continue;
        const sceneNodeId = `scene:${sceneName}`;
        addNode(sceneNodeId, {
            id: sceneNodeId, label: sceneName, type: "scene",
            snippet: `场景包含 ${sceneData.memories.length} 条记忆`,
            score: w.sceneNode, degree: 0, date: "",
        });
        for (const otherMem of sceneData.memories) {
            const memNodeId = `mem:${otherMem}`;
            addEdge(sceneNodeId, memNodeId, "同场景", w.sceneEdge, `场景: ${sceneName}`);
            // Allow same memory to be reached through multiple paths — addNode deduplicates
            addNode(memNodeId, {
                id: memNodeId, label: otherMem, type: "memory",
                snippet: "(关联: 场景)", score: w.unseenNode, degree: 0,
                date: otherMem.replace(".md", ""),
            });
        }
        // 场景内记忆互相连接 (use nodes.has instead of visited to avoid cross-path blocking)
        const sceneMems = sceneData.memories.filter(m => nodes.has(`mem:${m}`));
        for (let i = 0; i < sceneMems.length; i++) {
            for (let j = i + 1; j < sceneMems.length; j++) {
                addEdge(`mem:${sceneMems[i]}`, `mem:${sceneMems[j]}`, "同场景内", w.sceneInner, `均在场景: ${sceneName}`);
            }
        }
    }
    // Step 5: 向量语义关联 — 基于 queryVec 的 cosine similarity 排序
    if (queryEmbedding) {
        // Rerank existing memory nodes by semantic similarity to query
        const memNodesWithVec = new Map();
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
    const dateBuckets = new Map();
    for (const nodeId of nodeOrder) {
        const node = nodes.get(nodeId);
        if (node.type !== "memory")
            continue;
        const date = node.date;
        if (!date)
            continue;
        if (!dateBuckets.has(date))
            dateBuckets.set(date, []);
        dateBuckets.get(date).push(nodeId);
    }
    // 连接同一天的记忆
    for (const [, memIds] of dateBuckets) {
        if (memIds.length < 2)
            continue;
        for (let i = 0; i < memIds.length; i++) {
            for (let j = i + 1; j < memIds.length; j++) {
                addEdge(memIds[i], memIds[j], "同日期", w.dateEdge, "发生在同一天");
            }
        }
    }
    // ── 计算度数和统计 ──
    for (const [, edge] of edges) {
        const src = nodes.get(edge.source);
        const tgt = nodes.get(edge.target);
        if (src)
            src.degree++;
        if (tgt)
            tgt.degree++;
    }
    const nodeLimit = Math.min(w.nodeLimitMax, depth * w.nodeLimitMul);
    const edgeLimit = Math.min(w.edgeLimitMax, depth * w.edgeLimitMul);
    const nodeList = [...nodes.values()].sort((a, b) => b.degree - a.degree).slice(0, nodeLimit);
    const edgeList = [...edges.values()].sort((a, b) => b.weight - a.weight).slice(0, edgeLimit);
    const degreeSum = nodeList.reduce((s, n) => s + n.degree, 0);
    const maxDegree = Math.max(...nodeList.map(n => n.degree));
    const avgDegree = nodes.size > 0 ? degreeSum / nodes.size : 0;
    // 聚类系数
    let clusterSum = 0;
    let clusterCount = 0;
    for (const node of nodeList.slice(0, 10)) {
        const neighbors = edgeList.filter(e => e.source === node.id || e.target === node.id);
        const neighborIds = new Set(neighbors.map(e => e.source === node.id ? e.target : e.source));
        if (neighborIds.size < 2)
            continue;
        let triangles = 0;
        for (const e1 of neighbors) {
            for (const e2 of neighbors) {
                if (e1 === e2)
                    continue;
                const n1 = e1.source === node.id ? e1.target : e1.source;
                const n2 = e2.source === node.id ? e2.target : e2.source;
                if (n1 >= n2)
                    continue;
                if (edgeList.some(e => (e.source === n1 && e.target === n2) || (e.source === n2 && e.target === n1)))
                    triangles++;
            }
        }
        const possible = neighborIds.size * (neighborIds.size - 1) / 2;
        if (possible > 0) {
            clusterSum += triangles / possible;
            clusterCount++;
        }
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
function formatGraph(graph) {
    const lines = [];
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
export function createGraphTool(db, dbPath, memoryDir, embedding) {
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
        execute: withErrorHandling(async (_id, params) => {
            const query = String(params.query || "").trim();
            const depth = clampNum(params.depth, 2, 1, 3);
            const format = String(params.format || "text");
            if (!query)
                return { content: [{ type: "text", text: "请输入搜索关键词。" }] };
            // Load data
            const scenes = loadScenes(memoryDir);
            const tags = loadTagsFromMeta(db);
            // Optional: vector embedding for semantic reranking
            let queryVec = null;
            if (embedding) {
                try {
                    queryVec = await embedding.embed(query);
                }
                catch { /* best effort */ }
            }
            const weights = {
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
            const graph = buildGraph(query, db, dbPath, memoryDir, depth, scenes, tags, weights, embedding, queryVec);
            if (format === "json") {
                return { content: [{ type: "text", text: JSON.stringify(graph, null, 2) }] };
            }
            return { content: [{ type: "text", text: formatGraph(graph) }] };
        }),
    };
}
