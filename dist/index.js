// Auto-synced from index.ts by sync-dist.mjs — review if issues arise
/**
 * Yaoyao Memory plugin — 搭载摇摇记忆引擎的四层记忆系统。
 *
 * 架构:
 * L0 — 每日对话日志 (memory/YYYY-MM-DD.md)
 * L1 — 结构化记忆 + FTS5 + sqlite-vec 混合搜索
 * L2 — 场景分组 (scene_blocks/)
 * L3 — 用户画像 (persona.md)
 *
 * 技术栈:
 * - Node 22 原生 node:sqlite + sqlite-vec
 * - FTS5 全文搜索 + CJK LIKE 降级
 * - 可选 Embedding API (OpenAI 兼容) 向量搜索
 * - 可选 LLM 管线 (L1→L2→L3)
 * - 情感分析 · 时间线 · 一键备份
 *
 * 24+ 个工具 / 3 个 hook / 零额外 npm 依赖
 *
 * 入口: index.ts
 * 工具: yaoyao_memory_search, yaoyao_memory_get, memory_list, memory_save,
 * memory_stats, memory_mood, memory_timeline, memory_search_timeline,
 * memory_backup, memory_forget, memory_note
 * Hook: agent_end (capture), before_prompt_build (recall), gateway_stop
 */

