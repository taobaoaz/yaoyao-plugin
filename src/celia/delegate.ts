/**
 * celia/delegate.ts — wrap overlapping yaoyao tools with celia delegation.
 *
 * v1.9.1: When celia owns the memory slot AND celiaBridge.enabled=true, tools
 * that overlap with celia (see tool-map.ts) forward their call to celia so the
 * official store remains the single source of truth. If celia is unavailable
 * or the call fails, the tool transparently falls back to yaoyao's own
 * implementation — so a celia outage never breaks yaoyao.
 *
 * In a standalone (empty) environment this module is never invoked: the wrapper
 * is identity, zero overhead, zero behavior change.
 *
 * Two tool shapes exist in yaoyao:
 *   - `execute(id, params)` → the majority (save/search/forget/list)
 *   - `handler(params)`     → a few (atomic-fact, etc.) — these are NOT in the
 *                              delegation map, so they pass through unchanged.
 */

import type { CeliaMcpClient } from "./client.ts";
import type { ToolRegistration } from "../tools/common.ts";
import { getMapping } from "./tool-map.ts";

export interface DelegateContext {
  /** Non-null only when delegation should be active (coexist + bridge enabled). */
  client: CeliaMcpClient | null;
  /** Minimal logger for delegation diagnostics. */
  logger?: { debug?: (m: string) => void; warn?: (m: string) => void };
}

/** Pull the tool name from either `name` or `id`. */
function toolNameOf(tool: ToolRegistration): string {
  const t = tool as unknown as Record<string, unknown>;
  return (t.name as string) || (t.id as string) || "";
}

/** Concatenate celia MCP content blocks into a single text string. */
function flattenContent(parts: Array<{ type: string; text: string }>): string {
  return parts.map((p) => p.text).join("\n");
}

/**
 * Wrap a tool so that, when delegation is active, overlapping calls forward to
 * celia first. Tools not in the delegation map pass through untouched.
 *
 * The original `execute` is always preserved as the fallback path.
 */
export function wrapWithCeliaDelegate(
  tool: ToolRegistration,
  ctx: DelegateContext,
): ToolRegistration {
  const name = toolNameOf(tool);
  const mapping = getMapping(name);

  // No mapping → identity (yaoyao-unique tool, or handler-shaped tool)
  if (!mapping) return tool;

  // No active client → identity (standalone env, or bridge disabled)
  if (!ctx.client) return tool;

  const wrapped = Object.assign({}, tool) as ToolRegistration & { execute?: (id: string, params: Record<string, unknown>) => Promise<unknown> };
  const originalExecute = wrapped.execute;
  if (typeof originalExecute !== "function") {
    // Tool uses `handler` shape or has no execute — leave untouched.
    return tool;
  }

  wrapped.execute = async (id: string, params: Record<string, unknown>) => {
    try {
      const celiaArgs = mapping.map(params);
      const result = await ctx.client!.callTool(mapping.celiaTool, celiaArgs);
      const text = mapping.unmap
        ? mapping.unmap(flattenContent(result.content))
        : flattenContent(result.content);
      ctx.logger?.debug?.(`[yaoyao:celia] delegated ${name} → ${mapping.celiaTool} ok`);
      return { content: [{ type: "text", text }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.logger?.warn?.(`[yaoyao:celia] delegate ${name} failed (${msg}); falling back to yaoyao`);
      // Fall back to yaoyao's own implementation — never surface the failure.
      return originalExecute(id, params);
    }
  };

  return wrapped as unknown as ToolRegistration;
}

/**
 * Apply delegation wrapping to a list of tools. Tools without a mapping or
 * when no client is active are returned unchanged (cheap no-op).
 */
export function applyCeliaDelegation(
  tools: ToolRegistration[],
  ctx: DelegateContext,
): ToolRegistration[] {
  if (!ctx.client) return tools;
  return tools.map((t) => wrapWithCeliaDelegate(t, ctx));
}
