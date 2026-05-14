/**
 * Knowledge Graph feature — optional scene-based memory graph tool.
 * Requires scenes directory to exist.
 */
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { YaoyaoMemoryConfig } from "../../utils/memory-store.js";
import type { OptionalFeature, FeatureResult } from "../types.js";
import fs from "node:fs";
import path from "node:path";

export const graphFeature: OptionalFeature<boolean> = {
  id: "graph",
  name: "Knowledge Graph",
  dependencies: [],
  configKey: "graph.enabled",
  defaultEnabled: true,

  init(api, config) {
    const graphCfg = config.graph as Record<string, unknown> | undefined;
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