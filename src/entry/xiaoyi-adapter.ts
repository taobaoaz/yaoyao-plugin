/**
 * entry/xiaoyi-adapter.ts — XiaoYi Claw specific adaptations.
 * 
 * This module provides compatibility layer for XiaoYi Claw's plugin system
 * which differs from standard OpenClaw in several ways:
 * - Different hook registration mechanism
 * - Config format differences
 * - API naming variations
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";

interface XiaoYiHookApi {
  // XiaoYi Claw may use different hook names
  onAgentEnd?: (callback: (ctx: unknown) => void | Promise<void>) => void;
  onBeforePrompt?: (callback: (ctx: unknown) => void | Promise<void>) => void;
  onGatewayStop?: (callback: () => void | Promise<void>) => void;
}

interface XiaoYiToolApi {
  // XiaoYi Claw may wrap tools differently
  registerTool: (tool: unknown) => void;
  registerCommand?: (cmd: unknown) => void;
}

export interface XiaoYiUnifiedApi extends Partial<Omit<OpenClawPluginApi, "registerTool" | "logger">>, XiaoYiHookApi, XiaoYiToolApi {
  // XiaoYi specific properties
  xiaoyiVersion?: string;
  pluginConfig?: Record<string, unknown>;
  logger: { info?: (msg: string) => void; error?: (msg: string) => void; warn?: (msg: string) => void };
}

/**
 * Adapts XiaoYi Claw API to OpenClaw-compatible interface.
 */
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
      // Map OpenClaw hook names to XiaoYi equivalents
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
      // OpenClaw uses different hook registration
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
