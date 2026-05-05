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
import { registerPipelineManager } from "./src/hooks/pipeline-manager.js";
import { createMemoryCleaner } from "./src/utils/memory-cleaner.js";
import { PersonaStateMachine } from "./src/utils/persona-state.js";
import { FeedbackTracker } from "./src/learning/feedback-tracker.js";

export default definePluginEntry({
  id: "yaoyao-memory",
  name: "Yaoyao Memory",
  description: "Yaoyao Memory — FTS5 + sqlite-vec + 情感分析 + 时间线 — 自动捕获, 混合搜索, 记忆心情环, 场景管理, 用户画像。搭载摇摇记忆引擎的四层记忆系统。",

  register(api) {
    const config = (api.pluginConfig || {}) as YaoyaoMemoryConfig & Record<string, unknown>;
    const store = createMemoryStore(config, api.logger);
    const db = createDB(config, api.logger);

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

    // ── PersonaStateMachine (optional state tracking, best-effort) ──
    let psm: PersonaStateMachine | null = null;
    try {
      psm = new PersonaStateMachine(store.baseDir);
      psm.getState(); // load existing state (creates default if none)
      api.logger.info("[yaoyao-memory] PersonaStateMachine initialized");
    } catch (err: any) {
      api.logger.warn?.(`[yaoyao-memory] PersonaStateMachine skipped: ${err.message}`);
    }

    // ── FeedbackTracker (L4 feedback learning, best-effort) ──
    let feedbackTracker: FeedbackTracker | null = null;
    try {
      feedbackTracker = new FeedbackTracker(store.baseDir);
      api.logger.info("[yaoyao-memory] FeedbackTracker initialized (L4)");
    } catch (err: any) {
      api.logger.warn?.(`[yaoyao-memory] FeedbackTracker skipped: ${err.message}`);
    }

    // Register tools — search, get, list, save, stats, mood, timeline, search_timeline, memory_optimize
    registerMemoryTools(api, store, db, feedbackTracker);

    // Auto-capture: after each agent turn, write to daily log + FTS5 index + update state
    if (config.capture?.enabled !== false) {
      registerCaptureHook(api, store, db, config, psm);
    }

    // Auto-recall: before building prompt, search FTS5 + optional vectors + persona guidance
    if (config.recall?.enabled !== false) {
      registerRecallHook(api, db, config, embedding, psm, feedbackTracker);
    }

    // L1→L2→L3 pipeline (LLM extraction, scene grouping, persona)
    // Registered on same agent_end as capture, but throttled internally
    if (config.llm?.enabled !== false && llm) {
      registerPipelineManager(api, store, db, llm, config, embedding);
    }

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
  },
});
