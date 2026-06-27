/**
 * celia/proxy-tools.ts — expose celia-unique capabilities as yaoyao tools.
 *
 * v1.9.1: These tools do NOT exist in standalone yaoyao — they are celia-only
 * (dream subsystem, L1 scene memory, L0 global user summary, procedural
 * memory). When celia owns the slot and the bridge is active, we register
 * thin proxies that forward to celia via the MCP client, so the user gets a
 * unified tool surface under yaoyao's namespace.
 *
 * Each proxy tool is labelled "[via celia]" so callers know the data source.
 * All failures degrade to an informative error text (never crash).
 *
 * celia tool references: celia-memory-architecture §5.1 (memory tools),
 * §5.2 (dream tools), §8 (procedural memory).
 */

import type { CeliaMcpClient } from "./client.ts";
import type { ToolRegistration } from "../tools/common.ts";

type Logger = { debug?: (m: string) => void; warn?: (m: string) => void };

/** Build a proxy tool that forwards to a celia tool, passing args through. */
function proxy(
  name: string,
  label: string,
  description: string,
  parameters: Record<string, unknown>,
  celiaTool: string,
  client: CeliaMcpClient,
  logger: Logger,
  argTransform?: (p: Record<string, unknown>) => Record<string, unknown>,
): ToolRegistration {
  return {
    id: name,
    name,
    label,
    description: `${description} [via celia]`,
    parameters,
    async execute(_id: string, params: Record<string, unknown>) {
      try {
        const args = argTransform ? argTransform(params) : params;
        const result = await client.callTool(celiaTool, args);
        const text = result.content.map((c) => c.text).join("\n");
        return { content: [{ type: "text", text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn?.(`[yaoyao:celia:proxy] ${name} failed: ${msg}`);
        return { content: [{ type: "text", text: `❌ [via celia] ${name} 调用失败: ${msg}` }] };
      }
    },
  } as unknown as ToolRegistration;
}

/**
 * Create all celia-unique proxy tools. Returns an array ready to push into
 * the tool registration list.
 */
export function createCeliaProxyTools(client: CeliaMcpClient, logger: Logger): ToolRegistration[] {
  return [
    // ── Dream subsystem (§9) ──
    proxy(
      "memory_dream_status",
      "Dream Status [celia]",
      "Query the offline dreaming subsystem progress (涌现检测/巩固/冲突/衰减).",
      {
        type: "object",
        properties: {
          sessionId: { type: "string", description: "Optional session id" },
          runId: { type: "string", description: "Optional run id" },
        },
      },
      "dream_status",
      client,
      logger,
    ),
    proxy(
      "memory_dream_trigger",
      "Trigger Dream [celia]",
      "Manually trigger a dreaming run (consolidation / conflict / decay).",
      {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          mode: { type: "number", description: "Dream mode (0=default)" },
        },
      },
      "dream_trigger_now",
      client,
      logger,
    ),
    proxy(
      "memory_dream_summary",
      "Dream Run Summary [celia]",
      "Summary of the last dreaming run.",
      {
        type: "object",
        properties: { sessionId: { type: "string" }, runId: { type: "string" } },
      },
      "dream_run_summary",
      client,
      logger,
    ),

    // ── L1 scene memory (§3.3) ──
    proxy(
      "memory_scene_load",
      "Load Scenes [celia]",
      "Load L1 scene/memory-type summaries (e.g. L1_scene_work_*, L1_memtype_preference).",
      {
        type: "object",
        properties: {
          paths: {
            type: "array",
            items: { type: "string" },
            description: "Scene paths to load",
          },
        },
        required: ["paths"],
      },
      "memory_scene_load",
      client,
      logger,
    ),
    proxy(
      "memory_scene_list",
      "List Scene Index [celia]",
      "Get the L1 scene index as JSON.",
      { type: "object", properties: {} },
      "memory_scene_list_load",
      client,
      logger,
    ),

    // ── L0 global user overview (§3.3) ──
    proxy(
      "memory_global_summary",
      "Global User Summary [celia]",
      "Get the L0 global user overview (edge ~400t / cloud_s ~1200t / cloud_l ~2500t).",
      {
        type: "object",
        properties: {
          tier: {
            type: "string",
            enum: ["edge", "cloud_s", "cloud_l"],
            description: "Summary tier (default: edge)",
            default: "edge",
          },
        },
      },
      "memory_get_global_summary",
      client,
      logger,
      (p) => ({ tier: (p.tier as string) ?? "edge" }),
    ),

    // ── Flush async ingest queue (§6.3) ──
    proxy(
      "memory_flush_celia",
      "Flush Celia Queue [celia]",
      "Force-flush celia's deferred ingest queue so captured data is searchable.",
      {
        type: "object",
        properties: { timeoutMs: { type: "number", default: 5000 } },
      },
      "memory_flush",
      client,
      logger,
    ),
  ];
}

/**
 * v1.9.1: read-only bridge tool. Used ONLY in celiaBridge.mode="read-only".
 * Opens celia's database read-only (no spawn, no writes) and lets the user
 * browse celia's atomic facts / conversations / global summary / scene index
 * directly. Complements yaoyao's own analysis tools (graph/trends) by exposing
 * celia-side data without running the MCP server.
 */
export function createCeliaReadOnlyTool(
  dbReader: import("./db-reader.ts").CeliaDbReader,
  logger: Logger,
): ToolRegistration {
  return {
    id: "memory_celia_browse",
    name: "memory_celia_browse",
    label: "Browse Celia (read-only) [celia]",
    description:
      "Read-only browse of the memory-celia database (no server spawn, no writes). " +
      "Query celia's atomic facts (L2), raw conversations (L0), global user summary, " +
      "or scene index. [via celia · read-only]",
    parameters: {
      type: "object",
      properties: {
        source: {
          type: "string",
          enum: ["atomic", "conversation", "global", "scene"],
          description: "Which celia table to read: atomic=L2 facts, conversation=L0 logs, global=user overview, scene=L1 index",
        },
        query: {
          type: "string",
          description: "Search query (ignored for 'global' and 'scene')",
          default: "",
        },
        topK: { type: "number", description: "Max results (default 5)", default: 5 },
        tier: {
          type: "string",
          enum: ["edge", "cloud_s", "cloud_l"],
          description: "Summary tier, only for source=global (default: edge)",
          default: "edge",
        },
      },
      required: ["source"],
    },
    async execute(_id: string, params: Record<string, unknown>) {
      const source = params.source as string;
      const query = (params.query as string) ?? "";
      const topK = (params.topK as number) ?? 5;
      try {
        let text: string;
        if (source === "atomic") {
          const rows = dbReader.readAtomicFacts(query, topK);
          text = rows.length === 0
            ? "（celia L2 原子事实无匹配 / 库不可读）"
            : rows.map((r) => `[${r.id}] ${r.content}${r.category ? ` (${r.category})` : ""}`).join("\n");
        } else if (source === "conversation") {
          const rows = dbReader.readConversations(query, topK);
          text = rows.length === 0
            ? "（celia L0 原始会话无匹配 / 库不可读）"
            : rows.map((r) => `[${r.id}] ${r.conversation_id}\n${r.content.slice(0, 300)}…`).join("\n---\n");
        } else if (source === "global") {
          const tier = (params.tier as "edge" | "cloud_s" | "cloud_l") ?? "edge";
          const rows = dbReader.readGlobalSummary(tier);
          text = rows.length === 0
            ? "（celia L0 全局画像为空 / 库不可读）"
            : rows.map((r) => `[${r.type}] ${r.content}`).join("\n");
        } else if (source === "scene") {
          const rows = dbReader.readSceneIndex();
          text = rows.length === 0
            ? "（celia L1 场景索引为空 / 库不可读）"
            : rows.map((r) => `${r.path}${r.summary ? ` — ${r.summary}` : ""}`).join("\n");
        } else {
          text = `未知 source: ${source}`;
        }
        return { content: [{ type: "text", text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn?.(`[yaoyao:celia:ro] browse failed: ${msg}`);
        return { content: [{ type: "text", text: `❌ [via celia · read-only] 读取失败: ${msg}` }] };
      }
    },
  } as unknown as ToolRegistration;
}

