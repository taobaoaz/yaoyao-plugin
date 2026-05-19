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

import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";

// === XiaoYi Claw v4.3 API extensions ===

interface XiaoYiContextEngine {
  registerContextEngine(
    name: string,
    engine: {
      ingest: (ctx: unknown) => Promise<void>;
      assemble: (ctx: unknown) => Promise<unknown>;
      compact: (ctx: unknown) => Promise<void>;
      afterTurn: (ctx: unknown) => Promise<void>;
      ownsCompaction?: boolean;
    }
  ): void;
}

interface XiaoYiUDSApi {
  getWorker?: (workspace: string) => {
    call: (method: string, params: unknown) => Promise<unknown>;
    ping: () => number;
  };
  subscribe?: (event: string, handler: (data: unknown) => void) => void;
  mmapRead?: (key: string) => unknown;
  mmapWrite?: (key: string, value: unknown) => void;
}

interface XiaoYiHookApi {
  onAgentEnd?: (callback: (ctx: unknown) => void | Promise<void>) => void;
  onBeforePrompt?: (callback: (ctx: unknown) => void | Promise<void>) => void;
  onGatewayStop?: (callback: () => void | Promise<void>) => void;
}

interface XiaoYiToolApi {
  registerTool: (tool: unknown) => void;
  registerCommand?: (cmd: unknown) => void;
}

export interface XiaoYiUnifiedApi extends
  Partial<Omit<OpenClawPluginApi, "registerTool" | "logger">>,
  XiaoYiHookApi,
  XiaoYiToolApi,
  XiaoYiContextEngine,
  XiaoYiUDSApi {
  xiaoyiVersion?: string;
  pluginConfig?: Record<string, unknown>;
  logger: { info?: (msg: string) => void; error?: (msg: string) => void; warn?: (msg: string) => void };
}

// === v4.3 ContextEngine Adapter ===

export function registerYaoyaoContextEngine(
  api: XiaoYiUnifiedApi,
  hooks: {
    onCapture: (ctx: unknown) => Promise<void>;
    onRecall: (ctx: unknown) => Promise<unknown>;
    onCompact?: (ctx: unknown) => Promise<void>;
  }
): boolean {
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
  } catch (e) {
    api.logger.error?.(`[yaoyao-memory] ContextEngine registration failed: ${e}`);
    return false;
  }
}

// === UDS RPC Adapter ===

export function createUDSMemoryClient(api: XiaoYiUnifiedApi): {
  store: (content: string) => Promise<void>;
  recall: (query: string) => Promise<unknown[]>;
  ping: () => number;
} | null {
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

export function subscribeToMemoryEvents(
  api: XiaoYiUnifiedApi,
  handlers: {
    onIngest?: (data: unknown) => void;
    onCompact?: (data: unknown) => void;
  }
): boolean {
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
  } catch {
    return false;
  }
}

// === mmap Zero-Copy Adapter ===

export function createMmapMemoryBuffer(api: XiaoYiUnifiedApi): {
  read: (key: string) => unknown;
  write: (key: string, value: unknown) => void;
} | null {
  if (!api.mmapRead || !api.mmapWrite) {
    return null;
  }

  return {
    read: (key) => api.mmapRead!(key),
    write: (key, value) => api.mmapWrite!(key, value),
  };
}

// === Main Adapter ===

export function adaptXiaoYiApi(api: XiaoYiUnifiedApi): {
  registerTool: (tool: unknown) => void;
  registerHook: (event: string, handler: (ctx: unknown) => void | Promise<void>) => void;
  logger: { info?: (msg: string) => void; error?: (msg: string) => void };
  pluginConfig: Record<string, unknown>;
} {
  return {
    registerTool: (tool) => {
      if (api.registerTool) {
        api.registerTool(tool);
      } else if ((api as any).tools?.register) {
        (api as any).tools.register(tool);
      }
    },

    registerHook: (event, handler) => {
      const hookMap: Record<string, string> = {
        "agent_end": "onAgentEnd",
        "before_prompt_build": "onBeforePrompt",
        "gateway_stop": "onGatewayStop",
      };

      const xiaoYiHook = hookMap[event] as keyof XiaoYiHookApi;
      if (xiaoYiHook && api[xiaoYiHook]) {
        api[xiaoYiHook]!(handler as any);
      }
    },

    logger: api.logger || { info: console.log, error: console.error },
    pluginConfig: api.pluginConfig || (api as any).config || {},
  };
}

