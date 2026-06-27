import { createSearchPipeline } from "../core/search/pipeline.js";
/* ── Search (use SearchPipeline) ────────────────── */
import { createSearchTool } from "../features/search/tool.js";
import { createGetTool } from "../features/get/tool.js";
import { createListTool } from "../features/list/tool.js";
import { createSearchTimelineTool } from "../features/search-timeline/tool.js";
import { createEnhancedSearchTool } from "../features/enhanced-search/tool.js";
/* ── Management ────────────────────────────────────── */
import { createSaveTool } from "../features/save/tool.js";
import { createNoteTool } from "../features/note/tool.js";
import { createForgetTool } from "../features/forget/tool.js";
import { createTagTool } from "../features/tag/tool.js";
import { createBackupTool } from "../features/backup/tool.js";
import { createExportTool } from "../features/export/tool.js";
import { createCloudSyncTool } from "../features/cloud-sync/tool.js";
import { createUnifyTool } from "../features/unify/tool.js";
/* ── Analysis ──────────────────────────────────────── */
import { createStatsTool } from "../features/stats/tool.js";
import { createTimelineTool } from "../features/timeline/tool.js";
import { createTrendsTool } from "../features/trends/tool.js";
import { createQualityTool } from "../features/quality/tool.js";
import { createRetainTool } from "../features/retain/tool.js";
import { createAnalyzeTool } from "../features/analyze/tool.js";
import { createGraphTool } from "../features/graph/tool.js";
/* ── Multi-signal search (mem0 v3 style) ────────── */
import { createMultiSignalSearchTool } from "../features/multi-signal/tool.js";
/* ── Structured MemoryCall search style ─── */
import { createMemoryCallTool } from "../features/memory-call/tool.js";
/* ── Cron management (v1.6.0+) ───────────────────── */
import { createCronTool } from "../features/cron/tool.js";
import { createImportTool } from "../features/import/tool.js";
import { createImportOCTool } from "../features/import-oc/tool.js";
import { createImportWorkspaceTool } from "../features/import-workspace/tool.js";
/* ── System ────────────────────────────────────────── */
import { createRecommendTool } from "../features/recommend/tool.js";
import { createRemindTool } from "../features/remind/tool.js";
import { createHealthcheckTool } from "../features/healthcheck/tool.js";
/* ── Conflict detection ─────────────────────────── */
import { createJudgeTool, createConflictsTool } from "../features/conflict/tool.js";
import { createAutoResolveTool } from "../features/auto-resolve/tool.js";
/* ── Anti-hallucination ───────────────────────────── */
import { createVerifyTool } from "../features/verify/tool.js";
/* ── Telemetry ─────────────────────────────────────── */
import { createTelemetryTool } from "../features/telemetry/tool.js";
/* ── Graph relations (Phase 1) ─────────────────────── */
import { createGraphRelationTool } from "../features/graph-relation/tool.js";
/* ── Atomic facts (Phase 2) ────────────────────────── */
import { createAtomicFactTool } from "../features/atomic-fact/tool.js";
/* ── Adaptive search (Phase 3) ─────────────────────── */
import { createAdaptiveSearchTool } from "../features/adaptive-search/tool.js";
/* ── Skill analytics (Phase 4) ────────────────────── */
import { createSkillAnalyticsTool } from "../features/skill-analytics/tool.js";
/* ── Benchmark (Phase 5) ───────────────────────────── */
import { createBenchmarkTool } from "../features/benchmark/tool.js";
/* ── Workspace files (v1.8.0) ─────────────────────── */
import { createWorkspaceTool } from "../features/workspace/tool.js";
/* ── Multimodal memory (v1.8.x hidden feature, gated by config) ── */
import { createMultimodalTool } from "../features/multimodal/tool.js";
import { recordAndClassify, resolveCurrentModel, isMultimodalCapable, } from "../utils/model-capabilities.js";
/* ── v1.9.1: memory-celia coexistence delegation ── */
import { isCeliaActive } from "../utils/coexistence.js";
import { getCeliaClient, resolveCeliaBinaryPath } from "../celia/client.js";
import { applyCeliaDelegation } from "../celia/delegate.js";
import { createCeliaProxyTools, createCeliaReadOnlyTool } from "../celia/proxy-tools.js";
import { CeliaDbReader } from "../celia/db-reader.js";
export function registerMemoryTools(api, store, db, storage, embedding, registry, config) {
    const tools = [];
    // Create SearchPipeline once, share across all search tools
    const safeStorage = storage ?? db;
    const pipeline = createSearchPipeline(safeStorage, embedding);
    /* ── Core tools (always registered) ── */
    tools.push(createSearchTool(pipeline), createMultiSignalSearchTool(db, embedding), createMemoryCallTool(safeStorage, embedding), createGetTool(store, db), createListTool(store), createSearchTimelineTool(pipeline), createSaveTool(store, db, true), createNoteTool(store, db), createForgetTool(store, db), createTagTool(store, db), createBackupTool(store), createExportTool(db), createImportTool(store), createImportOCTool(store, db), createImportWorkspaceTool(store, db), createStatsTool(store, db), createTimelineTool(db), createTrendsTool(store), createRecommendTool(db, store.baseDir), createRemindTool(), createHealthcheckTool(), createCronTool(api), createTelemetryTool({
        enabled: process.env.YAOYAO_TELEMETRY !== "0",
        url: process.env.YAOYAO_TELEMETRY_URL,
    }), 
    /* ── Phase 1-5: Advanced memory features ── */
    createGraphRelationTool(), createAtomicFactTool(), createAdaptiveSearchTool(), createSkillAnalyticsTool(), createBenchmarkTool(), createJudgeTool(db), createConflictsTool(db), 
    /* ── v1.9.0: Auto-resolve conflict pairs based on recency + source + access + importance ── */
    createAutoResolveTool(db), 
    /* ── v1.8.0: Workspace file access ── */
    createWorkspaceTool(store), 
    /* ── v1.8.3: memory_analyze placeholder (redirects to yaoyao-soul plugin) ── */
    createAnalyzeTool());
    /* ── Optional tools (gated by FeatureRegistry) ── */
    // Enhanced search — uses SearchPipeline, no longer needs raw embedding
    tools.push(createEnhancedSearchTool(pipeline));
    // Cloud sync
    if (registry?.isActive("cloud-sync")) {
        try {
            tools.push(createCloudSyncTool(store));
        }
        catch (e) {
            api.logger.warn?.(`[yaoyao-memory] Cloud sync tool skipped: ${e.message}`);
        }
    }
    // Unify (cross-backend status)
    try {
        tools.push(createUnifyTool(store));
    }
    catch (e) {
        api.logger.warn?.(`[yaoyao-memory] Unify tool skipped: ${e.message}`);
    }
    // Quality analysis
    if (registry?.isActive("quality") ?? true) {
        try {
            tools.push(createQualityTool(store, db));
        }
        catch (e) {
            api.logger.warn?.(`[yaoyao-memory] Quality tool skipped: ${e.message}`);
        }
    }
    // Retain check
    if (registry?.isActive("retain") ?? true) {
        try {
            tools.push(createRetainTool(store, db));
        }
        catch (e) {
            api.logger.warn?.(`[yaoyao-memory] Retain tool skipped: ${e.message}`);
        }
    }
    // Knowledge graph — requires scenes directory
    if (registry?.isActive("graph") ?? true) {
        try {
            tools.push(createGraphTool(db, store.baseDir, store.baseDir, embedding));
        }
        catch (e) {
            api.logger.warn?.(`[yaoyao-memory] Graph tool skipped: ${e.message}`);
        }
    }
    // Anti-hallucination verify
    if (registry?.isActive("verify") ?? true) {
        try {
            tools.push(createVerifyTool(db));
        }
        catch (e) {
            api.logger.warn?.(`[yaoyao-memory] Verify tool skipped: ${e.message}`);
        }
    }
    // v1.8.x: Multimodal memory — hidden feature, default off.
    if (config?.multimodal?.enabled === true) {
        // v1.8.3+: gate on the active LLM model. If it's not multimodal-capable,
        // silently skip registration and warn (standard OpenClaw users unaffected).
        const currentModel = resolveCurrentModel(config);
        if (!currentModel) {
            api.logger.warn?.(`[yaoyao-memory] multimodal.enabled=true but no LLM model resolved from config; ` +
                `memory_multimodal will not be registered. Configure llm.model or embedding.model.`);
        }
        else {
            const caps = recordAndClassify(store.baseDir, currentModel);
            if (!isMultimodalCapable(caps)) {
                api.logger.warn?.(`[yaoyao-memory] multimodal.enabled=true but active model "${currentModel}" is not ` +
                    `multimodal-capable (image=${caps.image}, audio=${caps.audio}, video=${caps.video}, ` +
                    `source=${caps.source}, note="${caps.note ?? ""}"). memory_multimodal will not be ` +
                    `registered. Switch to a multimodal model (gpt-4o, claude-3+, gemini-1.5+, qwen-vl, etc.) ` +
                    `to enable. Detection cached to model-capabilities.json.`);
            }
            else {
                try {
                    tools.push(createMultimodalTool({
                        storageDir: config.multimodal.storageDir,
                        maxFileSizeMb: config.multimodal.maxFileSizeMb,
                    }));
                    api.logger.info?.(`[yaoyao-memory] memory_multimodal enabled for model "${currentModel}" ` +
                        `(caps: image=${caps.image}, audio=${caps.audio}, video=${caps.video}, source=${caps.source})`);
                }
                catch (e) {
                    api.logger.warn?.(`[yaoyao-memory] Multimodal tool skipped: ${e.message}`);
                }
            }
        }
    }
    api.logger.info(`[yaoyao-memory] ${tools.length} tools prepared for registration`);
    // ── v1.9.1: celia coexistence bridge (three modes) ──
    // Active only when celia owns the slot AND celiaBridge.enabled=true.
    //   mode="delegate" (default): spawn celia MCP server, wrap overlapping tools
    //     to delegate, and add celia-unique proxy tools (dream/scene/global/flush).
    //   mode="read-only": NO spawn. Open celia's db read-only and expose a single
    //     memory_celia_browse tool. No writes, no process, safest.
    //   enabled=false: skipped entirely (standalone env or opt-out).
    const bridgeCfg = config.celiaBridge;
    const celiaActive = isCeliaActive();
    if (celiaActive && bridgeCfg?.enabled === true) {
        const mode = (bridgeCfg.mode ?? "delegate");
        if (mode === "read-only") {
            // ── read-only: no spawn, just open the db read-only ──
            try {
                const dbPath = CeliaDbReader.resolvePath(bridgeCfg.dbPath);
                const reader = new CeliaDbReader(dbPath, api.logger);
                tools.push(createCeliaReadOnlyTool(reader, api.logger));
                api.logger.info?.(`[yaoyao-memory] celia bridge READ-ONLY — memory_celia_browse registered (db: ${dbPath})`);
            }
            catch (e) {
                api.logger.warn?.(`[yaoyao-memory] celia read-only bridge skipped: ${e.message}`);
            }
        }
        else {
            // ── delegate: spawn + wrap + proxy ──
            const binPath = resolveCeliaBinaryPath(bridgeCfg.serverBinaryPath);
            if (binPath) {
                const client = getCeliaClient({ serverBinaryPath: binPath, logger: api.logger });
                const delegateCtx = { client, logger: api.logger };
                // Wrap overlapping tools with delegation (fallback-safe).
                applyCeliaDelegation(tools, delegateCtx).forEach((t, i) => { tools[i] = t; });
                // Append celia-unique proxy tools (only available through celia).
                try {
                    const proxyTools = createCeliaProxyTools(client, api.logger);
                    tools.push(...proxyTools);
                    api.logger.info?.(`[yaoyao-memory] celia bridge DELEGATE — ${proxyTools.length} proxy tools added, overlapping tools delegate to celia`);
                }
                catch (e) {
                    api.logger.warn?.(`[yaoyao-memory] celia proxy tools skipped: ${e.message}`);
                }
            }
            else {
                // Binary not found → auto-degrade to read-only so the bridge still adds value.
                api.logger.warn?.(`[yaoyao-memory] celia binary not found; auto-degrading bridge to read-only mode`);
                try {
                    const dbPath = CeliaDbReader.resolvePath(bridgeCfg.dbPath);
                    const reader = new CeliaDbReader(dbPath, api.logger);
                    tools.push(createCeliaReadOnlyTool(reader, api.logger));
                }
                catch { /* read-only also unavailable: bridge fully inactive */ }
            }
        }
    }
    let registeredCount = 0;
    for (const tool of tools) {
        try {
            api.registerTool(tool);
            registeredCount++;
        }
        catch (e) {
            api.logger.warn?.(`[yaoyao-memory] Failed to register tool "${tool.id || tool.name || "unknown"}": ${e.message}`);
        }
    }
    api.logger.info(`[yaoyao-memory] ${registeredCount}/${tools.length} tools registered successfully`);
    return registeredCount;
}
