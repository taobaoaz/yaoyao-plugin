/**
 * utils/healthcheck-stats.ts — Memory stats check for healthcheck.
 */
import path from "node:path";
export function runMemoryStatsCheck(baseDir, memDir, createCompatDB) {
    try {
        const dbPath = baseDir ? path.join(baseDir, "memory.db") : path.join(memDir, "memory.db");
        const { db: statsDb } = createCompatDB(dbPath);
        const total = statsDb.prepare("SELECT COUNT(*) as c FROM memory_meta").get();
        const tierDist = statsDb.prepare("SELECT tier, COUNT(*) as c FROM memory_meta GROUP BY tier").all();
        const avgAge = statsDb.prepare("SELECT AVG(julianday('now') - julianday(created_at)) as d FROM memory_meta").get();
        statsDb.close();
        return {
            name: "记忆统计",
            status: "pass",
            message: `共 ${total?.c ?? 0} 条记忆`,
            detail: `层级分布: ${tierDist?.map(t => `${t.tier}=${t.c}`).join(", ") || "active=0"} | 平均天数: ${(avgAge?.d ?? 0).toFixed(1)}`,
        };
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[yaoyao-memory:utils] Operation failed: ${msg}`);
        return null;
    }
}
