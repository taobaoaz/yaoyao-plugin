/**
 * core/graph/mutators.ts — Graph mutation helpers.
 */
import type { GraphNode, GraphEdge } from "./types.ts";

export function createNodeMutator(nodes: Map<string, GraphNode>, nodeOrder: string[]) : unknown {
  return function addNode(id: string, node: GraphNode) {
    if (!nodes.has(id)) {
      nodes.set(id, node);
      nodeOrder.push(id);
    }
  };
}

export function createEdgeMutator(edges: Map<string, GraphEdge>) : unknown {
  return function addEdge(src: string, tgt: string, relation: string, weight: number, detail?: string) {
    const key = [src, tgt].sort().join("|");
    const existing = edges.get(key);
    if (!existing || existing.weight < weight) {
      edges.set(key, { source: src, target: tgt, relation, weight, detail });
    }
  };
}
