/**
 * core/graph/types.ts — Graph types (unified: old scene graph + new memory relations).
 */

// === Legacy scene graph types ===
export interface GraphNode {
  id: string;
  label: string;
  type: "memory" | "tag" | "scene";
  snippet: string;
  score: number;
  degree: number;
  date: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  label: string;
  weight: number;
  tooltip: string;
}

export interface GraphResult {
  query: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: GraphStats;
}

export interface GraphStats {
  totalNodes: number;
  totalEdges: number;
  avgDegree: number;
  maxDegree: number;
  clusterCoeff: number;
  connectionDensity: string;
}

export interface SceneData {
  memories: string[];
}

export interface GraphWeights {
  tagNode: number; tagEdge: number;
  sceneNode: number; sceneEdge: number; sceneInner: number;
  orphanNode: number; unseenNode: number;
  dateEdge: number;
  nodeLimitMul: number; nodeLimitMax: number;
  edgeLimitMul: number; edgeLimitMax: number;
}

// === New memory relation types ===
export type RelationType = "supersedes" | "related" | "causes" | "part_of";

export interface MemoryRelation {
  id: string;
  sourceId: string;
  targetId: string;
  type: RelationType;
  strength: number;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

export interface GraphSearchResult {
  memoryId: string;
  path: MemoryRelation[];
  depth: number;
  accumulatedStrength: number;
}
