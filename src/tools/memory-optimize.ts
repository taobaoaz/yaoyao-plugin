/**
 * memory_optimize tool — 基于反馈学习层(FEEDBACK TRACKER)生成优化建议。
 *
 * 分析 .feedback.jsonl 中的历史反馈数据，输出：
 * - 记忆提取调优建议（高频纠错词、模式识别）
 * - 语气/风格调整建议
 * - 整体反馈统计
 *
 * 工具名: memory_optimize
 * 使用: 在 conversation 中调用，返回结构化优化报告。
 *
 * ⚠️ 此模块完全独立，所有 try-catch 兜底
 */

import type { Tool } from "openclaw/plugin-sdk/plugin-entry";
import type { FeedbackTracker } from "../learning/feedback-tracker.js";

interface OptimizeOptions {
  /** Analysis detail level: "quick" | "full" */
  mode?: string;
  /** Max suggestions to return */
  maxSuggestions?: number;
}

export function createOptimizeTool(feedbackTracker: FeedbackTracker): Tool {
  return {
    name: "memory_optimize",
    description: "基于用户历史反馈数据生成记忆系统优化建议。分析纠错/点赞模式，推荐调整记忆提取策略或回复风格。",
    parameters: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["quick", "full"],
          description: "分析模式：'quick' 快速统计汇总；'full' 完整分析含建议（默认 'quick'）",
          default: "quick",
        },
        maxSuggestions: {
          type: "number",
          description: "返回的最大建议数（默认 5）",
          default: 5,
        },
      },
    },

    async execute(args: Record<string, unknown>) {
      try {
        const mode = (args.mode as string) || "quick";
        const maxSug = (args.maxSuggestions as number) || 5;

        // Get stats (always available)
        const stats = feedbackTracker.getStats();
        // Get learning suggestions
        const learning = feedbackTracker.learn();

        // Build result
        const result: Record<string, unknown> = {
          totalFeedback: stats.total,
          corrections: stats.corrections,
          praises: stats.praises,
          ignores: stats.ignores,
          correctionRate: learning.correctionRate,
          topTags: stats.topTags.map(t => `${t.tag}: ${t.count}次`),
          suggestions: learning.suggestions.slice(0, maxSug),
        };

        if (mode === "full") {
          // Full mode: include per-tag breakdown
          const tagBreakdown: Record<string, { total: number; corrections: number; praises: number }> = {};
          for (const [tag, entries] of Object.entries(stats.recentByTag)) {
            tagBreakdown[tag] = {
              total: entries.length,
              corrections: entries.filter(e => e.type === "correction").length,
              praises: entries.filter(e => e.type === "praise").length,
            };
          }
          result.tagBreakdown = tagBreakdown;
        }

        return {
          ok: true,
          result,
        };
      } catch (err: any) {
        return {
          ok: false,
          error: err.message,
        };
      }
    },
  };
}
