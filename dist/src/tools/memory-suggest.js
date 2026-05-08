/**
 * memory_suggest — identify todos, issues, habits from memories.
 * No LLM — keyword-based pattern matching.
 */
import { withErrorHandling } from "./common.js";

function daysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

const TODO_KEYWORDS = /待办|TODO|todo|需要|todo|need\s+to|要完成|计划|task/i;
const ISSUE_KEYWORDS = /问题|bug|BUG|失败|error|fix|修复|崩溃|报错|异常|exception|crash|issue/i;
const HABIT_TIME_PATTERNS = /(\d{1,2}):(\d{2})/g;

export function createSuggestTool(db) {
  return {
    name: "memory_suggest",
    label: "Memory Suggest",
    description:
      "📋 从记忆中识别待办事项、未完成问题、活跃习惯。无需 LLM，纯关键词匹配。支持 todos/issues/habits/all 四种模式。",
    parameters: {
      type: "object",
      properties: {
        focus: {
          type: "string",
          enum: ["todos", "issues", "habits", "all"],
          description: "分析焦点：todos=待办, issues=问题, habits=活跃习惯, all=全部（默认 all）",
        },
        days: {
          type: "number",
          description: "回溯天数（默认 14）",
          default: 14,
        },
      },
    },
    execute: withErrorHandling(async (_id, params) => {
      const focus = String(params.focus || "all");
      const days = Math.max(Number(params.days) || 14, 1);
      const cutoff = daysAgo(days);

      let allResults;
      try {
        allResults = db.search("的", 500);
      } catch {
        allResults = [];
      }
      const results = allResults.filter(r => r.date >= cutoff);
      if (results.length === 0) {
        return { content: [{ type: "text", text: `近 ${days} 天内没有记忆记录。` }] };
      }

      const parts = [];
      if (focus === "todos" || focus === "all") parts.push(handleTodos(results));
      if (focus === "issues" || focus === "all") parts.push(handleIssues(results));
      if (focus === "habits" || focus === "all") parts.push(handleHabits(results));

      return { content: [{ type: "text", text: parts.join("\n\n") }] };
    }),
  };
}

function handleTodos(results) {
  const todos = results.filter(r => TODO_KEYWORDS.test(r.snippet || ""));
  const lines = [
    "## ✅ 待办事项识别",
    "",
    todos.length > 0 ? `发现 ${todos.length} 条可能的待办/计划记录` : "未发现待办相关记录",
    "",
  ];
  for (let i = 0; i < Math.min(todos.length, 15); i++) {
    lines.push(`${i + 1}. 【${todos[i].date}】${(todos[i].snippet || "").slice(0, 100)}`);
  }
  if (todos.length > 15) lines.push(`...以及 ${todos.length - 15} 条更多`);
  return lines.join("\n");
}

function handleIssues(results) {
  const issues = results.filter(r => ISSUE_KEYWORDS.test(r.snippet || ""));
  const lines = [
    "## 🐛 问题/错误识别",
    "",
    issues.length > 0 ? `发现 ${issues.length} 条可能的问题/错误记录` : "未发现问题相关记录",
    "",
  ];
  for (let i = 0; i < Math.min(issues.length, 15); i++) {
    lines.push(`${i + 1}. 【${issues[i].date}】${(issues[i].snippet || "").slice(0, 100)}`);
  }
  if (issues.length > 15) lines.push(`...以及 ${issues.length - 15} 条更多`);
  return lines.join("\n");
}

function handleHabits(results) {
  // Group records by date, then extract time patterns
  const byDate = new Map();
  for (const r of results) {
    if (!r.date) continue;
    if (!byDate.has(r.date)) byDate.set(r.date, []);
    byDate.get(r.date).push(r);
  }
  // Extract hours from snippets
  const hourCounts = new Array(24).fill(0);
  let totalRecords = 0;
  for (const [, records] of byDate) {
    for (const r of records) {
      const text = r.snippet || "";
      const matches = text.matchAll(HABIT_TIME_PATTERNS);
      for (const m of matches) {
        const hour = parseInt(m[1], 10);
        if (hour >= 0 && hour < 24) {
          hourCounts[hour]++;
          totalRecords++;
        }
      }
    }
  }
  const activeDays = byDate.size;
  const avgPerDay = activeDays > 0 ? (results.length / activeDays).toFixed(1) : "N/A";

  const lines = [
    "## ⏰ 活跃习惯分析",
    "",
    `**活跃天数**: ${activeDays} / ${results.length > 0 ? "全部" : "0"} 天`,
    `**日均记录**: ${avgPerDay} 条`,
    "",
  ];
  if (totalRecords > 0) {
    lines.push("**时间分布**（基于时间戳提取）:");
    const peakHours = hourCounts.map((c, h) => ({ h, c })).filter(x => x.c > 0).sort((a, b) => b.c - a.c).slice(0, 8);
    for (const { h, c } of peakHours) {
      const bar = "█".repeat(Math.min(Math.round(c / Math.max(...hourCounts) * 10), 10));
      lines.push(`  ${String(h).padStart(2, "0")}:00 ${bar} (${c})`);
    }
  } else {
    lines.push("（未从记录中提取到时间信息）");
  }
  return lines.join("\n");
}