// === Extended adapter with v4.3 features ===

export function adaptXiaoYiApiExtended(api: XiaoYiUnifiedApi): {
  registerTool: (tool: unknown) => void;
  registerHook: (event: string, handler: (ctx: unknown) => void | Promise<void>) => void;
  logger: { info?: (msg: string) => void; error?: (msg: string) => void };
  pluginConfig: Record<string, unknown>;
  contextEngine: {
    register: (hooks: {
      onCapture: (ctx: unknown) => Promise<void>;
      onRecall: (ctx: unknown) => Promise<unknown>;
      onCompact?: (ctx: unknown) => Promise<void>;
    }) => boolean;
  } | undefined;
  uds: ReturnType<typeof createUDSMemoryClient>;
  zmq: {
    subscribe: (handlers: {
      onIngest?: (data: unknown) => void;
      onCompact?: (data: unknown) => void;
    }) => boolean;
  } | undefined;
  mmap: ReturnType<typeof createMmapMemoryBuffer>;
} {
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
export function getAdaptedApi(api: unknown): {
  type: "openclaw" | "xiaoyi-claw";
  registerTool: (tool: unknown) => void;
  registerHook: (event: string, handler: (ctx: unknown) => void | Promise<void>) => void;
  logger: { info?: (msg: string) => void; error?: (msg: string) => void };
  pluginConfig: Record<string, unknown>;
} {
  const xiaoYiApi = api as XiaoYiUnifiedApi;

  // Check for XiaoYi specific markers
  if (xiaoYiApi.xiaoyiVersion || xiaoYiApi.onAgentEnd || xiaoYiApi.onBeforePrompt) {
    return {
      type: "xiaoyi-claw",
      ...adaptXiaoYiApi(xiaoYiApi),
    };
  }

  // Standard OpenClaw
  const ocApi = api as OpenClawPluginApi;
  return {
    type: "openclaw",
    registerTool: (tool) => ocApi.registerTool(tool as any),
    registerHook: (event, handler) => {
      if (event === "agent_end" && "onAgentEnd" in ocApi) {
        (ocApi as any).onAgentEnd(handler);
      } else if (event === "before_prompt_build" && "onBeforePrompt" in ocApi) {
        (ocApi as any).onBeforePrompt(handler);
      }
    },
    logger: ocApi.logger || { info: console.log, error: console.error },
    pluginConfig: (ocApi.pluginConfig || {}) as Record<string, unknown>,
  };
}

/**
 * Get extended adapter with v4.3 features.
 */
export function getAdaptedApiExtended(api: unknown): ReturnType<typeof adaptXiaoYiApiExtended> & { type: "openclaw" | "xiaoyi-claw" } {
  const xiaoYiApi = api as XiaoYiUnifiedApi;

  if (xiaoYiApi.xiaoyiVersion || xiaoYiApi.onAgentEnd || xiaoYiApi.onBeforePrompt) {
    return {
      type: "xiaoyi-claw",
      ...adaptXiaoYiApiExtended(xiaoYiApi),
    };
  }

  const ocApi = api as OpenClawPluginApi;
  return {
    type: "openclaw",
    registerTool: (tool) => ocApi.registerTool(tool as any),
    registerHook: (event, handler) => {
      if (event === "agent_end" && "onAgentEnd" in ocApi) {
        (ocApi as any).onAgentEnd(handler);
      } else if (event === "before_prompt_build" && "onBeforePrompt" in ocApi) {
        (ocApi as any).onBeforePrompt(handler);
      }
    },
    logger: ocApi.logger || { info: console.log, error: console.error },
    pluginConfig: (ocApi.pluginConfig || {}) as Record<string, unknown>,
    contextEngine: undefined,
    uds: null,
    zmq: undefined,
    mmap: null,
  };
}
