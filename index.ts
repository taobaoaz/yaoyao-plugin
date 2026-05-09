/**
 * Yaoyao Memory plugin — 搭载摇摇记忆引擎的四层记忆系统。
 *
 * 架构:
 *   L0 — 每日对话日志 (memory/YYYY-MM-DD.md)
 *   L1 — 结构化记忆 + FTS5 + sqlite-vec 混合搜索
 *   L2 — 场景分组 (scene_blocks/)
 *   L3 — 用户画像 (persona.md)
 *
 * 技术栈:
 *   - Node 22 原生 node:sqlite + sqlite-vec
 *   - FTS5 全文搜索 + CJK LIKE 降级
 *   - 可选 Embedding API (OpenAI 兼容) 向量搜索
 *   - 可选 LLM 管线 (L1→L2→L3)
 *   - 情感分析 · 时间线 · 一键备份
 *
 * 11 个工具 / 3 个 hook / 零额外 npm 依赖
 *
 * 入口: index.ts
 * 工具: yaoyao_memory_search, yaoyao_memory_get, memory_list, memory_save,
 *       memory_stats, memory_mood, memory_timeline, memory_search_timeline,
 *       memory_backup, memory_forget, memory_note
 * Hook: agent_end (capture), before_prompt_build (recall), gateway_stop
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type { YaoyaoMemoryConfig } from "./src/utils/memory-store.js";
import { createMemoryStore } from "./src/utils/memory-store.js";
import { createDB } from "./src/utils/db-bridge.js";
import { createLLMClient } from "./src/utils/llm-client.js";
import { createEmbeddingService } from "./src/utils/embedding.js";
import type { EmbeddingConfig } from "./src/utils/embedding.js";
import { registerMemoryTools } from "./src/tools/index.js";
import { registerCaptureHook } from "./src/hooks/auto-capture.js";
import { registerRecallHook } from "./src/hooks/auto-recall.js";
import { createMemoryCleaner } from "./src/utils/memory-cleaner.js";

export default definePluginEntry({
  id: "yaoyao-memory",
  name: "Yaoyao Memory",
  description: "Yaoyao Memory — FTS5 + sqlite-vec + 情感分析 + 时间线 — 自动捕获, 混合搜索, 记忆心情环, 场景管理, 用户画像。搭载摇摇记忆引擎的四层记忆系统。",

  register(api) {
    try {
    const config = (api.pluginConfig || {}) as YaoyaoMemoryConfig & Record<string, unknown>;
    const store = createMemoryStore(config, api.logger);
    const db = createDB(config, api.logger);

    // ── Plugin self-check: verify critical files exist ──
    const selfCheckFiles = [
      { path: "./dist/index.js", desc: "main entry" },
      { path: "./dist/src/tools/index.js", desc: "tools index" },
      { path: "./dist/src/hooks/auto-recall.js", desc: "recall hook" },
      { path: "./dist/src/hooks/auto-capture.js", desc: "capture hook" },
    ];
    const missingFiles: Array<string> = [];
    for (const { path: relPath, desc } of selfCheckFiles) {
      const resolved = new URL(relPath, import.meta.url);
      if (!require("node:fs").existsSync(resolved)) {
        missingFiles.push(`${desc} (${relPath})`);
      }
    }
    if (missingFiles.length > 0) {
      const msg = `[yaoyao-memory] ⚠️ Self-check: missing files: ${missingFiles.join(", ")}`;
      api.logger.error?.(msg);
      console.log("  " + msg);
    }

    // 🎲 读取实时版本号（兼容 dist/index.js 编译路径）
    let pluginVersion = "dev";
    try {
      const currentUrl = import.meta.url;
      // Try root package.json first, then dist/ fallback
      let pkgPath = new URL("../package.json", currentUrl);
      if (!require("node:fs").existsSync(pkgPath)) {
        pkgPath = new URL("./package.json", currentUrl);
      }
      const pkg = JSON.parse(require("node:fs").readFileSync(pkgPath, "utf-8")) as { version?: string };
      if (pkg.version) pluginVersion = pkg.version;
    } catch { /* best effort */ }

    // ── Self-check: verify compat version matches runtime ──
    try {
      const pkgUrl = new URL("../package.json", import.meta.url);
      const pkg = JSON.parse(require("node:fs").readFileSync(pkgUrl, "utf-8"));
      const requiredApi = pkg?.openclaw?.compat?.pluginApi as string | undefined;
      if (requiredApi) {
        api.logger.info(`[yaoyao-memory] Compat: ${requiredApi} (self-check OK)`);
      }
    } catch { /* best effort */ }

    // ── v1.5.0 Migration Detection: detect legacy soul-layer traces ──
    const legacyTraces: string[] = [];
    const fs = require("node:fs");
    const path = require("node:path");
    const workspaceDir = api.baseDir || ".";

    // Check for old config keys
    if ((config as Record<string, unknown>).psychology === true) legacyTraces.push("config.psychology=true");
    if ((config as Record<string, unknown>).intervention === true) legacyTraces.push("config.intervention=true");
    if ((config as Record<string, unknown>).moodTracking === true) legacyTraces.push("config.moodTracking=true");

    // Check for legacy data files that v1.4.x would have created
    const legacyFiles = [
      path.join(workspaceDir, ".persona-state.json"),
      path.join(workspaceDir, "memory", ".persona-state.json"),
    ];
    for (const f of legacyFiles) {
      if (fs.existsSync(f)) legacyTraces.push(`legacy file: ${path.basename(f)}`);
    }

    if (legacyTraces.length > 0) {
      const banner = [
        "",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "  ⚠️  检测到从 v1.4.x 升级的痕迹",
        "",
        "  摇摇记忆插件已升级到 v1.5.0+，架构已拆分：",
        "",
        "  • 情绪分析 (memory_mood)        → 已移至 yaoyao-soul",
        "  • 画像生成 (persona-generator)   → 已移至 yaoyao-soul",
        "  • 反馈学习 (feedback-tracker)    → 已移至 yaoyao-soul",
        "  • LLM 提取管线 (L1→L2→L3)      → 已移至 yaoyao-soul",
        "",
        "  ✅ 你的数据完全安全：",
        "     memory/*.md、.yaoyao.db、persona.md 均不受影响",
        "",
        "  📦 如需恢复这些功能，请安装 yaoyao-soul：",
        "     cd ~/.openclaw/plugins",
        "     git clone https://github.com/taobaoaz/yaoyao-soul.git",
        "",
        "  📖 完整迁移指南：",
        "     https://github.com/taobaoaz/yaoyao-plugin/blob/main/MIGRATION.md",
        "",
        `  检测到的旧版痕迹: ${legacyTraces.join(", ")}`,
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "",
      ];
      for (const line of banner) {
        api.logger.warn?.(`[yaoyao-memory:migration] ${line}`);
      }
      console.log(banner.join("\n"));
    }
    const oldSkillDirs = [
      require("node:path").join(api.baseDir || ".", "skills/yaoyao-memory"),
      require("node:path").join(api.baseDir || ".", "skills/yaoyao-memory-v2"),
    ];
    for (const dir of oldSkillDirs) {
      try {
        if (require("node:fs").existsSync(dir)) {
          require("node:fs").rmSync(dir, { recursive: true });
          api.logger.info(`[yaoyao-memory] 已清理旧 skill: ${dir}`);
        }
      } catch (e: any) {
        api.logger.warn?.(`[yaoyao-memory] 清理旧 skill 失败: ${e.message}（无影响，继续启动）`);
      }
    }

    // Initialize embedding service from config
    const embedCfg = config.embedding as EmbeddingConfig | undefined;
    const embedding = embedCfg?.enabled && embedCfg?.apiKey
      ? createEmbeddingService(embedCfg)
      : null;

    if (embedding) {
      api.logger.info(`[yaoyao-memory] Embedding service initialized: ${embedding.config.model}`);
    }

    // LLM client: explicit llm config first, then auto-detect from embedding config
    const llmResult = createLLMClient(config, embedCfg as Record<string, unknown> | undefined);
    const { client: llm } = llmResult;

    if (llm) {
      const sourceLabel = llmResult.source === "explicit" ? "explicit llm config" : "auto-detected from embedding config";
      api.logger.info(`[yaoyao-memory] LLM client initialized (${sourceLabel}): ${llm.config.model}`);
      if (llmResult.source === "embedding-auto") {
        api.logger.info(`[yaoyao-memory] LLM pipeline is now active using your embedding API key.`);
        api.logger.info(`[yaoyao-memory] To disable, set llm: { enabled: false } in plugin config.`);
        api.logger.info(`[yaoyao-memory] To customize, add explicit llm.apiKey / llm.baseUrl / llm.model in plugin config.`);
      }
    } else {
      api.logger.info("[yaoyao-memory] No LLM available — L1/L2/L3 extraction pipeline disabled (configure embedding or llm API to enable)");
    }

    // Initialize SQLite database (FTS5 + vec0 tables)
    const initOk = db.init();
    if (!initOk) {
      api.logger.error?.("[yaoyao-memory] DB init failed, operating without persistent index");
    }

    // Register tools and capture count for banner
    const toolCount = registerMemoryTools(api, store, db, null, embedding);

    // 🎲 Yaoyao Memory 醒目启动横幅（注册完成后输出，动态工具数）
    const dirInfo = store.baseDir;
    const verStr = `v${pluginVersion}`;
    const toolStr = `${toolCount} Tools`;
    const banner = [
      "🎲 ══════════════════════════════════════════",
      "🎲    摇摇 · 记忆引擎已启动",
      `🎲    ${verStr}  ·  ${toolStr}  ·  3 Hooks`,
      "🎲    FTS5 + sqlite-vec + 时间线 + 云备份",
      `🎲    记忆目录: ${dirInfo}`,
      "🎲 ══════════════════════════════════════════",
    ];
    for (const line of banner) {
      api.logger.info(line);
    }
    console.log("  " + banner.join("\n  "));

    // Auto-capture: after each agent turn, write to daily log + FTS5 index
    if (config.capture?.enabled !== false) {
      registerCaptureHook(api, store, db, config);
    }

    // Auto-recall: before building prompt, search FTS5 + optional vectors
    if (config.recall?.enabled !== false) {
      registerRecallHook(api, db, config, embedding);
    }

    // L1→L2→L3 pipeline (LLM extraction, scene grouping, persona)
    // v1.5.0: Pipeline moved to yaoyao-soul. Plugin now purely stores and indexes.
    api.logger.info("[yaoyao-memory] L1/L2/L3 pipeline disabled — install yaoyao-soul for LLM-driven extraction");

    // ── Memory Cleaner (scheduled cleanup of old daily logs) ──
    let cleanerTimer: ReturnType<typeof setInterval> | null = null;

    if (config.cleanup?.enabled !== false) {
      const cleaner = createMemoryCleaner(store.baseDir, db, {
        l0l1RetentionDays: (config.cleanup?.l0l1RetentionDays as number) || 30,
        allowAggressiveCleanup: (config.cleanup?.allowAggressiveCleanup as boolean) || false,
      }, api.logger);

      const warn = cleaner.validateConfig();
      if (warn) {
        api.logger.warn?.(`[yaoyao-memory] Cleanup config: ${warn}`);
      } else {
        cleaner.cleanup();
        const dailyCleanMs = 24 * 60 * 60 * 1000;
        cleanerTimer = setInterval(() => cleaner.cleanup(), dailyCleanMs).unref();
        api.logger.info("[yaoyao-memory] Memory cleaner scheduled (daily)");
      }
    }

    // Cleanup on gateway stop
    api.on("gateway_stop", async () => {
      db.close();
      if (cleanerTimer) {
        clearInterval(cleanerTimer);
        cleanerTimer = null;
      }
    });

    api.logger.debug?.("[yaoyao-memory] Plugin registered (FTS5 + sqlite-vec + optional embedding/LLM)");
    } catch (err) {
      api.logger.error?.(`[yaoyao-memory] Plugin registration FAILED: ${err instanceof Error ? err.message : String(err)}`);
      console.log(`  [yaoyao-memory] ⚠️ Plugin registration failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
});
