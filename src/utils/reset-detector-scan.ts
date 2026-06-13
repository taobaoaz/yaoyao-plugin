/**
 * utils/reset-detector-scan.ts — Main scanning orchestrator.
 * Delegates to reset-detector-config.ts and reset-detector-system.ts.
 */

import path from "node:path";
import { scanOpenClawConfig, scanMemorySlotConflict, scanYaoyaoConfig } from "./reset-detector-config.ts";
import { scanSystemCron, scanPluginConfigs } from "./reset-detector-system.ts";

export interface ResetRisk {
  source: string;
  severity: "critical" | "warning" | "info";
  description: string;
  mitigation: string;
}

/** Main entry: detect all scheduled reset risks */
export function detectScheduledResetRisks(
  memoryDir: string,
  yaoyaoConfig?: { cleanup?: { enabled?: boolean; l0l1RetentionDays?: number; allowAggressiveCleanup?: boolean } },
): ResetRisk[] {
  const homeDir = path.dirname(memoryDir);
  const risks: ResetRisk[] = [];

  risks.push(...scanOpenClawConfig(homeDir));
  risks.push(...scanMemorySlotConflict(homeDir));
  risks.push(...scanSystemCron(memoryDir));
  risks.push(...scanPluginConfigs(homeDir));
  if (yaoyaoConfig) {
    risks.push(...scanYaoyaoConfig(yaoyaoConfig));
  }

  return risks;
}
