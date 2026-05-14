import fs from "node:fs";
import path from "node:path";
export const graphFeature = {
    id: "graph",
    name: "Knowledge Graph",
    dependencies: [],
    configKey: "graph.enabled",
    defaultEnabled: true,
    init(api, config) {
        const graphCfg = config.graph;
        if (graphCfg?.enabled === false) {
            return { active: false, service: null, message: "Knowledge graph disabled" };
        }
        const baseDir = config.memoryDir || path.join(process.env.HOME || ".", ".openclaw", "workspace", "memory");
        const scenesDir = path.join(baseDir, "scenes");
        if (!fs.existsSync(scenesDir)) {
            return {
                active: false,
                service: null,
                message: "Knowledge graph inactive (scenes/ directory not found)",
                warning: `Create ${scenesDir} to enable knowledge graph`,
            };
        }
        return { active: true, service: true, message: "Knowledge graph available" };
    },
};
