/**
 * Cleaner feature — optional daily memory cleanup.
 */
import type { OpenClawPluginApi } from "../../openclaw-sdk/plugin-entry.ts";
import type { YaoyaoMemoryConfig } from "../../utils/memory-store.ts";
import type { OptionalFeature, FeatureResult } from "../types.ts";
import { createMemoryCleaner, type CleanerConfig } from "../../utils/memory-cleaner.ts";
import type { DBBridge } from "../../utils/db-bridge.ts";

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
