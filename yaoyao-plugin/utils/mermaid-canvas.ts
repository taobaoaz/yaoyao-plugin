/**
 * Mermaid Canvas — Symbolic short-term memory (Tencent-style Context Offload)
 *
 * When a conversation accumulates many tool calls / long logs,
 * offload the detail to a .md file and replace the context with
 * a Mermaid flowchart reference.
 *
 * brainMode: "lite" — skip Mermaid, keep raw text
 * brainMode: "full" — generate Mermaid task map, offload detail to refs/
 */

import fs from 'node:fs';
import path from 'node:path';

export interface MermaidNode {
  id: string;
  label: string;
  type: 'task' | 'tool' | 'decision' | 'result';
  status: 'pending' | 'done' | 'failed' | 'blocked';
}

export interface MermaidEdge {
  from: string;
  to: string;
  label?: string;
}

/** Build a Mermaid flowchart from conversation tools/tasks */
export function buildMermaidCanvas(nodes: MermaidNode[], edges: MermaidEdge[]): string {
  const lines = ['graph TD'];
  for (const n of nodes) {
    const shape =
      n.type === 'decision'
        ? `{{${n.label}}}`
        : n.type === 'result'
          ? `[(${n.label})]`
          : n.type === 'tool'
            ? `[[${n.label}]]`
            : `[${n.label}]`;
    lines.push(`    ${n.id}${shape}`);
  }
  for (const e of edges) {
    const label = e.label ? `|${e.label}|` : '';
    lines.push(`    ${e.from} -->${label} ${e.to}`);
  }
  return lines.join('\n');
}

/** Heuristic parse: extract tool calls and decisions from raw text */
export function parseToolsFromText(text: string): { nodes: MermaidNode[]; edges: MermaidEdge[] } {
  const nodes: MermaidNode[] = [];
  const edges: MermaidEdge[] = [];
  let nodeId = 0;

  // Pattern 1: "Using tool: xxx" or "called xxx" or "invoke xxx"
  const toolPattern = /(?:using|called?|invoke|run|exec|调用|使用|执行)[\s:]+([\w_-]+)/gi;
  // Pattern 2: "tool: xxx" (common in agent logs)
  const toolColonPattern = /tool[:：]\s*([\w_-]+)/gi;

  const labelToId = new Map<string, string>();
  let prevId: string | null = null;

  function addNode(label: string) {
    if (labelToId.has(label)) return labelToId.get(label)!;
    const id = `n${nodeId++}`;
    nodes.push({
      id,
      label,
      type: 'tool',
      status: 'done',
    });
    labelToId.set(label, id);
    return id;
  }

  for (const m of [...text.matchAll(toolPattern), ...text.matchAll(toolColonPattern)]) {
    const label = m[1];
    if (!label) continue;
    const id = addNode(label);
    if (prevId && prevId !== id) {
      edges.push({ from: prevId, to: id });
    }
    prevId = id;
  }

  return { nodes, edges };
}

/** Offload detailed text to refs/ dir, return Mermaid reference */
export function offloadContext(
  baseDir: string,
  sessionKey: string,
  detailText: string,
  nodes: MermaidNode[],
  edges: MermaidEdge[],
): { mermaid: string; refPath: string } {
  const refsDir = path.join(baseDir, 'refs');
  fs.mkdirSync(refsDir, { recursive: true });

  const refId = `${sessionKey.replace(/[^a-zA-Z0-9_-]/g, '_')}_${Date.now()}`;
  const refPath = path.join(refsDir, `${refId}.md`);

  fs.writeFileSync(refPath, `# Context Offload — ${sessionKey}\n\n${detailText}\n`, 'utf8');

  const mermaid = buildMermaidCanvas(nodes, edges);
  return { mermaid, refPath };
}

/** Lightweight: if conversation is long, replace tool logs with Mermaid + ref */
export function maybeOffload(
  baseDir: string,
  sessionKey: string,
  text: string,
  threshold: number = 4000,
): { text: string; offloaded: boolean; refPath?: string } {
  if (text.length < threshold) {
    return { text, offloaded: false };
  }

  const { nodes, edges } = parseToolsFromText(text);
  if (nodes.length === 0) {
    // No tools found, don't offload
    return { text, offloaded: false };
  }

  const { mermaid, refPath } = offloadContext(baseDir, sessionKey, text, nodes, edges);
  const compressed = `## 会话概要\n\n\`\`\`mermaid\n${mermaid}\n\`\`\`\n\n> 详细日志已卸载至: \`${refPath}\`\n`;
  return { text: compressed, offloaded: true, refPath };
}
