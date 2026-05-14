/**
 * Cleaner feature — optional daily memory cleanup.
 */
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { YaoyaoMemoryConfig } from "../../utils/memory-store.js";
import type { OptionalFeature, FeatureResult } from "../types.js";
import { createMemoryCleaner, type CleanerConfig } from "../../utils/memory-cleaner.js";
import type { DBBridge } from "../../utils/db-bridge.js";

export const cleanerFeature: OptionalFeature<CleanerConfig> = {
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

    return {
      active: true,
      service: {
        l0l1RetentionDays: config.cleanup?.l0l1RetentionDays,
        allowAggressiveCleanup: config.cleanup?.allowAggressiveCleanup,
      } as CleanerConfig,
      message: "Memory cleaner available",
    };
  },
};
