/**
 * features/setup/detector.ts — first-run self-check for agent guidance.
 *
 * v1.9.1: Detects the current configuration state and returns a structured
 * report so the agent (or the memory_setup tool) can decide whether to surface
 * the install guide. Designed to answer: "is yaoyao ready, and if not, what
 * should the user do next?"
 *
 * Pure detection — never blocks, never throws, never writes.
 */

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { CapabilityReport } from "../../utils/install-check.ts";

export interface SetupState {
  /** True when everything looks ready (no guidance needed). */
  ready: boolean;
  /** Detected run mode. */
  mode: "standalone" | "coexist";
  /** The slot owner when coexist (e.g. "memory-celia"), else "". */
  slotOwner: string;
  /** Findings, each with severity + a concrete next-step. */
  findings: SetupFinding[];
}

export interface SetupFinding {
  id: string;
  severity: "info" | "tip" | "warn";
  title: string;
  detail: string;
  /** Concrete action the user/agent can take. */
  action: string;
}

export interface DetectInput {
  /** Coexist mode from coexistence.ts. */
  coexistMode: "coexist" | "standalone" | "unknown";
  slotOwner: string;
  /** celiaBridge config block (may be absent). */
  celiaBridge?: { enabled?: boolean; mode?: string } | undefined;
  /** Whether embedding (vector search) is enabled. */
  embeddingEnabled: boolean;
  /** Whether LLM pipeline is enabled. */
  llmEnabled: boolean;
  /** Install capability report (node/db/vec). */
  cap: CapabilityReport;
  /** Memory base dir, to probe data volume. */
  memoryDir: string;
  /** Approximate memory count (0 = empty). -1 = unknown. */
  memoryCount: number;
}

/**
 * Run the setup self-check. Returns findings the agent can act on.
 * Never throws — any probe failure becomes an info finding.
 */
export function detectSetup(input: DetectInput): SetupState {
  const findings: SetupFinding[] = [];
  const mode: "standalone" | "coexist" = input.coexistMode === "coexist" ? "coexist" : "standalone";

  // ── 1. coexist without bridge guidance ──
  if (mode === "coexist") {
    const bridgeOn = input.celiaBridge?.enabled === true;
    if (!bridgeOn) {
      findings.push({
        id: "coexist-no-bridge",
        severity: "tip",
        title: `检测到 ${input.slotOwner || "官方插件"} 占用记忆槽位`,
        detail:
          `yaoyao 已自动进入共存模式（捕获/召回已禁用以避免与官方系统冲突）。` +
          `当前 40 个工具使用 yaoyao 独立存储。如需统一数据源或使用 dream/scene 等官方能力，` +
          `可开启 celiaBridge。`,
        action:
          `在 openclaw.json 的 yaoyao-memory.config 中添加：\n` +
          `  "celiaBridge": { "enabled": true, "mode": "delegate" }\n` +
          `（mode 可选 delegate 或 read-only，详见 docs/install-guide.md §六）`,
      });
    }
  }

  // ── 2. empty memory store ──
  if (input.memoryCount === 0) {
    findings.push({
      id: "empty-memory",
      severity: "tip",
      title: "记忆库为空",
      detail:
        `还没有任何记忆数据。yaoyao 会在对话中自动捕获，但首次使用时可能感觉"没有记忆"。` +
        `standalone 模式下对话结束后会自动落盘；coexist 模式下捕获已关闭，需手动或通过官方系统积累。`,
      action:
        `可手动测试：memory_save({content:"测试记忆"})，再用 memory_search 查询。` +
        `详见 docs/install-guide.md §四 验证步骤。`,
    });
  }

  // ── 3. vector search not enabled (degrades recall quality) ──
  if (!input.embeddingEnabled && input.cap.backend !== "file-db") {
    findings.push({
      id: "no-vector",
      severity: "tip",
      title: "向量搜索未启用",
      detail:
        `当前使用 FTS5 纯文本搜索。开启向量搜索可显著提升语义召回质量（如"咖啡"能召回"拿铁"）。`,
      action:
        `配置 embedding.enabled=true + apiKey。详见 docs/install-guide.md §五·2。`,
    });
  }

  // ── 4. capability warnings surfaced as findings ──
  for (const w of input.cap.warnings) {
    findings.push({
      id: "cap-warn",
      severity: "warn",
      title: "环境能力警告",
      detail: w,
      action: "按警告提示处理；不影响基本运行。",
    });
  }

  return {
    ready: findings.length === 0,
    mode,
    slotOwner: input.slotOwner,
    findings,
  };
}
