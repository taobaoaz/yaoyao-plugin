/**
 * entry/adapter.ts — Environment adapter for OpenClaw.
 *
 * v1.7.9: XiaoYi Claw adapter removed. Pure OpenClaw.
 */

import { detectEnvironment } from "../utils/environment-detector.ts";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";

export function adaptEnvironment(api: OpenClawPluginApi): {
  type: "openclaw";
  registerTool: (tool: unknown) => void;
  registerHook?: (hook: unknown) => void;
  logger: { info?: (msg: string) => void; error?: (msg: string) => void };
  config: Record<string, unknown>;
} {
  const env = detectEnvironment();

  return {
    type: "openclaw",
    registerTool: (tool) => api.registerTool(tool as never),
    registerHook: (hook) => {
      if ("registerHook" in api) {
        (api as Record<string, unknown>).registerHook?.(hook);
      }
    },
    logger: api.logger || { info: console.log, error: console.error },
    config: (api.pluginConfig || {}) as Record<string, unknown>,
  };
}