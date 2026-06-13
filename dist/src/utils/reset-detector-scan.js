/**
 * utils/reset-detector-scan.ts — Main scanning orchestrator.
 * Delegates to reset-detector-config.ts and reset-detector-system.ts.
 */
import path from "node:path";
import { scanOpenClawConfig, scanMemorySlotConflict, scanYaoyaoConfig } from "./reset-detector-config.js";
import { scanSystemCron, scanPluginConfigs } from "./reset-detector-system.js";
/** Main entry: detect all scheduled reset risks */
export function detectScheduledResetRisks(memoryDir, yaoyaoConfig) {
    const homeDir = path.dirname(memoryDir);
    const risks = [];
    risks.push(...scanOpenClawConfig(homeDir));
    risks.push(...scanMemorySlotConflict(homeDir));
    risks.push(...scanSystemCron(memoryDir));
    risks.push(...scanPluginConfigs(homeDir));
    if (yaoyaoConfig) {
        risks.push(...scanYaoyaoConfig(yaoyaoConfig));
    }
    return risks;
}
