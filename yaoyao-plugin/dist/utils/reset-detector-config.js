/**
 * utils/reset-detector-config.ts — Config-based reset risk scanning.
 * Extracted from reset-detector-scan.ts.
 */
import fs from "node:fs";
import path from "node:path";
function safeReadJson(filePath) {
    try {
        const raw = fs.readFileSync(filePath, "utf-8");
        return JSON.parse(raw);
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[yaoyao-memory:utils] Operation failed: ${msg}`);
        return null;
    }
}
/** Scan OpenClaw config for memory slot conflicts */
export function scanOpenClawConfig(homeDir) {
    const risks = [];
    const configPath = path.join(homeDir, "openclaw.json");
    const cfg = safeReadJson(configPath);
    if (!cfg)
        return risks;
    const slots = cfg.slots;
    if (slots?.memory && slots.memory !== "yaoyao-memory") {
        risks.push({
            source: "openclaw.json slots.memory",
            severity: "critical",
            description: `slots.memory = "${slots.memory}" — 与 yaoyao-memory 冲突`,
            mitigation: "将 slots.memory 设为 \"yaoyao-memory\"，或禁用其他记忆插件",
        });
    }
    // Check session.reset configuration
    const session = cfg.session;
    const reset = session?.reset;
    if (reset) {
        const mode = reset.mode;
        if (mode === "daily") {
            const atHour = reset.atHour ?? 4;
            risks.push({
                source: "openclaw.json session.reset",
                severity: "info",
                description: `会话每天 ${atHour}:00 自动重置（daily 模式）— 上下文会清空，但 yaoyao 持久化记忆不受影响`,
                mitigation: "如需调整重置时间，修改 session.reset.atHour；如需禁用，移除 reset 配置段",
            });
        }
        else if (mode === "idle") {
            const idleMinutes = reset.idleMinutes ?? 60;
            risks.push({
                source: "openclaw.json session.reset",
                severity: "info",
                description: `会话空闲 ${idleMinutes} 分钟后自动重置（idle 模式）`,
                mitigation: "如需调整，修改 session.reset.idleMinutes",
            });
        }
    }
    else {
        // Default: daily at 4:00 if not configured
        risks.push({
            source: "openclaw.json session.reset",
            severity: "info",
            description: "未配置 session.reset，默认每天凌晨 4:00 自动重置会话上下文",
            mitigation: "如不需要，显式配置 session.reset = false 禁用；或改为 idle 模式",
        });
    }
    // Check session.resetByType for thread/direct/group overrides
    const resetByType = session?.resetByType;
    if (resetByType) {
        for (const [type, cfg] of Object.entries(resetByType)) {
            const mode = cfg.mode;
            if (mode) {
                risks.push({
                    source: `openclaw.json session.resetByType.${type}`,
                    severity: "info",
                    description: `${type} 类型会话使用 ${mode} 重置模式`,
                    mitigation: "确认该策略符合预期",
                });
            }
        }
    }
    return risks;
}
/** Detect if another memory system is active */
export function scanMemorySlotConflict(homeDir) {
    const risks = [];
    const configPath = path.join(homeDir, "openclaw.json");
    const cfg = safeReadJson(configPath);
    if (!cfg)
        return risks;
    const plugins = cfg.plugins;
    const entries = plugins?.entries;
    if (!entries)
        return risks;
    for (const [key, val] of Object.entries(entries)) {
        const pluginVal = val;
        if (!pluginVal)
            continue;
        const name = pluginVal.name;
        if (!name)
            continue;
        const memoryPlugins = ["memory-core"];
        const lowerName = name.toLowerCase();
        if (memoryPlugins.some(p => lowerName.includes(p)) || lowerName.includes("memory")) {
            risks.push({
                source: "plugin conflict",
                severity: "critical",
                description: `其他记忆插件激活: "${name}"（键: ${key}）— 可能与 yaoyao-memory 冲突`,
                mitigation: `禁用 ${name} 插件，或将 yaoyao-memory 设为主要记忆系统`,
            });
        }
    }
    return risks;
}
/** Check yaoyao's own cleanup config */
export function scanYaoyaoConfig(config) {
    const risks = [];
    const cleanup = config.cleanup;
    if (!cleanup)
        return risks;
    if (cleanup.enabled !== false && cleanup.l0l1RetentionDays !== undefined) {
        const days = cleanup.l0l1RetentionDays;
        if (days === 0) {
            risks.push({
                source: "yaoyao cleanup config",
                severity: "info",
                description: "cleanup.l0l1RetentionDays = 0 — 清理已禁用",
                mitigation: "无需操作",
            });
        }
        else if (days <= 3) {
            risks.push({
                source: "yaoyao cleanup config",
                severity: "critical",
                description: `cleanup.l0l1RetentionDays = ${days} — 极度激进，3天内记忆将被删除`,
                mitigation: "将 l0l1RetentionDays 提高到至少 7，或设为 0 禁用清理",
            });
        }
        else if (days <= 7) {
            risks.push({
                source: "yaoyao cleanup config",
                severity: "warning",
                description: `cleanup.l0l1RetentionDays = ${days} — 较短保留期，一周内记忆将被清理`,
                mitigation: "建议将 l0l1RetentionDays 提高到 30 以上",
            });
        }
    }
    if (cleanup.allowAggressiveCleanup) {
        risks.push({
            source: "yaoyao cleanup config",
            severity: "warning",
            description: "cleanup.allowAggressiveCleanup = true — 允许激进清理",
            mitigation: "设为 false 以防止意外数据丢失",
        });
    }
    return risks;
}
