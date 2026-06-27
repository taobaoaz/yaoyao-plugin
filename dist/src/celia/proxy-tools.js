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
/** Build a proxy tool that forwards to a celia tool, passing args through. */
function proxy(name, label, description, parameters, celiaTool, client, logger, argTransform) {
    return {
        id: name,
        name,
        label,
        description: `${description} [via celia]`,
        parameters,
        async execute(_id, params) {
            try {
                const args = argTransform ? argTransform(params) : params;
                const result = await client.callTool(celiaTool, args);
                const text = result.content.map((c) => c.text).join("\n");
                return { content: [{ type: "text", text }] };
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                logger.warn?.(`[yaoyao:celia:proxy] ${name} failed: ${msg}`);
                return { content: [{ type: "text", text: `❌ [via celia] ${name} 调用失败: ${msg}` }] };
            }
        },
    };
}
/**
 * Create all celia-unique proxy tools. Returns an array ready to push into
 * the tool registration list.
 */
export function createCeliaProxyTools(client, logger) {
    return [
        // ── Dream subsystem (§9) ──
        proxy("memory_dream_status", "Dream Status [celia]", "Query the offline dreaming subsystem progress (涌现检测/巩固/冲突/衰减).", {
            type: "object",
            properties: {
                sessionId: { type: "string", description: "Optional session id" },
                runId: { type: "string", description: "Optional run id" },
            },
        }, "dream_status", client, logger),
        proxy("memory_dream_trigger", "Trigger Dream [celia]", "Manually trigger a dreaming run (consolidation / conflict / decay).", {
            type: "object",
            properties: {
                sessionId: { type: "string" },
                mode: { type: "number", description: "Dream mode (0=default)" },
            },
        }, "dream_trigger_now", client, logger),
        proxy("memory_dream_summary", "Dream Run Summary [celia]", "Summary of the last dreaming run.", {
            type: "object",
            properties: { sessionId: { type: "string" }, runId: { type: "string" } },
        }, "dream_run_summary", client, logger),
        // ── L1 scene memory (§3.3) ──
        proxy("memory_scene_load", "Load Scenes [celia]", "Load L1 scene/memory-type summaries (e.g. L1_scene_work_*, L1_memtype_preference).", {
            type: "object",
            properties: {
                paths: {
                    type: "array",
                    items: { type: "string" },
                    description: "Scene paths to load",
                },
            },
            required: ["paths"],
        }, "memory_scene_load", client, logger),
        proxy("memory_scene_list", "List Scene Index [celia]", "Get the L1 scene index as JSON.", { type: "object", properties: {} }, "memory_scene_list_load", client, logger),
        // ── L0 global user overview (§3.3) ──
        proxy("memory_global_summary", "Global User Summary [celia]", "Get the L0 global user overview (edge ~400t / cloud_s ~1200t / cloud_l ~2500t).", {
            type: "object",
            properties: {
                tier: {
                    type: "string",
                    enum: ["edge", "cloud_s", "cloud_l"],
                    description: "Summary tier (default: edge)",
                    default: "edge",
                },
            },
        }, "memory_get_global_summary", client, logger, (p) => ({ tier: p.tier ?? "edge" })),
        // ── Flush async ingest queue (§6.3) ──
        proxy("memory_flush_celia", "Flush Celia Queue [celia]", "Force-flush celia's deferred ingest queue so captured data is searchable.", {
            type: "object",
            properties: { timeoutMs: { type: "number", default: 5000 } },
        }, "memory_flush", client, logger),
    ];
}
