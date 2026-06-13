/**
 * core/graph/mutators.ts — Graph relation CRUD + legacy scene graph mutators.
 */

import type {
  MemoryRelation, RelationType,
  GraphNode, GraphEdge,
} from "./types.ts";

// === Legacy scene graph mutators ===
export function createNodeMutator(
  nodes: Map<string, GraphNode>,
  nodeOrder: string[],
) {
  return (id: string, node: GraphNode) => {
    if (!nodes.has(id)) {
      nodes.set(id, node);
      nodeOrder.push(id);
    }
  };
}

export function createEdgeMutator(edges: Map<string, GraphEdge>) {
  return (source: string, target: string, label: string, weight: number, tooltip: string) => {
    const key = [source, target].sort().join("--");
    if (!edges.has(key)) {
      edges.set(key, { source, target, label, weight, tooltip });
    }
  };
}

// === New memory relation store ===
interface GraphStore {
  getRelations(memoryId: string): MemoryRelation[];
  addRelation(relation: MemoryRelation): void;
  removeRelation(id: string): void;
  findRelations(type: RelationType, minStrength: number): MemoryRelation[];
}

class InMemoryGraphStore implements GraphStore {
  private relations = new Map<string, MemoryRelation[]>();

  getRelations(memoryId: string): MemoryRelation[] {
    return this.relations.get(memoryId) ?? [];
  }

  addRelation(relation: MemoryRelation): void {
    const list = this.relations.get(relation.sourceId) ?? [];
    list.push(relation);
    this.relations.set(relation.sourceId, list);
  }

  removeRelation(id: string): void {
    for (const [key, list] of this.relations.entries()) {
      const filtered = list.filter((r) => r.id !== id);
      if (filtered.length !== list.length) {
        this.relations.set(key, filtered);
        return;
      }
    }
  }

  findRelations(type: RelationType, minStrength: number): MemoryRelation[] {
    const results: MemoryRelation[] = [];
    for (const list of this.relations.values()) {
      for (const r of list) {
        if (r.type === type && r.strength >= minStrength) {
          results.push(r);
        }
      }
    }
    return results;
  }
}

let store: GraphStore | null = null;

export function initGraphStore(): GraphStore {
  if (!store) store = new InMemoryGraphStore();
  return store;
}

export function createRelation(
  sourceId: string,
  targetId: string,
  type: RelationType,
  strength: number,
): MemoryRelation {
  return {
    id: `${sourceId}-${targetId}-${type}`,
    sourceId,
    targetId,
    type,
    strength: Math.max(0, Math.min(1, strength)),
    createdAt: Date.now(),
  };
}

export function addRelation(relation: MemoryRelation): void {
  initGraphStore().addRelation(relation);
}

export function getRelatedMemories(
  memoryId: string,
  maxDepth = 1,
  minStrength = 0.3,
): string[] {
  const visited = new Set<string>();
  const queue: { id: string; depth: number }[] = [{ id: memoryId, depth: 0 }];
  const results: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current.id)) continue;
    visited.add(current.id);

    if (current.depth > 0) {
      results.push(current.id);
    }

    if (current.depth >= maxDepth) continue;

    const relations = initGraphStore().getRelations(current.id);
    for (const r of relations) {
      if (r.strength >= minStrength && !visited.has(r.targetId)) {
        queue.push({ id: r.targetId, depth: current.depth + 1 });
      }
    }
  }

  return results;
}
