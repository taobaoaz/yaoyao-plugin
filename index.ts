/**
 * Yaoyao Memory plugin — Four-layer memory system for OpenClaw.
 *
 * v2 Architecture:
 *   L0 — Daily Markdown logs (memory/YYYY-MM-DD.md) — backward compatible
 *   L1 — Structured memories + FTS5 index + sqlite-vec vector search (.yaoyao.db)
 *   L2 — Scene blocks (contextual groupings)
 *   L3 — Long-term persona (MEMORY.md)
 *
 * Key improvements:
 *   - Native Node.js SQLite (node:sqlite) + sqlite-vec vector search
 *   - FTS5 full-text search
 *   - Optional remote Embedding API (OpenAI-compatible) for semantic search
 *   - Optional LLM pipeline for memory extraction, scene grouping, persona
 *   - Zero extra npm deps, zero Python
 *
 * Tools: yaoyao_memory_search(FTS5/vector/hybrid), yaoyao_memory_get, memory_list, memory_save, memory_stats
 * Hooks: agent_end (auto-capture), before_prompt_build (auto-recall), gateway_stop
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
import { createBackupManager } from "./src/utils/backup.js";
import { createSessionFilter } from "./src/utils/session-filter.js";
import { createMemoryCleaner } from "./src/utils/memory-cleaner.js";

export default definePluginEntry({
  id: "yaoyao-memory",
  name: "Yaoyao Memory",
  description: "Yaoyao Memory — FTS5 + sqlite-vec + 情感分析 + 时间线 — 自动捕获, 混合搜索, 记忆心情环, 场景管理, 用户画像。搭载摇摇记忆引擎的四层记忆系统。",

  register(api) {
    const config = (api.pluginConfig || {}) as YaoyaoMemoryConfig & Record<string, unknown>;
    const store = createMemoryStore(config, api.logger);
    const db = createDB(config, api.logger);
    const llm = createLLMClient(config);
    
    // Initialize embedding service from config
    const embedCfg = config.embedding as EmbeddingConfig | undefined;
    const embedding = embedCfg?.enabled && embedCfg?.apiKey
      ? createEmbeddingService(embedCfg)
      : null;

    if (embedding) {
      api.logger.info(`[yaoyao-memory] Embedding service initialized: ${embedding.config.model}`);
    }
    if (llm) {
      api.logger.info("[yaoyao-memory] LLM client initialized for extraction pipeline");
    }

    // Initialize SQLite database (FTS5 + vec0 tables)
    const initOk = db.init();
    if (!initOk) {
      api.logger.error?.("[yaoyao-memory] DB init failed, operating without persistent index");
    }

    // Register 5 tools: yaoyao_memory_search, yaoyao_memory_get, memory_list, memory_save, memory_stats
    registerMemoryTools(api, store, db);

    // Auto-capture: after each agent turn, write to daily log + FTS5 index
    if (config.capture?.enabled !== false) {
      registerCaptureHook(api, store, db, config);
    }

    // Auto-recall: before building prompt, search FTS5 + optional vectors
    if (config.recall?.enabled !== false) {
      registerRecallHook(api, db, config, embedding);
    }

    // L1→L2→L3 pipeline (LLM extraction, scene grouping, persona)
    if (config.llm?.enabled !== false && llm) {
      registerPipelineManager(api, store, db, llm, config, embedding);
    }

    // ── Backup Manager (optional, no-op unless create/restore called) ──
    const backup = createBackupManager(store.baseDir, api.logger);

    // ── Session Filter (filters system sessions from capture/recall) ──
    const sessionFilter = createSessionFilter({
      blockInternal: true,
      blockLabels: config.blockLabels as string[] | undefined,
      minMessages: 2,
    });

    // ── Memory Cleaner (scheduled cleanup of old daily logs) ──
    if (config.cleanup?.enabled !== false) {
      const cleaner = createMemoryCleaner(store.baseDir, db, {
        l0l1RetentionDays: (config.cleanup?.l0l1RetentionDays as number) || 30,
        allowAggressiveCleanup: (config.cleanup?.allowAggressiveCleanup as boolean) || false,
      }, api.logger);

      const warn = cleaner.validateConfig();
      if (warn) {
        api.logger.warn?.(`[yaoyao-memory] Cleanup config: ${warn}`);
      } else {
        // Run cleanup on plugin start, then once daily
        cleaner.cleanup();
        const dailyCleanMs = 24 * 60 * 60 * 1000;
        setInterval(() => cleaner.cleanup(), dailyCleanMs).unref();
        api.logger.info("[yaoyao-memory] Memory cleaner scheduled (daily)");
      }
    }

    // Expose backup/sessionFilter for external use via api
    (api as any).__yaoyaoMemoryUtils = { backup, sessionFilter };

    // Cleanup on gateway stop
    api.on("gateway_stop", async () => {
      db.close();
    });

    api.logger.debug?.("[yaoyao-memory] Plugin registered (FTS5 + sqlite-vec + optional embedding/LLM)");
  },
});
