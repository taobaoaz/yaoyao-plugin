import os

BASE = "/tmp/yaoyao-fullscan/src"

# 1. 新建 noise-filter.ts (无 \u 转义问题)
with open(os.path.join(BASE, "utils", "noise-filter.ts"), "w", encoding="utf-8") as f:
    f.write("""/**
 * Noise Filter - 过滤低质量内容，防止垃圾写入记忆
 * 从 Brain (memory-lancedb-pro) 学习：过滤 greetings、refusals、meta-questions
 * 纯正则实现，零外部依赖
 */

const NOISE_PATTERNS = [
  /^\\s*(hi|hello|hey|你好|您好|在吗|help|帮助)\\s*[!?.]*\\s*$/i,
  /^\\s*(I'?m sorry|I apologize|I cannot|I can't|I'm unable|抱歉|对不起|我不能|我无法|我不知道)\\b/i,
  /^\\s*(what can you do|who are you|what are you|你能做什么|你是谁|你是什么)\\s*[!?.]*\\s*$/i,
  /^\\s*[^\\w\\u4e00-\\u9fff]{1,5}\\s*$/,
];

export function isNoise(text: string): boolean {
  if (!text || text.trim().length < 3) return true;
  for (const p of NOISE_PATTERNS) {
    if (p.test(text)) return true;
  }
  return false;
}

export function cleanNoise(text: string): string {
  if (isNoise(text)) return "";
  return text.trim();
}
""")

# 2. 修改 db-bridge.ts
with open(os.path.join(BASE, "utils", "db-bridge.ts"), "r", encoding="utf-8") as f:
    db = f.read()

# schema 加字段
old = '"CREATE TABLE IF NOT EXISTS memory_meta (" +\n          "id INTEGER PRIMARY KEY AUTOINCREMENT, " +\n          "date TEXT NOT NULL, " +\n          "user_text TEXT, " +\n          "asst_text TEXT, " +\n          "meta TEXT, " +\n          "created_at TEXT DEFAULT (datetime(\'now\'))" +\n        ")"'
new = '"CREATE TABLE IF NOT EXISTS memory_meta (" +\n          "id INTEGER PRIMARY KEY AUTOINCREMENT, " +\n          "date TEXT NOT NULL, " +\n          "user_text TEXT, " +\n          "asst_text TEXT, " +\n          "meta TEXT, " +\n          "access_count INTEGER DEFAULT 0, " +\n          "tier TEXT DEFAULT \'active\', " +\n          "importance REAL DEFAULT 0.5, " +\n          "created_at TEXT DEFAULT (datetime(\'now\'))" +\n        ")"'
db = db.replace(old, new)

# INSERT 加字段
old = 'd.prepare(\n          "INSERT INTO memory_meta (date, user_text, asst_text, meta) VALUES (?, ?, ?, ?)"\n        ).run(date, userText.slice(0, 2000), asstText.slice(0, 4000), meta || null);'
new = 'd.prepare(\n          "INSERT INTO memory_meta (date, user_text, asst_text, meta, importance, tier, access_count) VALUES (?, ?, ?, ?, ?, ?, ?)"\n        ).run(date, userText.slice(0, 2000), asstText.slice(0, 4000), meta || null, 0.5, "active", 0);'
db = db.replace(old, new)

# 加 incrementAccessCount
inc = """  /** Increment access_count for a memory row and promote tier if threshold reached */
  function incrementAccessCount(id: number): void {
    const d = ensureDB();
    if (!d) return;
    try {
      const row = d.prepare("SELECT access_count, tier, importance FROM memory_meta WHERE id = ?").get(id) as { access_count: number; tier: string; importance: number } | undefined;
      if (!row) return;
      const newCount = (row.access_count || 0) + 1;
      let newTier = row.tier || "active";
      if (newCount >= 10 && (row.importance || 0) >= 0.8) newTier = "core";
      else if (newCount >= 3) newTier = "working";
      d.prepare("UPDATE memory_meta SET access_count = ?, tier = ? WHERE id = ?").run(newCount, newTier, id);
    } catch { /* best effort */ }
  }

"""
idx = db.find("  return { init,")
if idx != -1:
    db = db[:idx] + inc + db[idx:]
    db = db.replace("getAllMeta, getLocalDate, getConfig, setConfig", "getAllMeta, getLocalDate, getConfig, setConfig, incrementAccessCount")

with open(os.path.join(BASE, "utils", "db-bridge.ts"), "w", encoding="utf-8") as f:
    f.write(db)

