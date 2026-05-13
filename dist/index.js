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
import { createMemoryStore } from "./src/utils/memory-store.js";
import { createDB } from "./src/utils/db-bridge.js";
import { createLLMClient } from "./src/utils/llm-client.js";
import { createEmbeddingService, detectEmbedModel } from "./src/utils/embedding.js";
import { registerMemoryTools } from "./src/tools/index.js";
import { registerCaptureHook } from "./src/hooks/auto-capture.js";
import { registerRecallHook } from "./src/hooks/auto-recall.js";
import { createMemoryCleaner } from "./src/utils/memory-cleaner.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
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
            // 注意：当插件运行 dist/index.js 时，import.meta.url 指向 dist/ 子目录
            // 因此检查自身文件需用 "./" 而非 "./dist/"
            const _selfUrl = import.meta.url;
            const selfCheckFiles = [
                { path: "./index.js", desc: "self (index.js)" },
                { path: "../dist/index.js", desc: "dist main entry" },
                { path: "../dist/src/tools/index.js", desc: "tools index" },
                { path: "../dist/src/hooks/auto-recall.js", desc: "recall hook" },
                { path: "../dist/src/hooks/auto-capture.js", desc: "capture hook" },
            ];
            const missingFiles = [];
            for (const { path: relPath, desc } of selfCheckFiles) {
                const resolved = new URL(relPath, _selfUrl);
                if (!fs.existsSync(resolved)) {
                    missingFiles.push(`${desc} (${relPath})`);
                }
            }
            if (missingFiles.length > 0) {
                const msg = `[yaoyao-memory] ⚠️ Self-check: missing files: ${missingFiles.join(", ")}`;
                api.logger.error?.(msg);
                console.log("  " + msg);
            }
            // 🎲 读取实时版本号 + 兼容性信息（兼容 dist/index.js 编译路径）
            let pluginVersion = "dev";
            let requiredApi;
            try {
                const currentUrl = import.meta.url;
                let pkgPath = new URL("../package.json", currentUrl);
                if (!fs.existsSync(pkgPath)) {
                    pkgPath = new URL("./package.json", currentUrl);
                }
                const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
                if (pkg.version)
                    pluginVersion = pkg.version;
                requiredApi = pkg?.openclaw?.compat?.pluginApi;
            }
            catch { /* best effort */ }
            if (requiredApi) {
                api.logger.info(`[yaoyao-memory] Compat: ${requiredApi} (self-check OK)`);
            }
            // ── v1.5.0 Migration Detection: detect legacy soul-layer traces ──
            const legacyTraces = [];
            const workspaceDir = api.baseDir || ".";
            // Check for old config keys
            if (config.psychology === true)
                legacyTraces.push("config.psychology=true");
            if (config.intervention === true)
                legacyTraces.push("config.intervention=true");
            if (config.moodTracking === true)
                legacyTraces.push("config.moodTracking=true");
            // Check for legacy data files that v1.4.x would have created
            const legacyFiles = [
                path.join(workspaceDir, ".persona-state.json"),
                path.join(workspaceDir, "memory", ".persona-state.json"),
            ];
            for (const f of legacyFiles) {
                if (fs.existsSync(f))
                    legacyTraces.push(`legacy file: ${path.basename(f)}`);
            }
            if (legacyTraces.length > 0) {
                // ── Attempt auto-migration: install yaoyao-soul automatically ──
                let autoMigrated = false;
                try {
                    const pluginsDir = path.dirname(path.dirname(require.resolve("openclaw/plugin-sdk/plugin-entry"))) || path.join(workspaceDir, "plugins");
                    const soulDir = path.join(pluginsDir, "yaoyao-soul");
                    if (!fs.existsSync(soulDir)) {
                        execSync("git clone https://github.com/taobaoaz/yaoyao-soul.git yaoyao-soul", { cwd: pluginsDir, stdio: "pipe", timeout: Math.max(5_000, Math.min(120_000, Number(config.migrationGitTimeoutMs) || 30_000)) });
                        autoMigrated = true;
                    }
                    else {
                        autoMigrated = true; // already exists
                    }
                }
                catch { /* auto-migration failed, fallback to manual */ }
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
                    ...(autoMigrated ? [
                        "  ✅ 已自动安装 yaoyao-soul 到 plugins 目录",
                        "",
                        "  📋 剩余步骤：",
                        "     1. 删除 openclaw.yaml 中的旧配置项：",
                        "        psychology, intervention, moodTracking",
                        "     2. 重启 OpenClaw Gateway",
                        "",
                    ] : [
                        "  📦 如需恢复这些功能，请安装 yaoyao-soul：",
                        "     cd ~/.openclaw/plugins",
                        "     git clone https://github.com/taobaoaz/yaoyao-soul.git",
                        "",
                    ]),
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
            // ── 旧 skill 配置迁移 + 安全清理 ──
            // 检测旧 yaoyao skill 中的自定义 JSON 配置，迁移到插件配置目录后整体删除
            const _skillsDir = path.join(os.homedir(), ".openclaw", "workspace", "skills");
            const _migratedDir = path.join(os.homedir(), ".openclaw", "extensions", "yaoyao-memory", ".skill-migrations");
            const oldSkillDirs = [
                { dir: path.join(_skillsDir, "yaoyao-memory"), name: "yaoyao-memory" },
                { dir: path.join(_skillsDir, "yaoyao-memory-v2"), name: "yaoyao-memory-v2" },
                { dir: path.join(_skillsDir, "yaoyao-cloud-backup"), name: "yaoyao-cloud-backup" },
            ];
            for (const { dir, name } of oldSkillDirs) {
                try {
                    try {
                        if (!fs.existsSync(dir))
                            continue;
                    }
                    catch {
                        continue;
                    }
                    const migrated = [];
                    // Step 1: collect all .json files before cleaning
                    const jsonFiles = [];
                    const walk = (d) => {
                        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
                            const full = path.join(d, e.name);
                            if (e.isDirectory())
                                walk(full);
                            else if (e.name.endsWith(".json"))
                                jsonFiles.push(full);
                        }
                    };
                    walk(dir);
                    // Step 2: copy each .json to migration archive dir (flat, prefixed by skill name)
                    if (jsonFiles.length > 0) {
                        fs.mkdirSync(_migratedDir, { recursive: true });
                        for (const jf of jsonFiles) {
                            const rel = path.relative(dir, jf);
                            const safeName = name + "__" + rel.replace(/[\\/]/g, "_");
                            const dest = path.join(_migratedDir, safeName);
                            if (!fs.existsSync(dest)) {
                                fs.copyFileSync(jf, dest);
                            }
                            migrated.push(rel);
                        }
                    }
                    // Step 3: delete the entire old skill directory (all content is safe to remove now)
                    fs.rmSync(dir, { recursive: true });
                    if (migrated.length > 0) {
                        api.logger.info(`[yaoyao-memory] 已迁移 ${migrated.length} 个配置文件并从 ${name} 转移（${_migratedDir}），旧目录已清理`);
                    }
                    else {
                        api.logger.info(`[yaoyao-memory] 已清理旧 skill: ${name}（无配置文件需迁移）`);
                    }
                }
                catch (e) {
                    api.logger.warn?.(`[yaoyao-memory] 清理旧 skill ${name} 失败: ${e.message}（无影响，继续启动）`);
                }
            }
            // Initialize embedding service from config
            const embedCfg = config.embedding;
            let embedding = null;
            if (embedCfg?.enabled && embedCfg?.apiKey) {
                // Auto-detect model if not provided
                const provider = String(embedCfg.provider || "openai").toLowerCase().trim();
                const customMap = (embedCfg.providerModels || {});
                const resolvedModel = embedCfg.model || detectEmbedModel(provider, customMap);
                const resolvedCfg = {
                    apiKey: embedCfg.apiKey,
                    baseUrl: embedCfg.baseUrl || "",
                    model: resolvedModel,
                    dimensions: embedCfg.dimensions ?? 1024,
                    timeoutMs: Number(embedCfg.timeoutMs) || 15_000,
                    retries: Number(embedCfg.retries) || 1,
                    maxInputChars: Number(embedCfg.maxInputChars) || 4_000,
                    backoffBaseMs: Number(embedCfg.backoffBaseMs) || 1_000,
                };
                embedding = createEmbeddingService(resolvedCfg);
            }
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
            }
            else {
                api.logger.info("[yaoyao-memory] No LLM available — L1/L2/L3 extraction pipeline disabled (configure embedding or llm API to enable)");
            }
            // Initialize SQLite database (FTS5 + vec0 tables)
            const initOk = db.init();
            if (!initOk) {
                api.logger.error?.("[yaoyao-memory] DB init failed, operating without persistent index");
            }
            // Register tools and capture count for banner
            const toolCount = registerMemoryTools(api, store, db, embedding);
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
            let cleanerTimer = null;
            if (config.cleanup?.enabled !== false) {
                const cleaner = createMemoryCleaner(store.baseDir, db, {
                    l0l1RetentionDays: config.cleanup?.l0l1RetentionDays,
                    allowAggressiveCleanup: config.cleanup?.allowAggressiveCleanup,
                }, api.logger);
                const warn = cleaner.validateConfig();
                if (warn) {
                    api.logger.warn?.(`[yaoyao-memory] Cleanup config: ${warn}`);
                }
                else {
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
        }
        catch (err) {
            api.logger.error?.(`[yaoyao-memory] Plugin registration FAILED: ${err instanceof Error ? err.message : String(err)}`);
            console.log(`  [yaoyao-memory] ⚠️ Plugin registration failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    },
});
