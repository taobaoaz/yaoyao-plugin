/**
 * MMD Block Filter — 排除 Mermaid Canvas / offload 注入的中间产物。
 * 腾讯方案：L0 捕获时自动过滤 MMD 上下文块，避免将压缩中间产物误存为记忆。
 * 纯正则实现，零外部依赖。
 */
/** Mermaid graph type markers */
const MERMAID_GRAPH_TYPES = [
    /\bgraph\s+(TD|LR|RL|BT|TB)\b/i,
    /\bflowchart\s+(TD|LR|RL|BT|TB)\b/i,
    /\bsequenceDiagram\b/i,
    /\bclassDiagram\b/i,
    /\bstateDiagram\b/i,
    /\bgantt\b/i,
    /\bpie\b/i,
    /\berDiagram\b/i,
];
/** Mermaid comment / directive markers */
const MERMAID_META = [
    /%%\s*mermaid/i,
    /%%\s*init/i,
];
/** Mermaid edge patterns (high density indicates MMD block) */
const MERMAID_EDGE_DENSITY = /(-->|==>|\.->|-.->)/g;
/** Threshold: if >3 edge patterns found, treat as MMD block */
const EDGE_THRESHOLD = 3;
/**
 * Detect if the given text is a Mermaid Canvas / MMD context block
 * that should be excluded from memory capture.
 */
export function isMMDBlock(text) {
    if (!text || text.length < 20)
        return false;
    // Direct graph type declaration
    for (const p of MERMAID_GRAPH_TYPES) {
        if (p.test(text))
            return true;
    }
    // Mermaid meta directive
    for (const p of MERMAID_META) {
        if (p.test(text))
            return true;
    }
    // High edge density (likely a graph dump)
    const edgeMatches = text.match(MERMAID_EDGE_DENSITY);
    if (edgeMatches && edgeMatches.length >= EDGE_THRESHOLD)
        return true;
    return false;
}
