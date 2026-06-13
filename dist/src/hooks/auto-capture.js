/**
 * hooks/auto-capture.ts — Auto-capture orchestrator.
 *
 * v1.8.0: Channel/device context, device tool extraction, security-aware capture.
 */
import { clampNum } from "../utils/clamp.js";
import { appendSelfImprovementEntry } from "../utils/self-improvement.js";
import { compressTexts } from "../utils/session-compressor.js";
import { createWriteQueue } from "../utils/write-queue.js";
import { createCaptureDebouncer } from "../utils/capture-debouncer.js";
import { DedupEngine } from "../utils/dedup-engine.js";
import { getCoexistMode } from "../utils/coexistence.js";
import { detectChannelInfo } from "../utils/channel-detector.js";
import { extractDeviceInteractions } from "./capture-content.js";
import { getSecurityLevel } from "../utils/environment-detector.js";
import {
    shouldCaptureTurn, trackSessionActivity,
    getCaptureConfig, buildCaptureContext, estimateConversation,
    shouldSkipContent, handleMermaidOffload,
    runAntiHallucination, buildMetaObj,
    evaluateWatermark, createPersistHandlers,
} from "./capture-barrel.js";

export { extractContent, safeStringify } from "./capture-content.js";

const SENSITIVE_PATTERNS = [
    { re: /(?:sk-|pk-|ghp_|gho_|github_pat_)[a-zA-Z0-9]{20,}/g, replacement: "[REDACTED_TOKEN]" },
    { re: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}[:\s]+[a-zA-Z0-9]{8,}/g, replacement: "[REDACTED_CRED]" },
    { re: /(?:AKIA|ASIA)[A-Z0-9]{16}/g, replacement: "[REDACTED_KEY]" },
    { re: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----[\s\S]*?-----END/g, replacement: "[REDACTED_KEY]" },
];

function sanitizeForCapture(text) {
    let result = text;
    for (const { re, replacement } of SENSITIVE_PATTERNS) {
        result = result.replace(re, replacement);
    }
    return result;
}

