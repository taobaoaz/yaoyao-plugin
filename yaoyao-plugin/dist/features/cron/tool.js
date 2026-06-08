/**
 * features/cron/tool.ts — Cron / scheduled task management for yaoyao-memory.
 *
 * Provides:
 *   - list: 查看 OpenClaw cron 任务和系统定时任务
 *   - detect: 检测与记忆系统冲突的定时任务
 *   - suggest: 给出优化建议
 *
 * Note: OpenClaw cron config lives in openclaw.json. Modifying it requires
 * gateway restart. This tool reads and analyzes; human approves changes.
 */
import path from 'node:path';
import { safeReadJson, safeExec } from "./io-utils.js";
import { detectCronRisks, isConflictingJob } from "./detect.js";
export function createCronTool(api) {
    const homeDir = api.baseDir || '.';
    return {
        name: 'memory_cron',
        description: '管理 OpenClaw 定时任务（cron）：列出任务、检测冲突、给出优化建议。修改配置需人工确认后重启 gateway。',
        parameters: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    enum: ['list', 'detect', 'suggest', 'disable'],
                    description: 'list=列出任务, detect=检测冲突, suggest=优化建议, disable=生成禁用冲突任务的配置（需用户确认后手动应用）',
                },
                jobId: {
                    type: 'string',
                    description: 'disable 时指定要禁用的 cron job id（从 list 结果中获取）',
                },
            },
            required: ['action'],
        },
        execute: async (args) => {
            const action = args.action;
            // Read openclaw.json
            const configPath = path.join(homeDir, 'openclaw.json');
            const cfg = safeReadJson(configPath);
            const jobs = [];
            if (cfg && Array.isArray(cfg.cron)) {
                for (const job of cfg.cron) {
                    jobs.push({
                        id: job.id,
                        schedule: String(job.schedule || ''),
                        payload: (job.payload || {}),
                        enabled: job.enabled !== false,
                    });
                }
            }
            // Read system crontab
            const crontab = safeExec('crontab -l 2>/dev/null');
            const systemLines = crontab
                ? crontab.split('\n').filter((l) => l.trim() && !l.startsWith('#'))
                : [];
            // Read systemd timers
            const timersOutput = safeExec('systemctl list-timers --no-pager --no-legend 2>/dev/null');
            const systemdTimers = timersOutput ? timersOutput.split('\n').filter((l) => l.trim()) : [];
            if (action === 'list') {
                return {
                    openclawJobs: jobs,
                    systemCrontab: systemLines,
                    systemdTimers,
                    summary: `OpenClaw cron: ${jobs.length} 个 | 系统 crontab: ${systemLines.length} 行 | systemd timers: ${systemdTimers.length} 个`,
                };
            }
            if (action === 'detect') {
                const risks = detectCronRisks(jobs);
                // Also check system crontab for memory-related entries
                for (const line of systemLines) {
                    const lower = line.toLowerCase();
                    if (lower.includes('memory') || lower.includes('openclaw') || lower.includes('rm -rf')) {
                        risks.push({
                            source: 'system crontab',
                            severity: 'warning',
                            description: `系统定时任务可能涉及记忆: "${line.trim().slice(0, 80)}"`,
                        });
                    }
                }
                return {
                    risks,
                    summary: `检测到 ${risks.length} 个风险`,
                };
            }
            if (action === 'suggest') {
                const suggestions = [];
                const risks = detectCronRisks(jobs);
                if (risks.some((r) => r.severity === 'critical')) {
                    suggestions.push('🔴 发现严重冲突：存在与 yaoyao-memory 冲突的定时任务，建议立即移除或修改');
                }
                if (risks.some((r) => r.description.includes('整点'))) {
                    suggestions.push('🟡 部分任务设置在整点/半点执行，建议偏移随机分钟（如 :17、:42）避免系统拥堵');
                }
                if (jobs.length === 0) {
                    suggestions.push('ℹ️ 当前没有 OpenClaw 定时任务，如需自动备份/清理，可添加 cron 任务');
                }
                if (systemLines.length > 0 && !risks.some((r) => r.source === 'system crontab')) {
                    suggestions.push('✅ 系统 crontab 未发现记忆相关任务');
                }
                suggestions.push('💡 建议：所有记忆相关的定时任务统一由 yaoyao-memory 管理，避免多系统冲突');
                return {
                    suggestions,
                    currentJobCount: jobs.length,
                };
            }
            if (action === 'disable') {
                const targetId = args.jobId;
                if (!targetId) {
                    return { error: 'disable 需要 jobId 参数' };
                }
                const jobIndex = jobs.findIndex((j) => j.id === targetId);
                if (jobIndex === -1) {
                    return { error: `未找到 cron job: ${targetId}` };
                }
                const job = jobs[jobIndex];
                const task = String(job.payload?.task || '').toLowerCase();
                // Only allow disabling memory-related conflicting jobs
                if (!isConflictingJob(job)) {
                    return { error: `该任务 (${targetId}) 不涉及记忆操作，不在 yaoyao 接管范围内` };
                }
                // Generate modified config (do NOT write to disk — user must confirm and restart gateway)
                const modifiedJobs = jobs.map((j, idx) => idx === jobIndex ? { ...j, enabled: false } : j);
                return {
                    message: `检测到与 yaoyao-memory 冲突的定时任务: "${task}"`,
                    action: '请确认是否禁用该任务',
                    originalJob: job,
                    modifiedConfig: {
                        cron: modifiedJobs.map((j) => ({
                            id: j.id,
                            schedule: j.schedule,
                            payload: j.payload,
                            enabled: j.enabled,
                        })),
                    },
                    instruction: '将上述 modifiedConfig.cron 替换 openclaw.json 中的 cron 数组，然后重启 OpenClaw gateway 生效',
                };
            }
            return { error: 'Unknown action' };
        },
    };
}
