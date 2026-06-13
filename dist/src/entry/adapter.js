/**
 * entry/adapter.ts — Environment adapter for OpenClaw.
 *
 * v1.7.9: XiaoYi Claw adapter removed. Pure OpenClaw.
 */
import { detectEnvironment } from "../utils/environment-detector.js";

export function adaptEnvironment(api) {
    const env = detectEnvironment();
    return {
        type: "openclaw",
        registerTool: (tool) => api.registerTool(tool),
        registerHook: (hook) => {
            if ("registerHook" in api) {
                api.registerHook?.(hook);
            }
        },
        logger: api.logger || { info: console.log, error: console.error },
        config: (api.pluginConfig || {}),
    };
}