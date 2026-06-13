/**
 * entry/xiaoyi-adapter.ts — XiaoYi Claw v4.3 specific adaptations.
 *
 * v4.3 changes:
 * - UDS RPC replaces stdin/stdout (Plugin → Worker direct connection)
 * - ContextEngine registration (registerContextEngine)
 * - DAG context relay replaces OpenClaw default contextPruning
 * - ZMQ PUB/SUB for event push
 * - mmap shared memory for zero-copy large payloads
 */
// === v4.3 ContextEngine Adapter ===
export function registerYaoyaoContextEngine(api, hooks) {
    if (!api.registerContextEngine) {
        return false;
    }
    try {
        api.registerContextEngine("yaoyao-memory-engine", {
            ingest: async (ctx) => {
                await hooks.onCapture(ctx);
            },
            assemble: async (ctx) => {
                const memories = await hooks.onRecall(ctx);
                return memories;
            },
            compact: async (ctx) => {
                if (hooks.onCompact) {
                    await hooks.onCompact(ctx);
                }
            },
            afterTurn: async (_ctx) => {
                // Periodic maintenance
            },
            ownsCompaction: true,
        });
        api.logger.info?.("[yaoyao-memory] Registered as ContextEngine (ownsCompaction=true)");
        return true;
    }
    catch (e) {
        api.logger.error?.(`[yaoyao-memory] ContextEngine registration failed: ${e}`);
        return false;
    }
}
// === UDS RPC Adapter ===
export function createUDSMemoryClient(api) {
    if (!api.getWorker) {
        return null;
    }
    const worker = api.getWorker("default");
    return {
        store: async (content) => {
            await worker.call("dag_ingest", { content, source: "yaoyao-memory" });
        },
        recall: async (query) => {
            const result = await worker.call("dag_assemble", { query, source: "yaoyao-memory" });
            return Array.isArray(result) ? result : [];
        },
        ping: () => worker.ping(),
    };
}
// === ZMQ Event Adapter ===
export function subscribeToMemoryEvents(api, handlers) {
    if (!api.subscribe) {
        return false;
    }
    try {
        if (handlers.onIngest) {
            api.subscribe("dag_ingest", handlers.onIngest);
        }
        if (handlers.onCompact) {
            api.subscribe("dag_compact", handlers.onCompact);
        }
        return true;
    }
    catch {
        return false;
    }
}
// === mmap Zero-Copy Adapter ===
export function createMmapMemoryBuffer(api) {
    if (!api.mmapRead || !api.mmapWrite) {
        return null;
    }
    return {
        read: (key) => api.mmapRead(key),
        write: (key, value) => api.mmapWrite(key, value),
    };
}
// === Main Adapter ===
export function adaptXiaoYiApi(api) {
    return {
        registerTool: (tool) => {
            if (api.registerTool) {
                api.registerTool(tool);
            }
            else if (api.tools?.register) {
                api.tools.register(tool);
            }
        },
        registerHook: (event, handler) => {
            const hookMap = {
                "agent_end": "onAgentEnd",
                "before_prompt_build": "onBeforePrompt",
                "gateway_stop": "onGatewayStop",
            };
            const xiaoYiHook = hookMap[event];
            if (xiaoYiHook && api[xiaoYiHook]) {
                api[xiaoYiHook](handler);
            }
        },
        logger: api.logger || { info: console.log, error: console.error },
        pluginConfig: api.pluginConfig || api.config || {},
    };
}
// === Extended adapter with v4.3 features ===
export function adaptXiaoYiApiExtended(api) {
    return {
        ...adaptXiaoYiApi(api),
        contextEngine: api.registerContextEngine ? {
            register: (hooks) => registerYaoyaoContextEngine(api, hooks),
        } : undefined,
        uds: createUDSMemoryClient(api),
        zmq: api.subscribe ? {
            subscribe: (handlers) => subscribeToMemoryEvents(api, handlers),
        } : undefined,
        mmap: createMmapMemoryBuffer(api),
    };
}
/**
 * Detects if running in XiaoYi Claw and returns adapted API.
 */
export function getAdaptedApi(api) {
    const xiaoYiApi = api;
    // Check for XiaoYi specific markers
    if (xiaoYiApi.xiaoyiVersion || xiaoYiApi.onAgentEnd || xiaoYiApi.onBeforePrompt) {
        return {
            type: "xiaoyi-claw",
            ...adaptXiaoYiApi(xiaoYiApi),
        };
    }
    // Standard OpenClaw
    const ocApi = api;
    return {
        type: "openclaw",
        registerTool: (tool) => ocApi.registerTool(tool),
        registerHook: (event, handler) => {
            if (event === "agent_end" && "onAgentEnd" in ocApi) {
                ocApi.onAgentEnd(handler);
            }
            else if (event === "before_prompt_build" && "onBeforePrompt" in ocApi) {
                ocApi.onBeforePrompt(handler);
            }
        },
        logger: ocApi.logger || { info: console.log, error: console.error },
        pluginConfig: (ocApi.pluginConfig || {}),
    };
}
/**
 * Get extended adapter with v4.3 features.
 */
export function getAdaptedApiExtended(api) {
    const xiaoYiApi = api;
    if (xiaoYiApi.xiaoyiVersion || xiaoYiApi.onAgentEnd || xiaoYiApi.onBeforePrompt) {
        return {
            type: "xiaoyi-claw",
            ...adaptXiaoYiApiExtended(xiaoYiApi),
        };
    }
    const ocApi = api;
    return {
        type: "openclaw",
        registerTool: (tool) => ocApi.registerTool(tool),
        registerHook: (event, handler) => {
            if (event === "agent_end" && "onAgentEnd" in ocApi) {
                ocApi.onAgentEnd(handler);
            }
            else if (event === "before_prompt_build" && "onBeforePrompt" in ocApi) {
                ocApi.onBeforePrompt(handler);
            }
        },
        logger: ocApi.logger || { info: console.log, error: console.error },
        pluginConfig: (ocApi.pluginConfig || {}),
        contextEngine: undefined,
        uds: null,
        zmq: undefined,
        mmap: null,
    };
}
