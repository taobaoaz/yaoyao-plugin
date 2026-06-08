/**
 * entry/adapter.ts — Environment adapter for OpenClaw / XiaoYi Claw.
 */

import { detectEnvironment, isXiaoYiClaw, isOpenClaw } from '../utils/environment-detector.ts';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/plugin-entry';

interface XiaoYiPluginApi {
  registerTool: (tool: unknown) => void;
  registerHook: (hook: unknown) => void;
  logger: { info?: (msg: string) => void; error?: (msg: string) => void };
  config: Record<string, unknown>;
}

export type UnifiedPluginApi = OpenClawPluginApi | XiaoYiPluginApi;

export function adaptEnvironment(api: UnifiedPluginApi): {
  type: 'openclaw' | 'xiaoyi-claw';
  registerTool: (tool: unknown) => void;
  registerHook?: (hook: unknown) => void;
  logger: { info?: (msg: string) => void; error?: (msg: string) => void };
  config: Record<string, unknown>;
} {
  const env = detectEnvironment();

  if (isOpenClaw()) {
    const ocApi = api as OpenClawPluginApi;
    return {
      type: 'openclaw',
      registerTool: (tool) => ocApi.registerTool?.(tool as any),
      registerHook: (hook) => {
        // OpenClaw hook registration
        if ('registerHook' in ocApi) {
          (ocApi as any).registerHook(hook);
        }
      },
      logger: ocApi.logger || { info: console.log, error: console.error },
      config: (ocApi.pluginConfig || {}) as Record<string, unknown>,
    };
  }

  if (isXiaoYiClaw()) {
    const xyApi = api as XiaoYiPluginApi;
    return {
      type: 'xiaoyi-claw',
      registerTool: xyApi.registerTool.bind(xyApi),
      registerHook: xyApi.registerHook?.bind(xyApi),
      logger: xyApi.logger || { info: console.log, error: console.error },
      config: xyApi.config || {},
    };
  }

  // Fallback — try generic adapter
  return {
    type: 'openclaw',
    registerTool: (tool) => (api as any).registerTool?.(tool),
    registerHook: (hook) => (api as any).registerHook?.(hook),
    logger: (api as any).logger || { info: console.log, error: console.error },
    config: (api as any).pluginConfig || (api as any).config || {},
  };
}
