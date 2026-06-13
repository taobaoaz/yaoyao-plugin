import { clampNum } from "../../utils/clamp.js";
import { createAdapters, createAdapter } from "../../utils/cloud-adapter.js";
import { loadSecrets, getSecretsPath } from "../../utils/secrets-loader.js";
import { withErrorHandling } from "../../tools/common.js";
import { formatSyncResult, formatStatus } from "../../core/cloud/cloud.js";
import { loadSyncState, saveSyncState, doUpload, doDownload, doBidirectional, TEMPLATE, } from "./provider.js";
export function createCloudSyncTool(store) {
    return {
        id: "memory_cloud_sync",
        name: "memory_cloud_sync",
        label: "Cloud Sync",
        description: "☁️ 云备份同步 — 支持多种云服务(WebDAV/S3/SFTP/Samba)备份记忆数据。操作: status/upload/download/bidirectional/configure",
        parameters: {
            type: "object",
            properties: {
                action: {
                    type: "string",
                    enum: ["status", "upload", "download", "bidirectional", "configure"],
                    description: "操作: status=检查, upload=上传, download=下载, bidirectional=双向同步, configure=配置",
                },
                provider: {
                    type: "string",
                    enum: ["webdav", "s3", "sftp", "samba"],
                    description: "云服务类型，不指定则对所有已配置的服务执行",
                },
                dryRun: {
                    type: "boolean",
                    description: "预览模式，只显示会执行的操作，不实际传输",
                    default: false,
                },
                cmdTimeoutMs: {
                    type: "number",
                    description: "云命令超时（毫秒，默认 30000）",
                    default: 30000,
                },
                conflictPolicy: {
                    type: "string",
                    enum: ["newer", "keep_both"],
                    description: "双向同步冲突策略: newer=保留更新的文件, keep_both=保留双方",
                    default: "newer",
                },
            },
            required: ["action"],
        },
        execute: withErrorHandling(async (_id, params) => {
            const action = String(params.action);
            const provider = params.provider ? String(params.provider) : undefined;
            const dryRun = !!params.dryRun;
            const cmdTimeoutMs = clampNum(params.cmdTimeoutMs, 30_000, 3_000, 120_000);
            const conflictPolicy = String(params.conflictPolicy || "newer");
            const adapterOpts = {
                timeoutMs: cmdTimeoutMs,
                smbTimeoutMs: cmdTimeoutMs,
                mountTimeoutMs: cmdTimeoutMs,
                mountCheckTimeoutMs: Math.max(1_000, Math.min(30_000, cmdTimeoutMs / 3)),
            };
            // Status: just show configured services
            if (action === "status") {
                const { statuses } = createAdapters(undefined, adapterOpts);
                return { content: [{ type: "text", text: formatStatus(statuses) }] };
            }
            // Configure: show secrets file path + current config
            if (action === "configure") {
                const secretsPath = getSecretsPath();
                const secrets = loadSecrets();
                const keys = Object.keys(secrets);
                if (keys.length === 0) {
                    return { content: [{ type: "text", text: `📝 凭证文件路径: ${secretsPath}\n\n当前未配置任何凭证。模板:\n\n${TEMPLATE}` }] };
                }
                const { statuses } = createAdapters(undefined, adapterOpts);
                const lines = [`📝 凭证文件: ${secretsPath}`, "", "当前配置:"];
                for (const [key, value] of Object.entries(secrets)) {
                    const masked = key.includes("PASSWORD") || key.includes("SECRET") || key.includes("KEY") ? "****" : value;
                    lines.push(`  ${key}=${masked}`);
                }
                lines.push("", formatStatus(statuses));
                return { content: [{ type: "text", text: lines.join("\n") }] };
            }
            // Upload / Download / Bidirectional
            const { adapters, statuses } = createAdapters(undefined, adapterOpts);
            const configuredAdapters = [];
            if (provider) {
                const adapter = createAdapter(provider, undefined, adapterOpts) || adapters.get(provider);
                if (!adapter) {
                    return { content: [{ type: "text", text: `❌ 云服务 ${provider} 未配置。请先编辑 ${getSecretsPath()} 添加凭证。` }] };
                }
                configuredAdapters.push(adapter);
            }
            else {
                if (adapters.size === 0) {
                    return { content: [{ type: "text", text: `❌ 未检测到任何云服务配置。请先编辑 ${getSecretsPath()} 添加凭证。\n\n使用 configure 操作查看配置模板。` }] };
                }
                configuredAdapters.push(...adapters.values());
            }
            const results = [];
            const state = loadSyncState(store.baseDir);
            const options = { dryRun, conflictPolicy };
            for (const adapter of configuredAdapters) {
                try {
                    let syncResult;
                    switch (action) {
                        case "upload":
                            syncResult = await doUpload(adapter, store, options, state.lastSync);
                            break;
                        case "download":
                            syncResult = await doDownload(adapter, store, options);
                            break;
                        case "bidirectional":
                            syncResult = await doBidirectional(adapter, store, options);
                            break;
                        default:
                            return { content: [{ type: "text", text: `❌ 未知操作: ${action}` }] };
                    }
                    results.push(formatSyncResult(syncResult));
                }
                catch (err) {
                    results.push(`❌ [${adapter.provider}] 同步失败: ${err.message}`);
                }
            }
            if (!dryRun) {
                state.lastSync = Date.now();
                saveSyncState(store.baseDir, state);
            }
            const dryRunTag = dryRun ? " (预览模式)" : "";
            return { content: [{ type: "text", text: `☁️ 云同步完成${dryRunTag}\n\n${results.join("\n\n---\n\n")}` }] };
        }),
    };
}
