/**
 * Plugin entry — delegates all bootstrap to core/app.ts.
 */
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { bootstrapYaoyao } from "../core/app.js";
export default definePluginEntry({
    id: "yaoyao-memory",
    name: "Yaoyao Memory",
    description: "自适应记忆引擎: FTS5 + 向量搜索 + 时间线 + 云备份",
    register(api) {
        try {
            bootstrapYaoyao(api, (api.pluginConfig || {}));
        }
        catch (err) {
            api.logger.error?.(`[yaoyao-memory] Registration failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    },
});
