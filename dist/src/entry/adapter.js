/**
 * entry/adapter.ts — Environment adapter for OpenClaw.
 *
 * v1.7.9: XiaoYi Claw adapter removed. Pure OpenClaw.
 */
import { detectEnvironment } from "../utils/environment-detector.js";
export function adaptEnvironment(api) {
    detectEnvironment(); // ensure side effects run
    return {
        type: "openclaw",
        registerTool: (tool) => {
            // OpenClawPluginApi types registerTool with no params; use safe call to bypass type check
            const fn = api.registerTool;
            if (typeof fn === "function")
                fn(tool);
        },
        registerHook: (hook) => {
            const fn = api.registerHook;
            if (typeof fn === "function")
                fn(hook);
        },
        logger: api.logger || { info: console.log, error: console.error },
        config: (api.pluginConfig || {}),
    };
}
