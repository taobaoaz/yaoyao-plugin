/**
 * entry/adapter.ts — Environment adapter for OpenClaw / XiaoYi Claw.
 */
import { detectEnvironment, isXiaoYiClaw, isOpenClaw } from "../utils/environment-detector.js";
export function adaptEnvironment(api) {
    const env = detectEnvironment();
    if (isOpenClaw()) {
        const ocApi = api;
        return {
            type: "openclaw",
            registerTool: (tool) => ocApi.registerTool(tool),
            registerHook: (hook) => {
                // OpenClaw hook registration
                if ("registerHook" in ocApi) {
                    ocApi.registerHook(hook);
                }
            },
            logger: ocApi.logger || { info: console.log, error: console.error },
            config: (ocApi.pluginConfig || {}),
        };
    }
    if (isXiaoYiClaw()) {
        const xyApi = api;
        return {
            type: "xiaoyi-claw",
            registerTool: xyApi.registerTool.bind(xyApi),
            registerHook: xyApi.registerHook?.bind(xyApi),
            logger: xyApi.logger || { info: console.log, error: console.error },
            config: xyApi.config || {},
        };
    }
    // Fallback — try generic adapter
    return {
        type: "openclaw",
        registerTool: (tool) => api.registerTool?.(tool),
        registerHook: (hook) => api.registerHook?.(hook),
        logger: api.logger || { info: console.log, error: console.error },
        config: api.pluginConfig || api.config || {},
    };
}
