/**
 * Cloud Sync feature — optional cloud backup/restore.
 *
 * Gracefully skips when no credentials are configured.
 */
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { YaoyaoMemoryConfig } from "../../utils/memory-store.ts";
import type { OptionalFeature, FeatureResult } from "../types.ts";
import type { MemoryStore } from "../../utils/memory-store.ts";

export const cloudSyncFeature: OptionalFeature<boolean> = {
  id: "cloud-sync",
  name: "Cloud Sync",
  dependencies: [],
  configKey: "cloud.enabled",
  defaultEnabled: true,

  init(api, config) {
    const cloudCfg = config.cloud as Record<string, unknown> | undefined;
    if (!cloudCfg || cloudCfg.enabled === false) {
      return {
        active: false,
        service: null,
        message: "Cloud sync disabled",
      };
    }

    // Best-effort: tool registration itself checks credentials at runtime.
    // We just declare the feature as "available" here.
    return {
      active: true,
      service: true,
      message: "Cloud sync available (credentials checked at runtime)",
      warning: "Ensure ~/.openclaw/credentials/secrets.env is configured",
    };
  },
};
