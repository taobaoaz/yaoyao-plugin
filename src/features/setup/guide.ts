/**
 * features/setup/guide.ts — render a SetupState into agent-facing text.
 *
 * Two render modes:
 *   - "prompt": a concise one-shot injected into the first conversation turn
 *     (via before_prompt_build). Short, actionable, non-repeating.
 *   - "tool": the full structured report returned by the memory_setup tool,
 *     for the agent to inspect and relay to the user on demand.
 */

import type { SetupState, SetupFinding } from "./detector.ts";

const GUIDE_PATH = "docs/install-guide.md";

/** Concise prompt for first-conversation auto-injection. */
export function renderSetupPrompt(state: SetupState): string {
  if (state.ready) return "";

  const lines: string[] = [];
  lines.push("🎲 [yaoyao-memory 首次使用提示]");
  lines.push(`当前模式：${state.mode === "coexist" ? `共存（槽位被 ${state.slotOwner} 占用）` : "独立运行"}`);
  lines.push("");

  // Only surface tips/warns that matter for first use; cap at 3.
  const actionable = state.findings
    .filter((f) => f.severity !== "info")
    .slice(0, 3);

  for (const f of actionable) {
    lines.push(`• ${f.title}`);
    // action's first line is the concrete instruction
    const firstActionLine = f.action.split("\n")[0];
    lines.push(`  → ${firstActionLine}`);
  }

  lines.push("");
  lines.push(`完整安装向导：${GUIDE_PATH}`);
  lines.push(`（如需复查配置状态，可调用 memory_setup 工具）`);
  return lines.join("\n");
}

/** Full structured report for the memory_setup tool. */
export function renderSetupReport(state: SetupState): string {
  const lines: string[] = [];
  lines.push("# yaoyao-memory 配置自检报告");
  lines.push("");
  lines.push(`- 运行模式: ${state.mode === "coexist" ? `共存（${state.slotOwner} 占槽）` : "独立运行（standalone）"}`);
  lines.push(`- 状态: ${state.ready ? "✅ 就绪，无需额外配置" : "⚠️ 有可优化项（见下）"}`);
  lines.push(`- 自检项: ${state.findings.length} 条`);
  lines.push("");

  if (state.ready) {
    lines.push("所有检查通过。yaoyao 已按当前环境最佳方式运行。");
    return lines.join("\n");
  }

  const order: SetupFinding["severity"][] = ["warn", "tip", "info"];
  const sorted = [...state.findings].sort(
    (a, b) => order.indexOf(a.severity) - order.indexOf(b.severity),
  );

  for (const f of sorted) {
    const icon = f.severity === "warn" ? "⚠️" : f.severity === "tip" ? "💡" : "ℹ️";
    lines.push(`## ${icon} ${f.title}`);
    lines.push("");
    lines.push(f.detail);
    lines.push("");
    lines.push("**建议操作：**");
    lines.push("```");
    lines.push(f.action);
    lines.push("```");
    lines.push("");
  }

  lines.push("---");
  lines.push(`完整文档：${GUIDE_PATH}`);
  return lines.join("\n");
}
