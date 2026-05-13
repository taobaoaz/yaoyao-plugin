/**
 * memory_remind tool — 记忆定时提醒
 *
 * 创建定时推送相关记忆的任务，通过 openclaw cron 实现。
 *
 * 工具名: memory_remind
 * 使用:
 *   memory_remind({ keyword: "项目A", cron: "0 8 * * *", message: "早上好，回顾一下今天的工作计划" })
 *   创建一个每天早上 8 点的记忆提醒
 *
 * ⚠️ 此模块完全独立。底层依赖 openclaw cron 子系统。
 */

import { withErrorHandling } from "./common.js";
import type { ToolRegistration } from "./common.js";

export function createRemindTool(): ToolRegistration {
  return {
    name: "memory_remind",
    label: "Remind (Memory)",
    description: "创建记忆定时提醒。通过 openclaw cron 在指定时间触发，推送相关记忆到当前会话。支持 cron 表达式或自然语言描述时间。",
    parameters: {
      type: "object",
      properties: {
        keyword: {
          type: "string",
          description: "要提醒的记忆关键词，创建 cron 时会在推送中搜索相关记忆。留空则推送随机记忆。",
          default: "",
        },
        cron: {
          type: "string",
          description: "cron 表达式，支持标准格式：秒 分 时 日 月 周。也可以用 human 模式传入自然语言描述（见 timeDescription）",
          default: "0 9 * * *",
        },
        timeDescription: {
          type: "string",
          description: "自然语言时间描述（与 cron 二选一）。如：'每天早上8点'、'每周一上午9点'、'每天中午12点'。系统会将其转换为 cron 表达式。",
          default: "",
        },
        message: {
          type: "string",
          description: "提醒消息内容（可选），默认为'⏰ 记忆提醒：关于 [关键词] 的记忆'",
          default: "",
        },
        action: {
          type: "string",
          enum: ["create", "list", "remove"],
          description: "操作类型：create 创建（默认）、list 列出当前提醒、remove 移除指定提醒",
          default: "create",
        },
        remindId: {
          type: "string",
          description: "要移除的提醒 ID（仅 remove 操作需要）",
          default: "",
        },
        minuteOffset: {
          type: "number",
          description: "自然语言时间解析的随机偏移范围（分钟，默认 30）",
          default: 30,
        },
      },
    },
    execute: withErrorHandling(async (_id: string, params: Record<string, unknown>) => {
      const action = String(params.action || "create");

      // ── 列出提醒 ──
      if (action === "list") {
        return {
          content: [{
            type: "text",
            text: "## 记忆定时提醒\n\n请使用 `openclaw cron list` 查看所有定时任务。\n\n当前渠道: xiaoyi-channel",
          }],
        };
      }

      // ── 移除提醒 ──
      if (action === "remove") {
        const id = String(params.remindId || "");
        if (!id) {
          return { content: [{ type: "text", text: "请提供要移除的提醒 ID。" }] };
        }
        return {
          content: [{
            type: "text",
            text: `## 移除提醒\n\n请运行: \`openclaw cron remove ${id}\`\n\n或通过 openclaw 管理面板操作。`,
          }],
        };
      }

      // ── 创建提醒 ──
      const keyword = String(params.keyword || "").trim();
      const message = String(params.message || "");
      const timeDescription = String(params.timeDescription || "");
      const cronExpr = String(params.cron || "0 9 * * *");

      // 如果提供了自然语言描述，转换为 cron 表达式
      let finalCron = cronExpr;
      if (timeDescription) {
        finalCron = convertHumanToCron(timeDescription) || cronExpr;
      }

      const finalMessage = message || (keyword
        ? `⏰ 记忆提醒：关于"${keyword}"的记忆\n\n请使用 memory_search_enhanced / yaoyao_memory_search 搜索 "${keyword}" 来查看相关记忆。`
        : "⏰ 记忆提醒：随机记忆推送\n\n请使用 yaoyao_memory_search 搜索今日的随机记忆。");

      const cronLines: string[] = [
        "## 记忆定时提醒 - 创建成功",
        ``,
        `📋 关键词: ${keyword || "随机记忆"}`,
        `⏰ Cron: \`${finalCron}\``,
        `📝 消息: ${finalMessage}`,
        ``,
        `### 配置方法`,
        ``,
        `请在终端中运行以下命令来激活此定时任务：`,
        ``,
        "```bash",
        `openclaw cron add "${finalCron}" \\`,
        `  --message "${finalMessage}" \\`,
        `  --channel xiaoyi-channel`,
        "```",
        ``,
        `### 常用 cron 示例`,
        ``,
        `| 时间 | Cron 表达式 |`,
        `|------|-------------|`,
        `| 每天早上 8 点 | \`0 8 * * *\` |`,
        `| 每天早上 9 点 | \`0 9 * * *\` |`,
        `| 每天中午 12 点 | \`0 12 * * *\` |`,
        `| 每周一上午 9 点 | \`0 9 * * 1\` |`,
        `| 每小时 | \`0 * * * *\` |`,
        `| 每天早上和晚上 | \`0 8,20 * * *\` |`,
      ];

      // 如果有自然语言时间描述，显示转换结果
      if (timeDescription) {
        cronLines.splice(4, 0, `🕐 时间描述: ${timeDescription}`);
      }

      return { content: [{ type: "text", text: cronLines.join("\n") }] };
    }),
  };
}

