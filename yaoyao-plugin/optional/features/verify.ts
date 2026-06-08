/**
 * Verify feature — optional anti-hallucination marking.
 *
 * Controls whether auto-capture runs speculative/correction detection.
 */
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/plugin-entry';
import type { YaoyaoMemoryConfig } from '../../utils/memory-store.ts';
import type { OptionalFeature, FeatureResult } from '../types.ts';

export const verifyFeature: OptionalFeature<boolean> = {
  id: 'verify',
  name: 'Anti-Hallucination (Verify)',
  dependencies: [],
  configKey: 'verify.enabled',
  defaultEnabled: true,

  init(api, config) {
    const verifyCfg = config.verify as Record<string, unknown> | undefined;
    if (verifyCfg?.enabled === false) {
      return {
        active: false,
        service: null,
        message: 'Anti-hallucination marking disabled',
      };
    }

    return {
      active: true,
      service: true,
      message: 'Anti-hallucination marking enabled (speculative + correction detection)',
    };
  },
};
