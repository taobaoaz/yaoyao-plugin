/**
 * Cleaner feature — optional daily memory cleanup.
 */
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { YaoyaoMemoryConfig } from "../../utils/memory-store.js";
import type { OptionalFeature, FeatureResult } from "../types.js";
import { createMemoryCleaner } from "../../utils/memory-cleaner.js";
import type { DBBridge } from "../../utils/db-bridge.js";

export const cleanerFeature: OptionalFeature<ReturnType<typeof createMemoryCleaner>> = {
  id: "cleaner",
  name: "Memory Cleaner",
  dependencies: [],
  configKey: "cleanup.enabled",
  defaultEnabled: true,

  init(api, config) {
    if (config.cleanup?.enabled === false) {
      return {
        active: false,
        service: null,
        message: "Memory cleaner disabled",
      };
    }

    // Cleaner needs store.baseDir and db — but we pass them at registration time
    // The feature just declares availability here.
    return {
      active: true,
      service: null, // will be created in entry/index.ts with store/db
      message: "Memory cleaner available",
    };
  },
};
