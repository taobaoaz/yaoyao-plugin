/**
 * Quality Analysis feature — optional memory quality report tool.
 */
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { YaoyaoMemoryConfig } from "../../utils/memory-store.ts";
import type { OptionalFeature, FeatureResult } from "../types.ts";

export const qualityFeature: OptionalFeature<boolean> = {
  id: "quality",
  name: "Quality Analysis",
  dependencies: [],
  configKey: "quality.enabled",
  defaultEnabled: true,

  init(api, config) {
    const qualityCfg = config.quality as Record<string, unknown> | undefined;
    if (qualityCfg?.enabled === false) {
      return { active: false, service: null, message: "Quality analysis disabled" };
    }
    return { active: true, service: true, message: "Quality analysis available" };
  },
};