import { createRequire } from "node:module";
const _require = createRequire(import.meta.url);
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { createMemoryStore } from "./src/utils/memory-store.js";
import { createDB } from "./src/utils/db-bridge.js";
import { createLLMClient } from "./src/utils/llm-client.js";
import { createEmbeddingService } from "./src/utils/embedding.js";
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
    try {
 const config = (api.pluginConfig || {});
 const store = createMemoryStore(config, api.logger);
 const db = createDB(config, api.logger);

 // ── Plugin self-check: verify critical files exist ──
 const selfCheckFiles = [
 { path: "./dist/index.js", desc: "main entry" },
 { path: "./dist/src/tools/index.js", desc: "tools index" },
 { path: "./dist/src/hooks/auto-recall.js", desc: "recall hook" },
 { path: "./dist/src/hooks/auto-capture.js", desc: "capture hook" },
 ];
 const missingFiles = [];
 for (const { path: relPath, desc } of selfCheckFiles) {
 const resolved = new URL(relPath, import.meta.url);
 if (!fs.existsSync(resolved)) {
 missingFiles.push(`${desc} (${relPath})`);
 }
 }
 if (missingFiles.length > 0) {
 const msg = `[yaoyao-memory] ⚠️ Self-check: missing files: ${missingFiles.join(", ")}`;
 api.logger.error?.(msg);
 console.log(" " + msg);
 }

 // 🎲 读取实时版本号（兼容 dist/index.js 编译路径）
 let pluginVersion = "dev";
 let pluginApiReq = "unknown";
 try {
 const currentUrl = import.meta.url;
 let pkgPath = new URL("../package.json", currentUrl);
 if (!fs.existsSync(pkgPath)) {
 pkgPath = new URL("./package.json", currentUrl);
 }
 const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
 if (pkg.version) pluginVersion = pkg.version;
 if (pkg?.openclaw?.compat?.pluginApi) pluginApiReq = pkg.openclaw.compat.pluginApi;
 } catch { /* best effort */ }

 // ── 环境检测 ──
 const nodeMajor = parseInt(process.version.slice(1).split('.')[0], 10);
 let hasNodeSqlite = false;
 try { _require('node:sqlite'); hasNodeSqlite = true; } catch {}
 let hasSqliteVec = false;
 try { _require('sqlite-vec'); hasSqliteVec = true; } catch {}

 // 兼容性检查
 if (!hasNodeSqlite) {
 const msg = nodeMajor < 22
 ? `⛔ Node.js ${process.version} 不支持 node:sqlite（需要 >= 22）。数据库功能不可用。`
 : `⛔ node:sqlite 不可用（未知原因）。数据库功能可能受影响。`;
 api.logger.error?.(`[yaoyao-memory] ${msg}`);
 console.log(`  [yaoyao-memory] ${msg}`);
 }
 if (!hasSqliteVec && hasNodeSqlite) {
 api.logger.info("[yaoyao-memory] ⚪ sqlite-vec 未安装，向量搜索不可用，降级为 FTS5 纯文本搜索");
 }
 api.logger.info(`[yaoyao-memory] Env: Node ${process.version} | ${process.platform}/${process.arch} | sqlite:${hasNodeSqlite} vec:${hasSqliteVec} | API:${pluginApiReq}`);

 // 🗑️ 自动检测并清理旧 yaoyao-memory skill 目录（supersedes 继承）
 const oldSkillDirs = [
 path.join(api.baseDir || ".", "skills/yaoyao-memory"),
 path.join(api.baseDir || ".", "skills/yaoyao-memory-v2"),
 ];
 for (const dir of oldSkillDirs) {
 try {
 if (fs.existsSync(dir)) {
 fs.rmSync(dir, { recursive: true });
 api.logger.info(`[yaoyao-memory] 已清理旧 skill: ${dir}`);
 }
 } catch (e) {
 api.logger.warn?.(`[yaoyao-memory] 清理旧 skill 失败: ${e.message}（无影响，继续启动）`);
 }
 }

 // Initialize embedding service from config
 const embedCfg = config.embedding;
 const embedding = embedCfg?.enabled && embedCfg?.apiKey
 ? createEmbeddingService(embedCfg)
 : null;

 if (embedding) {
 api.logger.info(`[yaoyao-memory] Embedding service initialized: ${embedding.config.model}`);
 }

 // LLM client: explicit llm config first, then auto-detect from embedding config
 const llmResult = createLLMClient(config, embedCfg);
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

 // Initialize SQLite database (FTS5 + vec0 tables) — use default dimensions first
 const initOk = db.init(1024);
 if (!initOk) {
 api.logger.error?.("[yaoyao-memory] DB init failed, operating without persistent index");
 }

 // ── 优化1: 异步探测 embedding 维度，必要时重建 vec0 表 ──
 if (embedding) {
 embedding.probe().then(probeResult => {
 if (probeResult.success && probeResult.dimensions !== 1024) {
 try {
 const d = db.ensureDB?.();
 if (d) {
 d.exec("DROP TABLE IF EXISTS memory_vec");
 d.exec(`CREATE VIRTUAL TABLE memory_vec USING vec0(embedding float[${probeResult.dimensions}])`);
 d.exec("DELETE FROM memory_vec_meta");
 api.logger.info(`[yaoyao-memory] Rebuilt vec0 table with dimensions=${probeResult.dimensions}`);
 }
 } catch (e) {
 api.logger.warn?.(`[yaoyao-memory] Failed to rebuild vec0: ${e.message}`);
 }
 } else if (probeResult.success) {
 api.logger.info(`[yaoyao-memory] Embedding dimensions: ${probeResult.dimensions} (matches default)`);
 } else {
 api.logger.warn?.(`[yaoyao-memory] Embedding probe failed: ${probeResult.error}`);
 }
 }).catch(() => {});
 }

 // ── 优化1: 环境探测与能力声明 ──
 const capabilities = {
 fts5: true,
 vectorSearch: !!embedding,
 llmPipeline: !!(config.llm?.enabled !== false && llm),
 l1Extraction: !!llm,
 l2SceneGrouping: !!llm,
 l3Persona: !!llm,
 cloudSync: !!(config.cloud?.enabled),
 sqliteVec: false,
 };
 try {
 const dbStats = db.getStats();
 capabilities.sqliteVec = !!(dbStats.vecEnabled && dbStats.totalVectors > 0);
 } catch { /* best effort */ }

 // ── 优化3: Embedding 熔断器（防止 API 故障拖慢响应） ──
 const embedCircuitBreaker = {
 failures: 0,
 lastFailure: 0,
 openUntil: 0,
 threshold: 3,
 resetMs: 60000,
 isOpen() {
 if (this.openUntil && Date.now() < this.openUntil) return true;
 if (this.openUntil && Date.now() >= this.openUntil) {
 this.failures = 0;
 this.openUntil = 0;
 }
 return false;
 },
 recordFailure() {
 this.failures++;
 this.lastFailure = Date.now();
 if (this.failures >= this.threshold) {
 this.openUntil = Date.now() + this.resetMs;
 }
 },
 recordSuccess() {
 this.failures = 0;
 this.openUntil = 0;
 },
 };

 // ── PersonaStateMachine (optional state tracking, best-effort) ──
 let psm = null;
 try {
 psm = new PersonaStateMachine(store.baseDir);
 psm.getState(); // load existing state (creates default if none)
 api.logger.info("[yaoyao-memory] PersonaStateMachine initialized");
 } catch (err) {
 api.logger.warn?.(`[yaoyao-memory] PersonaStateMachine skipped: ${err.message}`);
 }

 // ── FeedbackTracker (L4 feedback learning, best-effort) ──
 let feedbackTracker = null;
 try {
 feedbackTracker = new FeedbackTracker(store.baseDir);
 api.logger.info("[yaoyao-memory] FeedbackTracker initialized (L4)");
 } catch (err) {
 api.logger.warn?.(`[yaoyao-memory] FeedbackTracker skipped: ${err.message}`);
 }

 // Register tools and capture count for banner
 const toolCount = registerMemoryTools(api, store, db, feedbackTracker, embedding);

 // 🎲 Yaoyao Memory 醒目启动横幅（注册完成后输出，动态工具数）
 const dirInfo = store.baseDir;
 const verStr = `v${pluginVersion}`;
 const toolStr = `${toolCount} Tools`;
 const capLine = `🎲 能力: FTS5${capabilities.fts5 ? '✅' : '❌'} Vec${capabilities.vectorSearch || capabilities.sqliteVec ? '✅' : '⚪'} LLM${capabilities.llmPipeline ? '✅' : '⚪'} Cloud${capabilities.cloudSync ? '✅' : '⚪'}`;
 const envLine = `🎲 环境: Node ${process.version} | ${process.platform}/${process.arch} | sqlite:${hasNodeSqlite ? '✅' : '❌'} vec:${hasSqliteVec ? '✅' : '⚪'}`;
 const banner = [
 "🎲 ══════════════════════════════════════════",
 "🎲 摇摇 · 记忆引擎已启动",
 `🎲 ${verStr} · ${toolStr} · 3 Hooks`,
 capLine,
 envLine,
 `🎲 记忆目录: ${dirInfo}`,
 "🎲 ══════════════════════════════════════════",
 ];
 for (const line of banner) {
 api.logger.info(line);
 }
 console.log(" " + banner.join("\n "));

 // ── 优化7: API 兼容层 ──
 const hasAgentEnd = typeof api.on === 'function';
 const hasRegisterTool = typeof api.registerTool === 'function' || typeof api.tool === 'function';

 if (!hasAgentEnd) {
 api.logger.warn?.("[yaoyao-memory] Hooks not supported in this OpenClaw version, running in tool-only mode");
 }

 // Auto-capture: after each agent turn, write to daily log + FTS5 index + update state
 if (config.capture?.enabled !== false && hasAgentEnd) {
 registerCaptureHook(api, store, db, config, psm);
 } else if (!hasAgentEnd) {
 api.logger.info("[yaoyao-memory] Auto-capture disabled (hooks not available)");
 }

 // Auto-recall: before building prompt, search FTS5 + optional vectors + persona guidance
 if (config.recall?.enabled !== false && hasAgentEnd) {
 registerRecallHook(api, db, config, embedding, psm, feedbackTracker, embedCircuitBreaker);
 } else if (!hasAgentEnd) {
 api.logger.info("[yaoyao-memory] Auto-recall disabled (hooks not available)");
 }

 // ── 优化3: pipeline-manager 在无 LLM 时不注册 ──
 const llmEnabled = config.llm?.enabled !== false;
 if (llmEnabled && llm) {
 registerPipelineManager(api, store, db, llm, config, embedding);
 } else {
 api.logger.info("[yaoyao-memory] LLM pipeline disabled — L1/L2/L3 extraction skipped");
 }

 // ── Memory Cleaner (scheduled cleanup of old daily logs) ──
 let cleanerTimer = null;

 if (config.cleanup?.enabled !== false) {
 const cleaner = createMemoryCleaner(store.baseDir, db, {
 l0l1RetentionDays: (config.cleanup?.l0l1RetentionDays) || 30,
 allowAggressiveCleanup: (config.cleanup?.allowAggressiveCleanup) || false,
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
 if (hasAgentEnd) {
 api.on("gateway_stop", async () => {
 db.close();
 if (cleanerTimer) {
 clearInterval(cleanerTimer);
 cleanerTimer = null;
 }
 });
 }

 // ── 优化5: 全新安装引导 ──
 try {
 const existingFiles = store.listFiles().filter(f => f.type === "daily");
 if (existingFiles.length === 0) {
 const today = new Date().toISOString().slice(0, 10);
 const welcomeEntry = "\n### 欢迎使用 Yaoyao Memory\n🎉 这是你的第一条记忆！自动记录从这里开始。\n";
 store.appendToDaily(today, welcomeEntry);
 db.indexTurn("Yaoyao Memory 首次启动", "欢迎使用记忆系统", today);
 api.logger.info("[yaoyao-memory] First run detected, created welcome entry");
 }
 } catch (e) {
 api.logger.warn?.(`[yaoyao-memory] First-run detection failed: ${e.message}`);
 }

 // ── 环境接管检测（首次安装后提示）──
 try {
 const firstRunKey = "env_takeover_checked";
 if (!db.getConfig(firstRunKey, null)) {
 const takeoverHints = [];

 // 检测 OpenClaw 原生记忆
 const ocDbPath = path.join(os.homedir(), ".openclaw", "memory", "main.sqlite");
 if (fs.existsSync(ocDbPath)) {
 try {
 const { DatabaseSync } = _require("node:sqlite");
 const ocDb = new DatabaseSync(ocDbPath, { mode: "readonly" });
 const count = ocDb.prepare("SELECT COUNT(*) as c FROM chunks").get()?.c || 0;
 ocDb.close();
 if (count > 0) {
 takeoverHints.push(`📦 OpenClaw 原生记忆: ${count} 条 chunks 可导入（使用 memory_import_oc 工具）`);
 }
 } catch {}
 }

 // 检测 workspace 文件
 const workspaceDir = path.join(os.homedir(), ".openclaw", "workspace");
 const TARGET_FILES = ["MEMORY.md", "USER.md", "SOUL.md", "IDENTITY.md", "AGENTS.md", "TOOLS.md", "HEARTBEAT.md"];
 const mdFiles = TARGET_FILES.filter(f => fs.existsSync(path.join(workspaceDir, f)));
 if (mdFiles.length > 0) {
 takeoverHints.push(`📂 Workspace 文件: ${mdFiles.join(", ")} 可导入（使用 memory_import_workspace 工具）`);
 }

 // 检测旧 daily md
 const unindexedDaily = store.listFiles().filter(f => {
 if (f.type !== "daily") return false;
 const date = f.filename?.replace(".md", "");
 return date && !db.getConfig(`daily_reindex_${date}`, null);
 });
 if (unindexedDaily.length > 0) {
 takeoverHints.push(`📝 未索引日志: ${unindexedDaily.length} 个 daily 文件可重建索引`);
 }

 if (takeoverHints.length > 0) {
 const msg = `[yaoyao-memory] 🔔 检测到可接管的数据源:\n${takeoverHints.map(h => "  " + h).join("\n")}`;
 api.logger.info(msg);
 console.log(" " + msg);
 }

 db.setConfig(firstRunKey, "1");
 }
 } catch (e) {
 api.logger.warn?.(`[yaoyao-memory] Takeover detection failed: ${e.message}`);
 }

 // ── 重建索引已有 daily md 文件 ──
 try {
 const reindexedCount = store.reindexExistingDaily(db);
 if (reindexedCount > 0) {
 api.logger.info(`[yaoyao-memory] Reindexed ${reindexedCount} existing daily files into FTS5`);
 }
 } catch (e) {
 api.logger.warn?.(`[yaoyao-memory] Daily reindex failed: ${e.message}`);
 }

 api.logger.debug?.("[yaoyao-memory] Plugin registered (FTS5 + sqlite-vec + optional embedding/LLM)");
 } catch (err) {
      api.logger.error?.(`[yaoyao-memory] Plugin registration FAILED: ${err instanceof Error ? err.message : String(err)}`);
      console.log(`  [yaoyao-memory] ⚠️ Plugin registration failed: ${err instanceof Error ? err.message : String(err)}`);
    }
 },
});

