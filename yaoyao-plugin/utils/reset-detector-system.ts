/**
 * utils/reset-detector-system.ts — System-level reset risk scanning.
 * Extracted from reset-detector-scan.ts.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import type { ResetRisk } from './reset-detector-scan.ts';

function safeExec(cmd: string): string | null {
  try {
    return execSync(cmd, {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[yaoyao-memory:utils] Operation failed: ${msg}`);
    return null;
  }
}

/** Scan system cron for memory-related tasks */
export function scanSystemCron(memoryDir: string): ResetRisk[] {
  const risks: ResetRisk[] = [];
  const homeDir = path.dirname(memoryDir);

  const crontab = safeExec('crontab -l 2>/dev/null');
  if (crontab) {
    const lines = crontab.split('\n');
    for (const line of lines) {
      const lower = line.toLowerCase();
      if (
        lower.includes('memory') ||
        lower.includes('openclaw') ||
        lower.includes(homeDir.toLowerCase()) ||
        lower.includes('rm -rf') ||
        lower.includes('truncate')
      ) {
        risks.push({
          source: 'system crontab',
          severity: 'warning',
          description: `系统定时任务可能涉及记忆目录: "${line.trim().slice(0, 80)}"`,
          mitigation: '检查 crontab 条目，确认不会清理记忆文件',
        });
      }
    }
  }

  const timers = safeExec('systemctl list-timers --no-pager --no-legend 2>/dev/null');
  if (timers && timers.toLowerCase().includes('openclaw')) {
    risks.push({
      source: 'systemd timer',
      severity: 'info',
      description: 'systemd timer 包含 openclaw 相关任务',
      mitigation: '检查 timer 配置，确认不涉及记忆清理',
    });
  }

  return risks;
}

/** Scan other plugin configs for cleanup settings */
export function scanPluginConfigs(homeDir: string): ResetRisk[] {
  const risks: ResetRisk[] = [];
  const pluginsDir = path.join(homeDir, 'plugins');
  if (!fs.existsSync(pluginsDir)) return risks;

  let entries: string[];
  try {
    entries = fs.readdirSync(pluginsDir);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[yaoyao-memory:utils] Operation failed: ${msg}`);
    return risks;
  }

  for (const entry of entries) {
    const pluginConfigPath = path.join(pluginsDir, entry, 'plugin.json');
    let cfg: Record<string, unknown> | null;
    try {
      const raw = fs.readFileSync(pluginConfigPath, 'utf-8');
      cfg = JSON.parse(raw) as Record<string, unknown>;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[yaoyao-memory:reset] Read plugin config failed: ${msg}`);
      continue;
    }
    if (!cfg) continue;

    const name = cfg.name as string | undefined;
    const config = cfg.config as Record<string, unknown> | undefined;
    if (!config) continue;

    const suspiciousKeys = ['retention', 'cleanup', 'reset', 'prune', 'expire', 'ttl', 'maxAge'];
    for (const key of suspiciousKeys) {
      if (key in config) {
        risks.push({
          source: `plugin: ${name || entry}`,
          severity: 'info',
          description: `插件配置包含 "${key}" 字段，可能涉及数据清理`,
          mitigation: `检查 ${name || entry} 插件文档，确认其行为`,
        });
      }
    }
  }

  return risks;
}
