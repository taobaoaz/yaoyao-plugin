/**
 * Retain Check feature — optional at-risk memory detection tool.
 */
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/plugin-entry';
import type { YaoyaoMemoryConfig } from '../../utils/memory-store.ts';
import type { OptionalFeature, FeatureResult } from '../types.ts';

export const retainFeature: OptionalFeature<boolean> = {
  id: 'retain',
  name: 'Retain Check',
  dependencies: [],
  configKey: 'retain.enabled',
  defaultEnabled: true,

  init(api, config) {
    const retainCfg = config.retain as Record<string, unknown> | undefined;
    if (retainCfg?.enabled === false) {
      return { active: false, service: null, message: 'Retain check disabled' };
    }
    return { active: true, service: true, message: 'Retain check available' };
  },
};
