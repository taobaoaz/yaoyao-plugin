/**
 * utils/healthcheck-stats.ts — Memory stats check for healthcheck.
 */
import path from "node:path";
import type { HealthCheck } from "./healthcheck.ts";

export function runMemoryStatsCheck(
  baseDir: string | undefined,
  memDir: string,
  createCompatDB: (path: string) => { db: { prepare: (sql: string) => { get: () => unknown; all: () => unknown[] }; close: () => void } }
): HealthCheck | null {
  try {
    const dbPath = baseDir ? path.join(baseDir, "memory.db") : path.join(memDir, "memory.db");
    const { db: statsDb } = createCompatDB(dbPath);
    const total = statsDb.prepare("SELECT COUNT(*) as c FROM yaoyao_meta").get() as { c: number } | undefined;
    const tierDist = statsDb.prepare("SELECT tier, COUNT(*) as c FROM yaoyao_meta GROUP BY tier").all() as { tier: string; c: number }[] | undefined;
    const avgAge = statsDb.prepare("SELECT AVG(julianday('now') - julianday(created_at)) as d FROM yaoyao_meta").get() as { d: number } | undefined;
    statsDb.close();
    return {
      name: "记忆统计",
      status: "pass",
      message: `共 ${total?.c ?? 0} 条记忆`,
      detail: `层级分布: ${tierDist?.map(t => `${t.tier}=${t.c}`).join(", ") || "active=0"} | 平均天数: ${(avgAge?.d ?? 0).toFixed(1)}`,
    };
  } catch {
    return null;
  }
}
