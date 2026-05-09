/**
 * memory_distill — Weekly implicit-tag distillation into persona observations.
 *
 * v3 philosophy: "潜移默化" via silent observation, not real-time intervention.
 *
 * Reads `.implicit-tags.jsonl` (last N days) and produces human-readable
 * observation notes appended to `persona.md`. No LLM required — pure stats.
 *
 * Design principles:
 * - Facts only: "提到加班时用了感叹号" ✓, "用户很焦虑" ✗
 * - Patterns over moments: aggregates over days, not single-turn judgments
 * - Append, don't overwrite: preserves L3 persona generator output
 * - Zero-dependency: no embedding, no LLM, no external API
 */

import fs from "node:fs";
import path from "node:path";
import type { PersonaStateMachine, ImplicitTag } from "../utils/persona-state.js";

const TAG = "[yaoyao-memory:distill]";

export interface DistillOptions {
  /** Days to look back (default: 7) */
  days?: number;
  /** Minimum tag count to report a pattern (default: 2) */
  minCount?: number;
  /** Dry-run: return text without writing (default: false) */
  dryRun?: boolean;
}

export interface DistillResult {
  success: boolean;
  summary: string;
  observations: string[];
  personaPath: string;
  appended: boolean;
}

export function createDistillTool(personaState: PersonaStateMachine, memoryDir: string) {
  return {
    name: "memory_distill",
    description:
      "🧪 提炼最近对话中的隐式观察笔记。扫描用户行为模式（压力信号、决策习惯、活跃时段等），" +
      "生成自然语言观察摘要并追加到用户画像中。无需 LLM，纯本地统计。",
    parameters: {
      type: "object",
      properties: {
        days: {
          type: "number",
          description: "回溯天数（默认 7 天）",
          default: 7,
        },
        minCount: {
          type: "number",
          description: "触发报告的最少标签次数（默认 2 次）",
          default: 2,
        },
        dryRun: {
          type: "boolean",
          description: "预览模式：只返回文本，不写入文件",
          default: false,
        },
      },
    },
    async execute(args: Record<string, unknown>): Promise<string> {
      const days = Math.max(1, Math.min(30, Number(args.days ?? 7)));
      const minCount = Math.max(1, Number(args.minCount ?? 2));
      const dryRun = Boolean(args.dryRun);

      const result = distillObservations({
        personaState,
        memoryDir,
        days,
        minCount,
        dryRun,
      });

      return formatResult(result);
    },
  };
}

