/**
 * features/cron/detect.ts — Conflict detection logic for cron tasks.
 * Extracted from tool.ts to keep file under 200 lines.
 */

interface CronJob {
  id?: string;
  schedule: string;
  payload: Record<string, unknown>;
  enabled?: boolean;
}

interface CronRisk {
  source: string;
  severity: "critical" | "warning" | "info";
  description: string;
}

/** Detect risks in OpenClaw cron jobs */
export function detectCronRisks(jobs: CronJob[]): CronRisk[] {
  const risks: CronRisk[] = [];
  for (const job of jobs) {
    const task = String(job.payload?.task || "").toLowerCase();
    if (task.includes("memory") || task.includes("clean") || task.includes("reset") || task.includes("prune")) {
      risks.push({
        source: `cron job ${job.id || "(unknown)"}`,
        severity: "warning",
        description: `定时任务涉及记忆操作: "${task}"，可能与 yaoyao-memory 冲突`,
      });
    }
    // Detect on-the-hour / half-hour congestion
    const sched = job.schedule || "";
    if (/^0\s+\d+\s+\*\s+\*\s+\*/.test(sched) || /^0\s+\d+,\d+\s+\*\s+\*\s+\*/.test(sched) || /^30\s+\d+\s+\*\s+\*\s+\*/.test(sched)) {
      risks.push({
        source: `cron job ${job.id || "(unknown)"}`,
        severity: "info",
        description: `定时任务设置在整点/半点执行 (${sched}) — 建议偏移随机分钟避免系统拥堵`,
      });
    }
  }
  return risks;
}

/** Check if a cron job conflicts with yaoyao-memory */
export function isConflictingJob(job: CronJob): boolean {
  const task = String(job.payload?.task || "").toLowerCase();
  return task.includes("memory") || task.includes("clean") || task.includes("reset") || task.includes("prune");
}