# 3. 修改 auto-recall.ts
with open(os.path.join(BASE, "hooks", "auto-recall.ts"), "r", encoding="utf-8") as f:
    rec = f.read()

if "noise-filter" not in rec:
    rec = rec.replace('import { getRecallConfig } from "../utils/config.js";',
        'import { getRecallConfig } from "../utils/config.js";\nimport { isNoise } from "../utils/noise-filter.js";')

# 替换 applyTimeDecay
old_decay = """function applyTimeDecay(results: SearchResult[], cfg: RecallThresholds): SearchResult[] {
  if (results.length <= 1) return results;
  const now = Date.now();
  const dayMs = 86400000;

  return results
    .map((r, i) => {
      let daysAgo = 0;
      // Use r.date first (from the search result), fall back to filename parsing
      const dateStr = r.date || r.filename?.replace(".md", "") || "";
      const dateMatch = dateStr.match(/(\\d{4}-\\d{2}-\\d{2})/);
      if (dateMatch) {
        const dateObj = new Date(dateMatch[1] + "T00:00:00");
        if (!isNaN(dateObj.getTime())) {
          daysAgo = Math.max(0, (now - dateObj.getTime()) / dayMs);
        }
      }
      // Default score when missing: positional (first=1.0, then -0.1)
      const originalScore = typeof r.score === "number" ? r.score : Math.max(0.1, 1.0 - i * 0.1);
      return { ...r, score: originalScore * Math.exp(-daysAgo / cfg.halfLife) };
    })
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}"""

new_decay = """function applyTimeDecay(results: SearchResult[], cfg: RecallThresholds): SearchResult[] {
  if (results.length <= 1) return results;
  const now = Date.now();
  const dayMs = 86400000;

  return results
    .map((r, i) => {
      let daysAgo = 0;
      const dateStr = r.date || r.filename?.replace(".md", "") || "";
      const dateMatch = dateStr.match(/(\\d{4}-\\d{2}-\\d{2})/);
      if (dateMatch) {
        const dateObj = new Date(dateMatch[1] + "T00:00:00");
        if (!isNaN(dateObj.getTime())) {
          daysAgo = Math.max(0, (now - dateObj.getTime()) / dayMs);
        }
      }
      const originalScore = typeof r.score === "number" ? r.score : Math.max(0.1, 1.0 - i * 0.1);
      // Brain-style composite decay: recency * frequency * intrinsic
      const accessCount = (r as Record<string, unknown>).accessCount as number || 0;
      const importance = (r as Record<string, unknown>).importance as number || 0.5;
      const tier = ((r as Record<string, unknown>).tier as string) || "active";
      const beta = tier === "core" ? 0.8 : tier === "working" ? 1.0 : 1.3;
      const recency = Math.exp(-Math.pow(daysAgo / cfg.halfLife, beta));
      const frequency = Math.log1p(accessCount) * 0.15 + 1.0;
      const intrinsic = 0.3 + 0.7 * importance;
      return { ...r, score: originalScore * recency * frequency * intrinsic };
    })
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}"""
rec = rec.replace(old_decay, new_decay)

if "incrementAccessCount" not in rec:
    rec = rec.replace(
        'api.logger.debug?.("[yaoyao-memory:auto-recall] Injected " + memories.length + " memories");',
        'api.logger.debug?.("[yaoyao-memory:auto-recall] Injected " + memories.length + " memories");\n      // Brain-style access reinforcement: bump access_count for recalled memories\n      for (const m of memories) {\n        if (m.id) db.incrementAccessCount(m.id);\n      }'
    )

with open(os.path.join(BASE, "hooks", "auto-recall.ts"), "w", encoding="utf-8") as f:
    f.write(rec)

# 4. 修改 auto-capture.ts
with open(os.path.join(BASE, "hooks", "auto-capture.ts"), "r", encoding="utf-8") as f:
    cap = f.read()

if "noise-filter" not in cap:
    cap = cap.replace('import { createSessionFilter } from "../utils/session-filter.ts";',
        'import { createSessionFilter } from "../utils/session-filter.ts";\nimport { isNoise } from "../utils/noise-filter.js";')