export function registerCaptureHook(
    api, store, db, config, verifyActive = true,
    scopeManager, llmClient, audit, embedding,
) {
    const captureMode = config.capture?.mode || "async";

    // v1.8.0: Security-aware capture
    const securityLevel = getSecurityLevel();
    const isHardened = securityLevel === "hardened";
    const effectiveVerify = isHardened ? true : verifyActive;

    if (isHardened) {
        api.logger.info?.(`[yaoyao-memory] Security: hardened mode — content sanitization + forced verify active`);
    }

    api.logger.info?.(`[yaoyao-memory] auto-capture mode=${captureMode}${embedding ? " + vector" : ""}`);

    const persist = createPersistHandlers(api, db, store, embedding);

    const writeQueue = captureMode === "async"
        ? createWriteQueue(persist.flushBatch, api.logger, audit)
        : null;

    const debounceMs = clampNum(config.capture?.debounceMs ?? 3000, 3000, 500, 30000);
    const dedupEngine = new DedupEngine({ enabled: true, vectorThreshold: 0.80, textLookback: 10 });

    const captureDebouncer = createCaptureDebouncer(
        { debounceMs, maxDelayMs: 10000, maxQueueSize: 50 },
        async (batch) => {
            for (const item of batch) {
                try {
                    persist.writeDailyEntry(item.date, item.entry);
                } catch (e) {
                    api.logger.error?.(`[yaoyao-memory:debouncer] L0 write failed: ${e.message}`);
                }
            }
            if (getCoexistMode() === "coexist") {
                api.logger.debug?.("[yaoyao-memory:capture] Coexist mode — L0 only, skipping L1/L2");
                return;
            }
            if (writeQueue) {
                for (const item of batch) {
                    writeQueue.enqueue({
                        date: item.date, timestamp: item.timestamp,
                        userContent: item.userContent, asstContent: item.asstContent, meta: item.meta,
                    });
                }
            } else {
                await persist.flushBatch(batch.map(item => ({
                    userContent: item.userContent, asstContent: item.asstContent,
                    date: item.date, meta: item.meta,
                })));
            }
        },
    );

    api.on("agent_end", async (event, ctx) => {
        try {
            const e = event;
            const messages = (e.messages ?? []);
            if (!e.success) return;

            const sessionKey = ctx.sessionKey || "default";
            const agentId = api.agentId;
            const capCfg = getCaptureConfig(config);

            const filterResult = shouldCaptureTurn({ sessionKey, messages, agentId }, config);
            if (!filterResult.shouldCapture) {
                api.logger.debug?.(`[yaoyao-memory:capture] ${filterResult.skipReason}`);
                return;
            }

            const activity = trackSessionActivity(sessionKey, config);
            if (activity.shouldLogResume)
                api.logger.debug?.(`[yaoyao-memory:capture] Session ${sessionKey} resumed`);

            let date;
            if (config.tz) {
                try {
                    date = new Intl.DateTimeFormat("sv-SE", { timeZone: config.tz }).format(new Date());
                } catch {
                    date = new Date().toISOString().slice(0, 10);
                }
            } else {
                date = new Date().toISOString().slice(0, 10);
            }
            const timestamp = new Date().toISOString().slice(0, 19).replace("T", " ");

            const cctx = buildCaptureContext(messages, date, timestamp, capCfg.captureMaxLen);
            if (!cctx) return;
            cctx.sessionKey = sessionKey;
            cctx.agentId = agentId;

            const { convValue, texts } = estimateConversation(messages, capCfg.captureMaxLen);
            if (convValue < 0.2 && texts.length > 4) {
                api.logger.debug?.("[yaoyao-memory:capture] Low conversation value");
                return;
            }
            if (texts.length > 6)
                compressTexts(texts, capCfg.captureMaxLen * 3, { minTexts: 3, minScoreToKeep: 0.3 });

            const watermark = evaluateWatermark(messages, config);
            if (watermark.level !== "none") {
                api.logger.info?.(`[yaoyao-memory:capture] Watermark ${watermark.level} (${(watermark.ratio * 100).toFixed(1)}%)`);
                if (watermark.level === "emergency")
                    api.logger.warn?.("[yaoyao-memory:capture] Emergency — skipping FTS5/L1");
            }

            const skipCheck = shouldSkipContent(cctx.userContent, cctx.asstContent);
            if (skipCheck.skip) {
                audit?.write({ component: "auto-capture", event: `skipped-${skipCheck.reason}`, summary: `Skipped: ${skipCheck.reason}`, details: { sessionKey } });
                return;
            }

            // v1.8.0: Security-aware content sanitization
            let userContent = cctx.userContent;
            let indexableAsst = cctx.indexableAsst;
            if (isHardened) {
                userContent = sanitizeForCapture(userContent);
                indexableAsst = sanitizeForCapture(indexableAsst);
            }

            const { riskTag, specCheck, corrCheck } = runAntiHallucination(userContent, indexableAsst, effectiveVerify);
            handleMermaidOffload(store, sessionKey, userContent + "\n" + cctx.asstContent, capCfg.enableOffload, capCfg.offloadThreshold);

            // v1.8.0: Extract channel/device context and device interactions
            const channelInfo = detectChannelInfo(ctx);
            const deviceInteractions = extractDeviceInteractions(messages);
            const skillSource = _detectSkillSource(messages);

            const { meta } = await buildMetaObj(userContent, indexableAsst, scopeManager, agentId,
                specCheck, corrCheck, capCfg.enableL1, watermark.skipL1 || false,
                capCfg.brainMode, llmClient, api.logger, capCfg.maxMemoriesPerSession, config,
                { channelInfo, deviceInteractions: deviceInteractions.length > 0 ? deviceInteractions : undefined, skillSource });

            const dedupResult = await dedupEngine.check(
                (userContent + " " + indexableAsst).trim(), db, embedding, agentId,
            );
            if (dedupResult.isDuplicate) {
                api.logger.debug?.(`[yaoyao-memory:capture] Duplicate (stage=${dedupResult.stage}, conf=${dedupResult.confidence.toFixed(3)}): ${dedupResult.reason}`);
                return;
            }

            const entry = `\n### ${timestamp}\n**User:** ${userContent}${corrCheck.isCorrection ? " [纠正]" : ""}\n**AI:** ${cctx.asstContent}${riskTag}\n`;

            captureDebouncer.push({
                sessionKey, userContent, asstContent: indexableAsst,
                date, timestamp, meta, entry,
            });

            // v1.8.0: Log channel/device context when present
            if (channelInfo.channel !== "unknown" || channelInfo.deviceType !== "unknown") {
                api.logger.debug?.(`[yaoyao-memory:capture] Source: channel=${channelInfo.channel}, device=${channelInfo.deviceType}`);
            }
            if (deviceInteractions.length > 0) {
                api.logger.debug?.(`[yaoyao-memory:capture] Device interactions: ${deviceInteractions.length} (tools: ${deviceInteractions.map(d => d.tool).join(", ")})`);
            }

            api.logger.debug?.("[yaoyao-memory:capture] Captured to " + date);
        } catch (e2) {
            const errMsg = e2 instanceof Error ? e2.message : String(e2);
            api.logger.error?.(`[yaoyao-memory:capture] Error: ${errMsg}`);
            try {
                appendSelfImprovementEntry({
                    baseDir: config.memoryDir || ".",
                    type: "error",
                    summary: `Capture failed: ${errMsg.slice(0, 100)}`,
                    details: e2 instanceof Error ? e2.stack || errMsg : errMsg,
                    area: "capture",
                    source: "yaoyao-memory/auto-capture",
                }).catch(() => { });
            } catch { /* ignore */ }
        }
    });

    return {
        drain: async () => {
            await captureDebouncer.flushNow();
            if (writeQueue) await writeQueue.drain();
        },
    };
}

function _detectSkillSource(messages) {
    for (const msg of messages) {
        const meta = msg.meta;
        if (meta) {
            const skillName = (meta.skill) || (meta.skillName) || (meta.source);
            if (skillName && typeof skillName === "string") {
                const category = _classifySkill(skillName);
                return { name: skillName, category };
            }
        }
        const content = msg.content;
        if (Array.isArray(content)) {
            for (const part of content) {
                if (part && typeof part === "object") {
                    const partMeta = part.meta;
                    const skillName = partMeta?.skill;
                    if (skillName) {
                        return { name: skillName, category: _classifySkill(skillName) };
                    }
                }
            }
        }
    }
    return undefined;
}

function _classifySkill(name) {
    const lower = name.toLowerCase();
    if (lower.includes("xiaoyi") || lower.includes("harmony") || lower.includes("hongmeng")) return "xiaoyi";
    if (lower.includes("guardian") || lower.includes("validator") || lower.includes("scope") || lower.includes("audit")) return "security";
    return "general";
}