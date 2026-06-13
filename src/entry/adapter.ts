/**
 * entry/adapter.ts — Environment adapter for OpenClaw.
 *
 * v1.7.9: XiaoYi Claw adapter removed. Pure OpenClaw.
 */

import { detectEnvironment } from "../utils/environment-detector.ts";
import type { OpenClawPluginApi } from "../openclaw-sdk/plugin-entry.ts";

export function adaptEnvironment(api: OpenClawPluginApi): {
  type: "openclaw";
  registerTool: (tool: unknown) => void;
  registerHook?: (hook: unknown) => void;
  logger: { info?: (msg: string) => void; error?: (msg: string) => void };
  config: Record<string, unknown>;
} {
  detectEnvironment(); // ensure side effects run

  return {
    type: "openclaw",
    registerTool: (tool) => {
      // OpenClawPluginApi types registerTool with no params; use safe call to bypass type check
      const fn = (api as unknown as { registerTool?: (t: unknown) => void }).registerTool;
      if (typeof fn === "function") fn(tool);
    },
    registerHook: (hook) => {
      const fn = (api as unknown as { registerHook?: (h: unknown) => void }).registerHook;
      if (typeof fn === "function") fn(hook);
    },
    logger: api.logger || { info: console.log, error: console.error },
    config: (api.pluginConfig || {}) as Record<string, unknown>,
  };
}
