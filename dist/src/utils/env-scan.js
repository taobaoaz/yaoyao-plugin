/**
 * EnvScan — runtime environment capability detection.
 *
 * Scans the host for available capabilities (FTS5, vector DB, LLM, cloud sync)
 * and produces a capability matrix for adaptive feature registration.
 */
import fs from "node:fs";
import path from "node:path";
export function scanEnvironment(logger) {
    const nodeVersion = process.version;
    const platform = process.platform;
    // FTS5: check if sqlite3 was compiled with FTS5
    let fts5 = false;
    try {
        const sqlite3 = require("sqlite3");
        const db = new sqlite3.Database(":memory:");
        db.exec("CREATE VIRTUAL TABLE test USING fts5(a)");
        db.close();
        fts5 = true;
    }
    catch {
        fts5 = false;
    }
    // Vector: check for sqlite-vec or hnswlib availability
    let vector = false;
    try {
        require("sqlite-vec");
        vector = true;
    }
    catch {
        try {
            require("hnswlib-node");
            vector = true;
        }
        catch {
            vector = false;
        }
    }
    // LLM: check for openai or compatible client
    let llm = false;
    try {
        require("openai");
        llm = true;
    }
    catch {
        llm = false;
    }
    // Cloud sync: check for common cloud SDKs
    let cloudSync = false;
    const cloudModules = ["aws-sdk", "@aws-sdk/client-s3", "webdav", "ssh2", "smb2"];
    for (const mod of cloudModules) {
        try {
            require(mod);
            cloudSync = true;
            break;
        }
        catch {
            // continue
        }
    }
    const matrix = {
        fts5,
        vector,
        llm,
        cloudSync,
        nodeVersion,
        platform,
    };
    logger?.info?.(`[yaoyao-memory:env] Capability matrix — FTS5:${fts5 ? "✅" : "❌"} Vec:${vector ? "✅" : "❌"} LLM:${llm ? "✅" : "❌"} Cloud:${cloudSync ? "✅" : "❌"} Node:${nodeVersion} Platform:${platform}`);
    return matrix;
}
/** Adaptive registration helper: skip features when dependencies are missing */
export function shouldRegisterFeature(featureName, required, matrix, logger) {
    const missing = required.filter((cap) => !matrix[cap]);
    if (missing.length > 0) {
        logger?.warn?.(`[yaoyao-memory:env] Skipping ${featureName} — missing: ${missing.join(", ")}`);
        return false;
    }
    return true;
}
// ──────────────────────────────────────────────
// Embedding source auto-detection (from beta P1)
// ──────────────────────────────────────────────
import os from "node:os";
/** Scan the environment for available embedding sources. */
export function scanEmbeddingSources() {
    const sources = [];
    // ── 1. OpenClaw global config: agents.defaults.memorySearch ──
    try {
        const globalConfigPath = path.join(os.homedir(), ".openclaw", "openclaw.json");
        if (fs.existsSync(globalConfigPath)) {
            const globalCfg = JSON.parse(fs.readFileSync(globalConfigPath, "utf-8"));
            const defaults = globalCfg.agents?.defaults;
            const memorySearchCfg = defaults?.memorySearch;
            const remote = memorySearchCfg?.remote;
            if (remote?.baseUrl && remote?.apiKey) {
                const provider = memorySearchCfg?.provider || "openai";
                const model = memorySearchCfg?.model || "unknown";
                const baseUrl = String(remote.baseUrl).replace(/\/v1$/, "");
                sources.push({
                    label: "OpenClaw built-in memorySearch (Kimi)",
                    source: "openclaw.json:agents.defaults.memorySearch",
                    provider,
                    baseUrl,
                    model,
                    hasAuth: true,
                    suggestedConfig: {
                        enabled: true,
                        baseUrl,
                        apiKey: remote.apiKey,
                        model,
                        authType: provider === "openai" ? "bearer" : "custom",
                    },
                });
            }
        }
    }
    catch { /* ignore scan failures */ }
    // ── 2. Environment variables ──
    const envVars = [
        { key: "OPENAI_API_KEY", label: "OpenAI", baseUrl: "https://api.openai.com", model: "text-embedding-3-small" },
        { key: "DEEPSEEK_API_KEY", label: "DeepSeek", baseUrl: "https://api.deepseek.com", model: "text-embedding" },
        { key: "KIMI_API_KEY", label: "Kimi", baseUrl: "https://api.moonshot.cn", model: "bge-m3" },
        { key: "AZURE_OPENAI_API_KEY", label: "Azure OpenAI", baseUrl: undefined, model: "text-embedding-ada-002" },
        { key: "SILICONFLOW_API_KEY", label: "SiliconFlow", baseUrl: "https://api.siliconflow.cn", model: "BAAI/bge-m3" },
        { key: "GITEE_AI_API_KEY", label: "Gitee AI", baseUrl: "https://ai.gitee.com", model: "bge-m3" },
    ];
    for (const ev of envVars) {
        const key = process.env[ev.key];
        if (key) {
            const suggestedConfig = { enabled: true, apiKey: key, model: ev.model };
            if (ev.baseUrl)
                suggestedConfig.baseUrl = ev.baseUrl;
            sources.push({
                label: `${ev.label} (env: ${ev.key})`,
                source: `env:${ev.key}`,
                provider: ev.label.toLowerCase().replace(/\s+/g, ""),
                baseUrl: ev.baseUrl || undefined,
                model: ev.model,
                hasAuth: true,
                suggestedConfig,
            });
        }
    }
    // ── 3. Other memory plugins in ~/.openclaw/extensions/ ──
    try {
        const extDir = path.join(os.homedir(), ".openclaw", "extensions");
        if (fs.existsSync(extDir)) {
            for (const entry of fs.readdirSync(extDir)) {
                const pluginJsonPath = path.join(extDir, entry, "openclaw.plugin.json");
                if (fs.existsSync(pluginJsonPath)) {
                    const manifest = JSON.parse(fs.readFileSync(pluginJsonPath, "utf-8"));
                    if (manifest.id === "yaoyao-memory" || manifest.id === "yaoyao-memory-v2")
                        continue;
                    const configSchema = manifest.configSchema;
                    if (configSchema?.embedding || configSchema?.vector) {
                        sources.push({
                            label: `Plugin: ${manifest.name || entry}`,
                            source: `plugin:${entry}`,
                            provider: manifest.id || entry,
                            hasAuth: false,
                            suggestedConfig: {},
                        });
                    }
                }
            }
        }
    }
    catch { /* ignore */ }
    return sources;
}
/** Check if this appears to be the first install (no .yaoyao.db yet). */
export function isFirstInstall(baseDir) {
    const dbPath = path.join(baseDir, ".yaoyao.db");
    return !fs.existsSync(dbPath);
}
/** Generate a human-readable setup guide from detected sources. */
export function generateSetupGuide(sources, currentEmbeddingEnabled) {
    const lines = [];
    if (sources.length === 0) {
        lines.push("  📭 未检测到环境中的 Embedding 配置");
        lines.push("");
        lines.push("  💡 如需向量搜索，请配置 embedding 参数：");
        lines.push("     baseUrl, apiKey, model（当前支持 OpenAI/DeepSeek/Kimi/SiliconFlow/Gitee AI）");
        lines.push("     或小艺 Celia：authType=custom + customHeaders 自定义 Header");
        return lines;
    }
    lines.push(`  🔍 检测到 ${sources.length} 个可用 Embedding 源：`);
    for (const s of sources) {
        const authMark = s.hasAuth ? "✅ 有凭证" : "⚠️ 需手动配凭证";
        lines.push(`     • ${s.label} (${s.provider}, ${authMark})`);
    }
    lines.push("");
    if (currentEmbeddingEnabled) {
        lines.push("  ✅ 当前已启用 embedding，上述源可作为备选或并行后端（后续版本支持）");
    }
    else {
        lines.push("  💡 当前未启用 embedding。如需开启，在 openclaw.json 中添加：");
        lines.push("");
        const firstAuth = sources.find(s => s.hasAuth);
        if (firstAuth) {
            lines.push(`     plugins.entries.yaoyao-memory.config.embedding:`);
            for (const [k, v] of Object.entries(firstAuth.suggestedConfig)) {
                if (k === "apiKey")
                    lines.push(`       ${k}: "${String(v).slice(0, 8)}..."`);
                else
                    lines.push(`       ${k}: ${JSON.stringify(v)}`);
            }
            if (!firstAuth.suggestedConfig.baseUrl) {
                lines.push(`       baseUrl: "<需填写 ${firstAuth.label} 实例 URL>"`);
            }
        }
    }
    return lines;
}