function distillObservations(options: {
  personaState: PersonaStateMachine;
  memoryDir: string;
  days: number;
  minCount: number;
  dryRun: boolean;
}): DistillResult {
  const { personaState, memoryDir, days, minCount, dryRun } = options;

  // 1. Read implicit tags
  const tags = personaState.readImplicitTags(days);
  if (tags.length === 0) {
    return {
      success: true,
      summary: `最近 ${days} 天内暂无足够的隐式标注数据。多聊几句后重试。`,
      observations: [],
      personaPath: path.join(memoryDir, "persona.md"),
      appended: false,
    };
  }

  // 2. Aggregate by tag type
  const stats = aggregateTags(tags);

  // 3. Generate observation sentences (facts only, no emotional judgments)
  const observations: string[] = [];

  // Stress patterns
  if (stats.stress.count >= minCount) {
    const topWords = topK(stats.stress.values, 3);
    const freqDesc = frequencyDesc(stats.stress.count, days);
    observations.push(
      `- 压力信号出现 ${freqDesc}，高频词：${topWords.join("、")}。`
    );
  }

  // Decision avoidance
  if (stats.decisionAvoidance.count >= minCount) {
    observations.push(
      `- 表达决策回避 ${stats.decisionAvoidance.count} 次（如"随便/你定/都行"），用户可能偏好他人代劳选择。`
    );
  }

  // Late night interactions
  if (stats.lateNight.count >= minCount) {
    observations.push(
      `- 深夜时段（00:00–06:00）交互 ${stats.lateNight.count} 次。`
    );
  }

  // Engagement depth
  const deepCount = stats.engagement.deep;
  const normalCount = stats.engagement.normal;
  if (deepCount + normalCount >= minCount) {
    if (deepCount > normalCount * 1.5) {
      observations.push(`- 长文本对话占比高，用户倾向于详细表达。`);
    } else if (normalCount > deepCount * 2) {
      observations.push(`- 对话以简短回复为主，用户偏好轻量交互。`);
    } else {
      observations.push(`- 对话深度分布均衡，长文与短回复均有出现。`);
    }
  }

  // Temporal patterns
  if (stats.lateNight.count >= 3 && stats.stress.count >= 2) {
    observations.push(`- 深夜时段与压力信号存在共现。`);
  }

  if (observations.length === 0) {
    return {
      success: true,
      summary: `最近 ${days} 天内数据量不足（共 ${tags.length} 条标注），未达到报告阈值（minCount=${minCount}）。`,
      observations: [],
      personaPath: path.join(memoryDir, "persona.md"),
      appended: false,
    };
  }

  // 4. Build markdown block
  const now = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
  const block = [
    `### 观察笔记 — ${new Date().toISOString().slice(0, 10)}`,
    ``,
    `> 基于最近 ${days} 天、${tags.length} 条隐式标注的自动提炼。`,
    ``,
    ...observations,
    ``,
  ].join("\n");

  // 5. Append to persona.md
  const personaPath = path.join(memoryDir, "persona.md");
  let appended = false;

  if (!dryRun) {
    try {
      ensurePersonaMd(personaPath);
      const existing = fs.readFileSync(personaPath, "utf-8");
      const updated = existing.trimEnd() + "\n\n" + block;
      fs.writeFileSync(personaPath, updated, "utf-8");
      appended = true;
    } catch (err: any) {
      return {
        success: false,
        summary: `写入 persona.md 失败: ${err.message}`,
        observations,
        personaPath,
        appended: false,
      };
    }
  }

  return {
    success: true,
    summary: `提炼完成。${observations.length} 条观察${appended ? "已追加" : "（预览）"}到 persona.md。`,
    observations,
    personaPath,
    appended,
  };
}

// ── Aggregation helpers ──

interface TagStats {
  stress: { count: number; values: string[] };
  decisionAvoidance: { count: number };
  lateNight: { count: number };
  engagement: { deep: number; normal: number };
}

function aggregateTags(tags: ImplicitTag[]): TagStats {
  const stats: TagStats = {
    stress: { count: 0, values: [] },
    decisionAvoidance: { count: 0 },
    lateNight: { count: 0 },
    engagement: { deep: 0, normal: 0 },
  };

  for (const t of tags) {
    switch (t.tag) {
      case "stress_signal":
        stats.stress.count++;
        if (typeof t.value === "string") {
          stats.stress.values.push(...t.value.split(/[,，]/).map(s => s.trim()).filter(Boolean));
        }
        break;
      case "preference_pattern":
        if (t.value === "decision_avoidance") {
          stats.decisionAvoidance.count++;
        }
        break;
      case "context":
        if (t.value === "late_night_interaction") {
          stats.lateNight.count++;
        }
        break;
      case "engagement":
        if (t.value === "deep") stats.engagement.deep++;
        else if (t.value === "normal") stats.engagement.normal++;
        break;
    }
  }

  return stats;
}

function topK(arr: string[], k: number): string[] {
  const freq = new Map<string, number>();
  for (const s of arr) {
    freq.set(s, (freq.get(s) || 0) + 1);
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([s]) => s);
}

function frequencyDesc(count: number, days: number): string {
  const rate = count / days;
  if (rate >= 1) return `${count} 次（几乎每天）`;
  if (rate >= 0.5) return `${count} 次（约隔天）`;
  return `${count} 次`;
}

function ensurePersonaMd(personaPath: string): void {
  if (fs.existsSync(personaPath)) return;
  fs.writeFileSync(
    personaPath,
    `# Persona\n\n_用户画像文件。上方由 LLM 管线自动生成，下方由 memory_distill 追加观察笔记。_\n`,
    "utf-8",
  );
}

function formatResult(result: DistillResult): string {
  const lines = [
    `## ${result.success ? "✅" : "❌"} ${result.summary}`,
    ``,
    `**文件**: ${result.personaPath}`,
    `**写入**: ${result.appended ? "是" : "否（dryRun 或未执行）"}`,
    ``,
  ];

  if (result.observations.length > 0) {
    lines.push(`### 观察内容`, ``, ...result.observations, ``);
  }

  return lines.join("\n");
}
