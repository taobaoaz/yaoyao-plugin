export function createNodeMutator(nodes, nodeOrder) {
    return function addNode(id, node) {
        if (!nodes.has(id)) {
            nodes.set(id, node);
            nodeOrder.push(id);
        }
    };
}
export function createEdgeMutator(edges) {
    return function addEdge(src, tgt, relation, weight, detail) {
        const key = [src, tgt].sort().join('|');
        const existing = edges.get(key);
        if (!existing || existing.weight < weight) {
            edges.set(key, { source: src, target: tgt, relation, weight, detail });
        }
    };
}
