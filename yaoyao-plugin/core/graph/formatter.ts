/**
 * core/graph/formatter.ts — Graph output formatting.
 */
import type { GraphResult } from './types.ts';

export function formatGraph(graph: GraphResult): string {
  if (!graph || typeof graph !== 'object')
    throw new TypeError('formatGraph: graph must be an object');
  const lines: string[] = [
    `## 记忆关联图谱`,
    `查询: "${graph.query}"`,
    ``,
    `### 统计`,
    `- 节点数: ${graph.stats.totalNodes}`,
    `- 边数: ${graph.stats.totalEdges}`,
    `- 平均度数: ${graph.stats.avgDegree.toFixed(2)}`,
    `- 最大度数: ${graph.stats.maxDegree}`,
    `- 聚类系数: ${graph.stats.clusterCoeff.toFixed(3)}`,
    `- 连接密度: ${graph.stats.connectionDensity}`,
    ``,
  ];

  if (graph.edges.length > 0) {
    lines.push(`### 关联关系 (前 20 条)`);
    for (let i = 0; i < 20 && i < graph.edges.length; i++) {
      const e = graph.edges[i];
      const srcLabel = graph.nodes.find((n) => n.id === e.source)?.label || e.source;
      const tgtLabel = graph.nodes.find((n) => n.id === e.target)?.label || e.target;
      const detail = e.detail ? ` (${e.detail})` : '';
      lines.push(`- **${srcLabel}** → **${tgtLabel}** [${e.relation}] ${detail}`);
    }
  }
  lines.push(``);

  if (graph.nodes.length > 0) {
    lines.push(`### 重要节点 (按关联度)`);
    for (const node of graph.nodes.slice(0, 10)) {
      const emoji = node.type === 'scene' ? '📂' : node.type === 'tag' ? '🏷️' : '📝';
      lines.push(`- ${emoji} **${node.label}** (度: ${node.degree})`);
    }
  }

  return lines.join('\n');
}