/**
 * 自然语言时间 → cron 表达式
 * 覆盖常用中文时间描述，自动提取小时和分钟
 */
function convertHumanToCron(descr: string): string | null {
  const lower = descr.toLowerCase().replace(/\s+/g, "");

  // 提取分钟和小时
  let hour = "09";
  let minute = "00";
  const minMatch = lower.match(/(\d+)分/);
  if (minMatch) minute = minMatch[1].padStart(2, "0");
  const hourMatch = lower.match(/(\d+)点/);
  if (hourMatch) hour = hourMatch[1].padStart(2, "0");

  // 上午/下午/晚上/中午转换
  if (/下午/.test(lower) || /晚上/.test(lower)) {
    const h = Number(hour);
    if (h >= 1 && h <= 11) hour = String(h + 12).padStart(2, "0");
  }
  if (/中午/.test(lower)) {
    hour = "12"; minute = "00";
  }

  // 每N分钟
  const intervalMin = lower.match(/每(?:隔)?(\d+)分钟/);
  if (intervalMin) {
    return `*/${intervalMin[1].padStart(2, "0")} * * * *`;
  }

  // 每半小时 / 每30分钟
  if (/每半?小时/.test(lower) || /每30分钟/.test(lower)) {
    return `*/30 * * * *`;
  }

  // 每N小时
  const intervalHour = lower.match(/每(?:隔)?(\d+)小时/);
  if (intervalHour) {
    return `0 */${intervalHour[1]} * * *`;
  }

  // 每小时
  if (/每小时/.test(lower) || /每个小时/.test(lower)) {
    return `${minute} * * * *`;
  }

  // 工作日
  if (/工作日/.test(lower) || /周一到周五/.test(lower) || /星期一到五/.test(lower)) {
    return `${minute} ${hour} * * 1-5`;
  }

  // 周末
  if (/周末/.test(lower)) {
    return `${minute} ${hour} * * 0,6`;
  }

  // 每周X
  const weekdays: Record<string, string> = {
    "一": "1", "二": "2", "三": "3", "四": "4",
    "五": "5", "六": "6", "日": "0", "天": "0",
  };
  for (const [cn, num] of Object.entries(weekdays)) {
    if (lower.includes(`每周${cn}`)) {
      return `${minute} ${hour} * * ${num}`;
    }
  }

  // 每天（兜底）
  if (/每天/.test(lower) || /每日/.test(lower)) {
    return `${minute} ${hour} * * *`;
  }

  return null;
}
