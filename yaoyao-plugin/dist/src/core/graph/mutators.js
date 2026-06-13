/**
 * core/graph/mutators.ts — Graph relation CRUD + legacy scene graph mutators.
 */
// === Legacy scene graph mutators ===
export function createNodeMutator(nodes, nodeOrder) {
    return (id, node) => {
        if (!nodes.has(id)) {
            nodes.set(id, node);
            nodeOrder.push(id);
        }
    };
}
export function createEdgeMutator(edges) {
    return (source, target, label, weight, tooltip) => {
        const key = [source, target].sort().join("--");
        if (!edges.has(key)) {
            edges.set(key, { source, target, label, weight, tooltip });
        }
    };
}
class InMemoryGraphStore {
    relations = new Map();
    getRelations(memoryId) {
        return this.relations.get(memoryId) ?? [];
    }
    addRelation(relation) {
        const list = this.relations.get(relation.sourceId) ?? [];
        list.push(relation);
        this.relations.set(relation.sourceId, list);
    }
    removeRelation(id) {
        for (const [key, list] of this.relations.entries()) {
            const filtered = list.filter((r) => r.id !== id);
            if (filtered.length !== list.length) {
                this.relations.set(key, filtered);
                return;
            }
        }
    }
    findRelations(type, minStrength) {
        const results = [];
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
let store = null;
export function initGraphStore() {
    if (!store)
        store = new InMemoryGraphStore();
    return store;
}
export function createRelation(sourceId, targetId, type, strength) {
    return {
        id: `${sourceId}-${targetId}-${type}`,
        sourceId,
        targetId,
        type,
        strength: Math.max(0, Math.min(1, strength)),
        createdAt: Date.now(),
    };
}
export function addRelation(relation) {
    initGraphStore().addRelation(relation);
}
export function getRelatedMemories(memoryId, maxDepth = 1, minStrength = 0.3) {
    const visited = new Set();
    const queue = [{ id: memoryId, depth: 0 }];
    const results = [];
    while (queue.length > 0) {
        const current = queue.shift();
        if (visited.has(current.id))
            continue;
        visited.add(current.id);
        if (current.depth > 0) {
            results.push(current.id);
        }
        if (current.depth >= maxDepth)
            continue;
        const relations = initGraphStore().getRelations(current.id);
        for (const r of relations) {
            if (r.strength >= minStrength && !visited.has(r.targetId)) {
                queue.push({ id: r.targetId, depth: current.depth + 1 });
            }
        }
    }
    return results;
}
