/**
 * core/graph/graph.ts — Pure graph building algorithm.
 *
 * Types and formatter live in sibling modules.
 */
import type {
  GraphNode, GraphEdge, GraphResult, SceneData, GraphWeights,
} from "./types.ts";
import { createNodeMutator, createEdgeMutator } from "./mutators.ts";

export function buildGraph(
  query: string,
  initialResults: Array<: unknown { filename: string; snippet: string; score: number }>,
  scenes: Map<string, SceneData>,
  tags: Map<string, number[]>,
  memFilenameMap: Map<string, number>,
  weights: GraphWeights,
): GraphResult {
  if (typeof query !== "string") throw new TypeError("buildGraph: query must be a string");
  if (!Array.isArray(initialResults)) throw new TypeError("buildGraph: initialResults must be an array");
  if (!(scenes instanceof Map)) throw new TypeError("buildGraph: scenes must be a Map");
  if (!(tags instanceof Map)) throw new TypeError("buildGraph: tags must be a Map");
  if (!(memFilenameMap instanceof Map)) throw new TypeError("buildGraph: memFilenameMap must be a Map");
  if (!weights || typeof weights !== "object") throw new TypeError("buildGraph: weights must be an object");

  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const nodeOrder: string[] = [];

  const addNode = createNodeMutator(nodes, nodeOrder);
  const addEdge = createEdgeMutator(edges);
  const w = weights;

  // Step 1: Initial nodes from FTS5
  const initialSeen = new Set<string>();
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

  const idToFilename = new Map<number, string>();
  for (const [fname, id] of memFilenameMap) {
    idToFilename.set(id, fname);
  }
  const initialMemIds: number[] = [];
  for (const f of initialSeen) {
    const id = memFilenameMap.get(f);
    if (id !== undefined) initialMemIds.push(id);
  }

  // Step 2: Tag associations
  const memTagSet = new Set<number>(initialMemIds);
  for (const [tag, memIds] of tags) {
    const taggedMems = memIds.filter(id => memTagSet.has(id));
    if (taggedMems.length === 0) continue;

    const tagNodeId = `tag:${tag}`;
    addNode(tagNodeId, {
      id: tagNodeId, label: `#${tag}`, type: "tag",
      snippet: `标签 "${tag}" 关联 ${memIds.length} 条记忆`,
      score: w.tagNode, degree: 0, date: "",
    });

    for (const mid of memIds) {
      const memFname = idToFilename.get(mid);
      if (!memFname) continue;
      const memNodeId = `mem:${memFname}`;
      addEdge(tagNodeId, memNodeId, "同标签", w.tagEdge, `共同标签: ${tag}`);
      addNode(memNodeId, {
        id: memNodeId, label: memFname, type: "memory",
        snippet: "(关联: 标签)", score: w.orphanNode, degree: 0,
        date: memFname.replace(".md", ""),
      });
    }
  }

  // Step 3: Scene associations
  for (const [sceneName, sceneData] of scenes) {
    const matchedMems = sceneData.memories.filter(m => initialSeen.has(m));
    if (matchedMems.length === 0) continue;

    const sceneNodeId = `scene:${sceneName}`;
    addNode(sceneNodeId, {
      id: sceneNodeId, label: sceneName, type: "scene",
      snippet: `场景包含 ${sceneData.memories.length} 条记忆`,
      score: w.sceneNode, degree: 0, date: "",
    });

    for (const otherMem of sceneData.memories) {
      const memNodeId = `mem:${otherMem}`;
      addEdge(sceneNodeId, memNodeId, "同场景", w.sceneEdge, `场景: ${sceneName}`);
      addNode(memNodeId, {
        id: memNodeId, label: otherMem, type: "memory",
        snippet: "(关联: 场景)", score: w.unseenNode, degree: 0,
        date: otherMem.replace(".md", ""),
      });
    }

    const sceneMems = sceneData.memories.filter(m => nodes.has(`mem:${m}`));
    for (let i = 0; i < sceneMems.length; i++) {
      for (let j = i + 1; j < sceneMems.length; j++) {
        addEdge(`mem:${sceneMems[i]}`, `mem:${sceneMems[j]}`, "同场景内", w.sceneInner, `均在场景: ${sceneName}`);
      }
    }
  }

  // Step 4: Date associations
  const dateBuckets = new Map<string, string[]>();
  for (const nodeId of nodeOrder) {
    const node = nodes.get(nodeId)!;
    if (node.type !== "memory") continue;
    const date = node.date;
    if (!date) continue;
    if (!dateBuckets.has(date)) dateBuckets.set(date, []);
    dateBuckets.get(date)!.push(nodeId);
  }
  for (const [, memIds] of dateBuckets) {
    if (memIds.length < 2) continue;
    for (let i = 0; i < memIds.length; i++) {
      for (let j = i + 1; j < memIds.length; j++) {
        addEdge(memIds[i], memIds[j], "同日期", w.dateEdge, "发生在同一天");
      }
    }
  }

  // Compute degrees
  for (const [, edge] of edges) {
    const src = nodes.get(edge.source);
    const tgt = nodes.get(edge.target);
    if (src) src.degree++;
    if (tgt) tgt.degree++;
  }

  const nodeLimit = Math.min(w.nodeLimitMax, Math.floor(initialSeen.size * w.nodeLimitMul));
  const edgeLimit = Math.min(w.edgeLimitMax, Math.floor(initialSeen.size * w.edgeLimitMul));
  const nodeList = [...nodes.values()].sort((a, b) => b.degree - a.degree).slice(0, nodeLimit);
  const edgeList = [...edges.values()].sort((a, b) => b.weight - a.weight).slice(0, edgeLimit);

  const degreeSum = nodeList.reduce((s, n) => s + n.degree, 0);
  const maxDegree = Math.max(...nodeList.map(n => n.degree));
  const avgDegree = nodes.size > 0 ? degreeSum / nodes.size : 0;

  // Clustering coefficient
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

// Re-exports for backward compatibility
export * from "./types.ts";
export { formatGraph } from "./formatter.ts";