old_block = '      if (!lastUserMsg) return;\n\n      // Issue #16'
new_block = """      if (!lastUserMsg) return;

      const userContent = extractContent(lastUserMsg, captureMaxLen);
      const asstContent = extractContent(lastAsstMsg, captureMaxLen);

      // Brain-style noise filter: skip greetings, refusals, meta-questions
      if (isNoise(userContent) && isNoise(asstContent)) {
        api.logger.debug?.("[yaoyao-memory:capture] Skipped noise turn");
        return;
      }

      // Issue #16"""
cap = cap.replace(old_block, new_block)

cap = cap.replace(
    '      const userContent = extractContent(lastUserMsg, captureMaxLen);\n      const asstContent = extractContent(lastAsstMsg, captureMaxLen);\n\n      // Build hallucination risk',
    '      // Build hallucination risk'
)

with open(os.path.join(BASE, "hooks", "auto-capture.ts"), "w", encoding="utf-8") as f:
    f.write(cap)

# 5. 修改 healthcheck.ts
with open(os.path.join(BASE, "utils", "healthcheck.ts"), "r", encoding="utf-8") as f:
    h = f.read()

old_ret = '  const failures = checks.filter(c => c.status === "fail").length;\n  const warns = checks.filter(c => c.status === "warn").length;\n  const ok = failures === 0;'
new_ret = """  // Brain-style health stats: query DB for memory distribution
  try {
    const { createCompatDB } = require("../platform/db/compat.js");
    const { db: statsDb } = createCompatDB(baseDir ? path.join(baseDir, "memory.db") : path.join(memDir, "memory.db"));
    const total = statsDb.prepare("SELECT COUNT(*) as c FROM memory_meta").get() as { c: number };
    const tierDist = statsDb.prepare("SELECT tier, COUNT(*) as c FROM memory_meta GROUP BY tier").all() as { tier: string; c: number }[];
    const avgAge = statsDb.prepare("SELECT AVG(julianday('now') - julianday(created_at)) as d FROM memory_meta").get() as { d: number };
    statsDb.close();
    checks.push({ name: "记忆统计", status: "pass", message: `共 ${total?.c ?? 0} 条记忆`, detail: `层级分布: ${tierDist?.map(t => `${t.tier}=${t.c}`).join(", ") || "active=0"} | 平均天数: ${(avgAge?.d ?? 0).toFixed(1)}` });
  } catch { /* skip if no DB yet */ }

  const failures = checks.filter(c => c.status === "fail").length;
  const warns = checks.filter(c => c.status === "warn").length;
  const ok = failures === 0;"""
h = h.replace(old_ret, new_ret)

with open(os.path.join(BASE, "utils", "healthcheck.ts"), "w", encoding="utf-8") as f:
    f.write(h)

# 6. 修改 list/tool.ts
with open(os.path.join(BASE, "features", "list", "tool.ts"), "r", encoding="utf-8") as f:
    lst = f.read()

old_params = '      parameters: {\n        type: "object",\n        properties: {\n          type: { type: "string", enum: ["daily", "memory", "archive"], description: "Filter by file type" },\n          limit: { type: "number", description: "Max results (default: 20)", default: 20 },\n        },\n      },'
new_params = '      parameters: {\n        type: "object",\n        properties: {\n          type: { type: "string", enum: ["daily", "memory", "archive"], description: "Filter by file type" },\n          limit: { type: "number", description: "Max results (default: 20)", default: 20 },\n          offset: { type: "number", description: "Skip N results (default: 0)", default: 0 },\n          sort: { type: "string", enum: ["time", "score"], description: "Sort by modified time or importance score", default: "time" },\n        },\n      },'
lst = lst.replace(old_params, new_params)

old_exec = '      const limit = clampNum(params.limit, 20, 1, 500);\n      let files = store.listFiles();\n      if (params.type && typeof params.type === "string") {\n        files = files.filter(f => f.type === params.type);\n      }\n      files = files.slice(0, limit);'
new_exec = """      const limit = clampNum(params.limit, 20, 1, 500);
      const offset = clampNum(params.offset, 0, 0, 10000);
      let files = store.listFiles();
      if (params.type && typeof params.type === "string") {
        files = files.filter(f => f.type === params.type);
      }
      if (params.sort === "score") {
        files.sort((a, b) => (b.importance || 0) - (a.importance || 0));
      } else {
        files.sort((a, b) => b.modified - a.modified);
      }
      files = files.slice(offset, offset + limit);"""
lst = lst.replace(old_exec, new_exec)

with open(os.path.join(BASE, "features", "list", "tool.ts"), "w", encoding="utf-8") as f:
    f.write(lst)

print("Done! All Brain features transplanted.")
