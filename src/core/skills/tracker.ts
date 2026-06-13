/**
 * core/skills/tracker.ts — Tool invocation tracking and pattern detection.
 */

import type { ToolInvocation, ToolPattern } from "./types.ts";

// In-memory invocation log
const invocations: ToolInvocation[] = [];
const patterns = new Map<string, ToolPattern>();

function generateParamSignature(params: Record<string, unknown>): string {
  const keys = Object.keys(params).sort();
  return keys.map((k) => `${k}=${typeof params[k]}`).join(",");
}

function generatePatternId(toolId: string, signature: string): string {
  return `${toolId}::${signature}`;
}

export function recordInvocation(invocation: ToolInvocation): void {
  invocations.push(invocation);

  // Update pattern
  const signature = generateParamSignature(invocation.params);
  const patternId = generatePatternId(invocation.toolId, signature);
  const existing = patterns.get(patternId);

  if (existing) {
    existing.frequency++;
    existing.avgDurationMs =
      (existing.avgDurationMs * (existing.frequency - 1) + invocation.durationMs) /
      existing.frequency;
    existing.lastSeen = invocation.timestamp;
    existing.confidence = Math.min(1, existing.frequency / 10);
  } else {
    patterns.set(patternId, {
      id: patternId,
      toolId: invocation.toolId,
      paramSignature: signature,
      frequency: 1,
      avgDurationMs: invocation.durationMs,
      lastSeen: invocation.timestamp,
      confidence: 0.1,
    });
  }
}

export function getInvocations(options?: {
  toolId?: string;
  since?: number;
  limit?: number;
}): ToolInvocation[] {
  let filtered = [...invocations];

  if (options?.toolId) {
    filtered = filtered.filter((i) => i.toolId === options.toolId);
  }
  if (options?.since) {
    filtered = filtered.filter((i) => i.timestamp >= options.since!);
  }
  if (options?.limit) {
    filtered = filtered.slice(-options.limit);
  }

  return filtered;
}

export function getPatterns(minFrequency = 2): ToolPattern[] {
  return [...patterns.values()]
    .filter((p) => p.frequency >= minFrequency)
    .sort((a, b) => b.frequency - a.frequency);
}

export function getTopPatterns(limit = 5): ToolPattern[] {
  return getPatterns(2).slice(0, limit);
}

export function getToolStats(toolId: string): {
  count: number;
  avgDurationMs: number;
  lastUsed: number;
} | null {
  const toolInvocations = invocations.filter((i) => i.toolId === toolId);
  if (toolInvocations.length === 0) return null;

  const totalDuration = toolInvocations.reduce((s, i) => s + i.durationMs, 0);
  return {
    count: toolInvocations.length,
    avgDurationMs: totalDuration / toolInvocations.length,
    lastUsed: Math.max(...toolInvocations.map((i) => i.timestamp)),
  };
}
