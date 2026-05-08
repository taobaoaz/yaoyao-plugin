/**
 * memory_archive — archive/restore old memories to reduce search weight.
 * Uses db.getConfig/setConfig for persistence.
 */
import { withErrorHandling } from "./common.js";

const ARCHIVED_DATES_KEY = "archived_dates";
const AUTO_ARCHIVE_DAYS = 60;

export function createArchiveTool(db) {
  return {
    name: "memory_archive",
    label: "Memory Archive",
    description:
      "📦 记忆归档管理 — 将旧记忆标记为归档状态。支持 archive/restore/list/auto 操作。归档后搜索权重降低但不删除。",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["archive", "restore", "list", "auto"],
          description: "操作类型：archive=归档日期, restore=恢复日期, list=查看已归档, auto=自动归档",
        },
        before: {
          type: "string",
          description: "归档此日期之前的记录（如 '2026-04-01'）",
        },
        dryRun: {
          type: "boolean",
          description: "预览模式，不实际修改（默认 false）",
          default: false,
        },
      },
      required: ["action"],
    },
    execute: withErrorHandling(async (_id, params) => {
      const action = String(params.action || "list");
      const before = String(params.before || "");
      const dryRun = Boolean(params.dryRun);

      if (action === "archive") {
        return handleArchive(db, before, dryRun);
      } else if (action === "restore") {
        return handleRestore(db, before);
      } else if (action === "list") {
        return handleList(db);
      } else if (action === "auto") {
        return handleAuto(db, dryRun);
      }
      return { content: [{ type: "text", text: `❌ 未知操作: ${action}` }] };
    }),
  };
}

function getArchivedDates(db) {
  const raw = db.getConfig(ARCHIVED_DATES_KEY, "[]");
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function setArchivedDates(db, dates, dryRun) {
  if (dryRun) return;
  db.setConfig(ARCHIVED_DATES_KEY, JSON.stringify(dates));
}

function handleArchive(db, before, dryRun) {
  if (!before || !/^\d{4}-\d{2}-\d{2}$/.test(before)) {
    return { content: [{ type: "text", text: "❌ 请提供有效的 before 日期（格式 YYYY-MM-DD）。" }] };
  }
  const current = getArchivedDates(db);
  // Get all dates from db up to 'before'
  let allRows;
  try {
    allRows = db.queryMeta({ dateTo: before, limit: 2000 });
  } catch {
    allRows = [];
  }
  const datesToArchive = [...new Set(allRows.filter(r => r.date && r.date < before).map(r => r.date))];
  if (datesToArchive.length === 0) {
    return { content: [{ type: "text", text: `没有找到 ${before} 之前的记忆记录。` }] };
  }
  const newDates = datesToArchive.filter(d => !current.includes(d));
  if (newDates.length === 0) {
    return { content: [{ type: "text", text: `${before} 之前的所有日期已归档。` }] };
  }
  if (!dryRun) {
    const merged = [...new Set([...current, ...newDates])].sort();
    setArchivedDates(db, merged, false);
  }
  const prefix = dryRun ? "[预览] " : "";
  const lines = [
    `📦 ${prefix}归档完成`,
    "",
    `新增归档日期: ${newDates.length} 个`,
    `涉及记录: ${allRows.filter(r => newDates.includes(r.date)).length} 条`,
    "",
    "归档日期列表:",
    ...newDates.map(d => `- ${d}`),
    "",
    dryRun ? "（预览模式，未实际修改）" : "归档后这些日期的记录搜索权重将降低。",
  ];
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

function handleRestore(db, before) {
  if (!before || !/^\d{4}-\d{2}-\d{2}$/.test(before)) {
    return { content: [{ type: "text", text: "❌ 请提供有效的日期参数。" }] };
  }
  const current = getArchivedDates(db);
  const toRestore = current.filter(d => d < before);
  if (toRestore.length === 0) {
    return { content: [{ type: "text", text: "没有匹配的归档日期需要恢复。" }] };
  }
  const remaining = current.filter(d => !toRestore.includes(d));
  db.setConfig(ARCHIVED_DATES_KEY, JSON.stringify(remaining));
  return { content: [{ type: "text", text: `✅ 已恢复 ${toRestore.length} 个归档日期。\n恢复的日期: ${toRestore.join(", ")}` }] };
}

function handleList(db) {
  const archived = getArchivedDates(db);
  if (archived.length === 0) {
    return { content: [{ type: "text", text: "当前没有已归档的日期。" }] };
  }
  const lines = [
    "📦 已归档日期列表",
    "",
    `共 ${archived.length} 个日期已归档`,
    "",
    ...archived.map(d => `- ${d}`),
    "",
    "归档的日期在搜索时权重降低，但不会被删除。",
    "使用 action:restore 可以恢复归档。",
  ];
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

function handleAuto(db, dryRun) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - AUTO_ARCHIVE_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  let allRows;
  try {
    allRows = db.queryMeta({ dateTo: cutoffStr, limit: 2000 });
  } catch {
    allRows = [];
  }
  const current = getArchivedDates(db);
  // Find dates > 60 days old and without [important] tag
  const candidates = [...new Set(allRows.filter(r => {
    if (!r.date || r.date >= cutoffStr) return false;
    if (current.includes(r.date)) return false;
    const text = `${r.user_text || ""} ${r.asst_text || ""}`;
    return !text.includes("[important]");
  }).map(r => r.date))];

  // Double check: exclude dates that have ANY [important] record
  const dateHasImportant = new Set();
  for (const r of allRows) {
    const text = `${r.user_text || ""} ${r.asst_text || ""}`;
    if (r.date && text.includes("[important]")) {
      dateHasImportant.add(r.date);
    }
  }
  const finalCandidates = candidates.filter(d => !dateHasImportant.has(d));

  if (finalCandidates.length === 0) {
    return { content: [{ type: "text", text: `✅ 没有需要自动归档的日期（> ${AUTO_ARCHIVE_DAYS} 天且无 [important] 标记）。` }] };
  }

  if (!dryRun) {
    const merged = [...new Set([...current, ...finalCandidates])].sort();
    db.setConfig(ARCHIVED_DATES_KEY, JSON.stringify(merged));
  }

  const prefix = dryRun ? "[预览] " : "";
  const lines = [
    `📦 ${prefix}自动归档（> ${AUTO_ARCHIVE_DAYS} 天，无 [important] 标记）`,
    "",
    `归档日期: ${finalCandidates.length} 个`,
    "",
    ...finalCandidates.map(d => `- ${d}`),
    "",
    dryRun ? "（预览模式，未实际修改）" : "✅ 归档完成。",
  ];
  return { content: [{ type: "text", text: lines.join("\n") }] };
}
