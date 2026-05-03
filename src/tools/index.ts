/**
 * Tool index — registers all yaoyao-memory tools.
 * Now with FTS5-powered search via Python bridge.
 */
import { resolve } from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { MemoryStore } from "../utils/memory-store.js";
import type { DBBridge } from "../utils/db-bridge.js";
import { detectSentiment, summarizeMood } from "../utils/sentiment.js";

export function registerMemoryTools(api: OpenClawPluginApi, store: MemoryStore, db: DBBridge) {
  // Tool 1: memory_search — FTS5 full-text search
  api.registerTool({
    name: "yaoyao_memory_search",
    label: "Yaoyao Memory Search",
    description: "Search through past memories using full-text search. Supports keywords, phrases, and natural language queries. Results are ranked by relevance.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query (keywords, phrases, natural language)" },
        maxResults: { type: "number", description: "Maximum results to return (default: 10)", default: 10 },
      },
      required: ["query"],
    },
    async execute(_id: string, params: Record<string, unknown>) {
      const query = String(params.query ?? "").trim();
      const limit = Math.min(Math.max(Number(params.maxResults) || 10, 1), 50);

      if (!query) {
        return { content: [{ type: "text", text: "请输入搜索关键词。" }] };
      }

      // Search via FTS5
      const results = db.search(query, limit);

      if (results.length === 0) {
        // Fallback: try keyword-based search in memory files (for backward compat)
        const fileResults = fallbackSearch(store, query, limit);
        if (fileResults.length === 0) {
          return { content: [{ type: "text", text: "没有找到相关记忆。" }] };
        }
        const text = fileResults.map(r =>
          `【${r.filename}】(得分: ${r.score.toFixed(3)})\n${r.snippet}`
        ).join("\n\n---\n\n");
        return { content: [{ type: "text", text }] };
      }

      const text = results.map(r =>
        `【${r.filename}】(得分: ${r.score.toFixed(3)})\n${r.snippet}`
      ).join("\n\n---\n\n");

      return { content: [{ type: "text", text }] };
    },
  });

  // Tool 2: memory_get — read specific memory file
  api.registerTool({
    name: "yaoyao_memory_get",
    label: "Yaoyao Memory Get",
    description: "Read a memory file by filename or date. Returns the full file contents.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Memory file path (e.g., '2026-05-02.md' or absolute path)" },
        from: { type: "number", description: "Start reading from this line (1-indexed)" },
        lines: { type: "number", description: "Number of lines to read" },
      },
      required: ["path"],
    },
    async execute(_id: string, params: Record<string, unknown>) {
      // Build path, resolving relative to baseDir, then validate it's within baseDir
      const rawPath = String(params.path ?? "");
      const resolved = rawPath.startsWith("/")
        ? resolve(rawPath)
        : resolve(store.baseDir, rawPath);
      if (!resolved.startsWith(store.baseDir)) {
        return { content: [{ type: "text", text: `⛔ 拒绝读取记忆目录之外的文件: ${rawPath}` }] };
      }
      const filePath = resolved;

      const content = store.readFile(filePath);
      if (content === null) {
        return { content: [{ type: "text", text: `文件未找到: ${params.path}` }] };
      }

      if (params.from !== undefined) {
        const allLines = content.split("\n");
        const start = Math.max(0, (Number(params.from) || 1) - 1);
        const count = params.lines ? Number(params.lines) : allLines.length;
        return { content: [{ type: "text", text: allLines.slice(start, start + count).join("\n") }] };
      }

      return { content: [{ type: "text", text: content }] };
    },
  });

  // Tool 3: memory_list — list available memory files
  api.registerTool({
    name: "memory_list",
    label: "Memory List",
    description: "List available memory files with metadata (type, date, size, modified time).",
    parameters: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["daily", "memory", "archive"], description: "Filter by file type" },
        limit: { type: "number", description: "Max results (default: 20)", default: 20 },
      },
    },
    async execute(_id: string, params: Record<string, unknown>) {
      const limit = Math.min(Math.max(Number(params.limit) || 20, 1), 100);
      let files = store.listFiles();

      if (params.type && typeof params.type === "string") {
        files = files.filter(f => f.type === params.type);
      }

      files = files.slice(0, limit);

      if (files.length === 0) {
        return { content: [{ type: "text", text: "没有找到记忆文件。" }] };
      }

      const lines = files.map(f => {
        const date = new Date(f.modified).toISOString().slice(0, 19).replace("T", " ");
        const sizeKB = (f.size / 1024).toFixed(1);
        return `[${f.type}] ${f.filename} (${sizeKB}KB, ${date})`;
      });

      return { content: [{ type: "text", text: `记忆文件列表 (共 ${lines.length} 个):\n\n${lines.join("\n")}` }] };
    },
  });

  // Tool 4: memory_save — manually save a memory entry
  api.registerTool({
    name: "memory_save",
    label: "Memory Save",
    description: "Save a memory entry to the daily log and index it in FTS5 for search. Records an event, thought, or observation.",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", description: "The memory content to save" },
        date: { type: "string", description: "Date string (YYYY-MM-DD). Defaults to today." },
        tags: { type: "string", description: "Optional tags (comma-separated) like 'decision,preference,learning'" },
      },
      required: ["content"],
    },
    async execute(_id: string, params: Record<string, unknown>) {
      const date = String(params.date || new Date().toISOString().slice(0, 10));
      const content = String(params.content ?? "");
      const tagSection = params.tags ? `\nTags: ${params.tags}` : "";
      const timestamp = new Date().toISOString().slice(0, 19).replace("T", " ");
      const entry = `\n\n### ${timestamp}\n${content}${tagSection}\n`;

      store.appendToDaily(date, entry);
      // Also index in FTS5 for search
      db.indexTurn(content.substring(0, 200), "", date);

      return { content: [{ type: "text", text: `记忆已保存到 ${date}.md 并加入全文搜索索引。` }] };
    },
  });

  // Tool 5: memory_stats — memory statistics (new!)
  api.registerTool({
    name: "memory_stats",
    label: "Memory Stats",
    description: "Get statistics about stored memories: total count, dates breakdown, and database health.",
    parameters: {
      type: "object",
      properties: {},
    },
    async execute() {
      const dbStats = db.getStats();
      const files = store.listFiles();

      const totalFiles = files.length;
      const dailyFiles = files.filter(f => f.type === "daily").length;
      const totalSizeKB = (files.reduce((sum, f) => sum + f.size, 0) / 1024).toFixed(1);
      const ftsMemories = (dbStats.totalMemories as number) || 0;

      const lines = [
        `📊 记忆统计`,
        `───`,
        `📁 总文件数: ${totalFiles} (每日日志: ${dailyFiles})`,
        `💾 总大小: ${totalSizeKB}KB`,
        `🔍 FTS5 索引条目: ${ftsMemories}`,
      ];

      if (dbStats.datesSummary && Array.isArray(dbStats.datesSummary)) {
        lines.push(``);
        lines.push(`📅 按日期分布:`);
        for (const d of (dbStats.datesSummary as Array<{ date: string; count: number }>)) {
          lines.push(`   ${d.date}: ${d.count} 条`);
        }
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  });

  // ── Tool 6: memory_mood — sentiment-based "memory mood ring" ──
  api.registerTool({
    name: "memory_mood",
    label: "Memory Mood",
    description: "Analyze the emotional tone of recent conversations — gives a 'mood ring' view of your memory history. Returns sentiment breakdown and emoji summary.",
    parameters: {
      type: "object",
      properties: {
        days: { type: "number", description: "How many days back to analyze (default: 7)", default: 7 },
      },
    },
    async execute(_id: string, params: Record<string, unknown>) {
      const days = Math.min(Math.max(Number(params.days) || 7, 1), 90);
      const files = store.listFiles().filter(f => f.type === "daily").slice(0, days);

      if (files.length === 0) {
        return { content: [{ type: "text", text: "没有足够的数据来生成心情分析。" }] };
      }

      const allTexts: string[] = [];
      for (const f of files) {
        const content = store.readFile(f.path);
        if (content) allTexts.push(content);
      }

      const sentimentResults = allTexts.map(t => detectSentiment(t));
      const posCount = sentimentResults.filter(r => r.label === 'positive').length;
      const negCount = sentimentResults.filter(r => r.label === 'negative').length;
      const neuCount = sentimentResults.filter(r => r.label === 'neutral').length;
      const total = sentimentResults.length;

      const summary = summarizeMood(allTexts);
      const moodEmoji = posCount > negCount ? '😊' : negCount > posCount ? '😟' : '😐';

      const lines = [
        `🎨 记忆心情环`,
        `───`,
        `📅 分析范围: 最近 ${days} 天 (${files.length} 条日志)`,
        `${moodEmoji} 总体: ${summary}`,
        ``,
        `📊 情绪分布:`,
        `   😊 积极: ${posCount} 条 (${(posCount / total * 100).toFixed(1)}%)`,
        `   😐 中性: ${neuCount} 条 (${(neuCount / total * 100).toFixed(1)}%)`,
        `   😢 消极: ${negCount} 条 (${(negCount / total * 100).toFixed(1)}%)`,
      ];

      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  });

  // ── Tool 7: memory_timeline — visual timeline of memory activity ──
  api.registerTool({
    name: "memory_timeline",
    label: "Memory Timeline",
    description: "Show a timeline view of memory activity. Visualizes when conversations happened over time with heat-map-like density bars.",
    parameters: {
      type: "object",
      properties: {
        days: { type: "number", description: "How many days back (default: 14)", default: 14 },
      },
    },
    async execute(_id: string, params: Record<string, unknown>) {
      const days = Math.min(Math.max(Number(params.days) || 14, 1), 90);
      const stats = db.getStats();
      const dates = stats.datesSummary || [];
      const now = new Date();
      const dateMap = new Map(dates.map(d => [d.date, d.count]));

      const lines = [`📅 记忆时间线 (最近 ${days} 天)`, `───`];

      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        const count = dateMap.get(key) || 0;
        const barLen = Math.min(count, 10);
        const bar = count > 0 ? '█'.repeat(barLen) + (count > 10 ? `+${count - 10}` : '') : '·';
        const label = key.slice(5);
        lines.push(`  ${label} ${bar} ${count > 0 ? `${count}条` : ''}`);
      }

      const total = dates.reduce((sum, d) => sum + d.count, 0);
      lines.push(`───`);
      lines.push(`📊 总计: ${total} 条记忆条目`);

      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  });

  // ── Tool 8: enhanced memory_search with timeline — wraps yaoyao_memory_search ──
  // (this is a meta enhancement — the original yaoyao_memory_search already works,
  //  we just register a companion tool for richer timeline-aware search)
  api.registerTool({
    name: "memory_search_timeline",
    label: "Memory Search with Timeline",
    description: "Search memories and show when they occurred on a timeline. Combines FTS5 search with temporal context for richer results.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        maxResults: { type: "number", description: "Maximum results (default: 10)", default: 10 },
      },
      required: ["query"],
    },
    async execute(_id: string, params: Record<string, unknown>) {
      const query = String(params.query ?? "").trim();
      const limit = Math.min(Math.max(Number(params.maxResults) || 10, 1), 50);

      if (!query) {
        return { content: [{ type: "text", text: "请输入搜索关键词。" }] };
      }

      const results = db.search(query, limit);
      if (results.length === 0) {
        return { content: [{ type: "text", text: `没有找到与 "${query}" 相关的记忆。` }] };
      }

      // Group by date for timeline context
      const byDate = new Map<string, typeof results>();
      for (const r of results) {
        const date = r.date || "unknown";
        if (!byDate.has(date)) byDate.set(date, []);
        byDate.get(date)!.push(r);
      }

      const sortedDates = [...byDate.keys()].sort().reverse();
      const textParts: string[] = [`🔍 搜索: "${query}" (${results.length} 条结果)`, `───`];

      for (const date of sortedDates) {
        const items = byDate.get(date)!;
        textParts.push(`📅 ${date} (${items.length} 条)`);
        for (const item of items) {
          const sentiment = detectSentiment(item.snippet);
          textParts.push(`   ${sentiment.emoji} ${item.snippet.slice(0, 150)}`);
          textParts.push(`   (得分: ${item.score.toFixed(2)})`);
        }
        textParts.push(``);
      }

      return { content: [{ type: "text", text: textParts.join("\n") }] };
    },
  });

  api.logger.info("[yaoyao-memory] 8 tools registered (FTS5 + mood + timeline)");
}

/**
 * Fallback keyword search — for backward compatibility when FTS5 returns no results.
 * Scans markdown files for keyword matches.
 */
function fallbackSearch(store: MemoryStore, query: string, limit: number) {
  const queryLower = query.toLowerCase();
  const files = store.listFiles();
  const results: Array<{ filename: string; snippet: string; score: number }> = [];

  for (const file of files.slice(0, 50)) {
    const content = store.readFile(file.path);
    if (!content) continue;

    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].toLowerCase();
      if (line.includes(queryLower)) {
        const snippet = lines.slice(Math.max(0, i - 1), i + 2).join("\n").trim();
        const score = countOccurrences(line, queryLower) / Math.max(1, line.length);
        results.push({ filename: file.filename, snippet: snippet.slice(0, 500), score });
      }
    }
  }

  const seen = new Set<string>();
  return results
    .sort((a, b) => b.score - a.score)
    .filter(r => {
      const key = `${r.filename}|${r.snippet}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

function countOccurrences(text: string, query: string): number {
  let count = 0;
  let idx = 0;
  while ((idx = text.indexOf(query, idx)) !== -1) {
    count++;
    idx += query.length;
  }
  return count;
}
