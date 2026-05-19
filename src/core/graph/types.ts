/**
 * core/graph/types.ts — Graph type definitions.
 */

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

export interface SceneData {
  name: string;
  memories: string[];
}

export interface GraphWeights {
  tagNode: number;
  tagEdge: number;
  sceneNode: number;
  sceneEdge: number;
  sceneInner: number;
  dateEdge: number;
  orphanNode: number;
  unseenNode: number;
  nodeLimitMul: number;
  edgeLimitMul: number;
  nodeLimitMax: number;
  edgeLimitMax: number;
}
