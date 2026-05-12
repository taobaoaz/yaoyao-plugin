import { detectSentiment } from "../utils/sentiment.js";
import { createSessionFilter } from "../utils/session-filter.js";
// ── Search result cache (30s TTL, prevents duplicate DB hits on repeated queries) ──
const resultCache = new Map();
const CACHE_TTL_MS = 30 * 1000;
const MAX_CACHE_SIZE = 50;
let cacheAccessCount = 0;
function getCachedResults(key) {
    cacheAccessCount++;
    // Periodic expired-entry cleanup (every 100 accesses)
    if (cacheAccessCount % 100 === 0) {
        const now = Date.now();
        for (const [k, v] of resultCache) {
            if (v.expires < now) resultCache.delete(k);
        }
    }
    const cached = resultCache.get(key);
    if (cached && cached.expires > Date.now())
        return cached.results;
    resultCache.delete(key);
    return null;
}
function setCachedResults(key, results) {
    if (resultCache.size >= MAX_CACHE_SIZE) {
        const now = Date.now();
        for (const [k, v] of resultCache) {
            if (v.expires < now || resultCache.size > MAX_CACHE_SIZE * 1.5)
                resultCache.delete(k);
        }
    }
    resultCache.set(key, { results, expires: Date.now() + CACHE_TTL_MS });
    // Keep a copy of the last successful non-empty result for short-message fallback
    if (results.length > 0) {
        resultCache.set("__last_nonempty__", { results, expires: Date.now() + CACHE_TTL_MS * 2 });
    }
}
/** Format human-friendly time-ago string from a date string (YYYY-MM-DD) */
function formatTimeAgo(dateStr, now) {
    if (!dateStr) return "未知时间";
    try {
        const d = new Date(dateStr + "T00:00:00Z");
        if (isNaN(d.getTime())) return dateStr;
        const days = Math.floor((now - d.getTime()) / 86400000);
        if (days < 0) return dateStr;
        if (days === 0) return "今天";
        if (days === 1) return "昨天";
        if (days < 7) return `${days}天前`;
        if (days < 30) return `${Math.floor(days / 7)}周前`;
        if (days < 365) return `${Math.floor(days / 30)}个月前`;
        return `${Math.floor(days / 365)}年前`;
    } catch {
        return dateStr;
    }
}

/** Clean source/import tag prefixes and HTML tags from snippet text */
function cleanSnippet(text) {
    try {
        return text
            .replace(/<\/?b>/g, "")
            .replace(/^\[(?:nas-import|oc-import|ws|rule-extracted|daily-note):[^\]]*\]\s*/gm, "")
            .replace(/^\[important\]\s*/gm, "⭐ ")
            .replace(/\s+/g, " ")
            .trim();
    } catch { return text; }
}

/** Format search results into recall text snippet with sentiment emoji and time-ago */
function formatRecallText(results) {
    const now = Date.now();
    return results.map(r => {
        const cleaned = cleanSnippet(r.snippet || "");
        const mood = detectSentiment(cleaned);
        const timeAgo = formatTimeAgo(r.date, now);
        const truncated = cleaned.length > 200 ? cleaned.slice(0, 200) + "…" : cleaned;
        return `[${timeAgo}] ${mood.emoji}\n${truncated}`;
    }).join("\n---\n");
}
/** Build the appendSystemContext object for return */
function buildRecallContext(results, guidance) {
    if (results.length === 0 && !guidance)
        return undefined;
    const parts = [];
    if (results.length > 0) {
        const recallText = formatRecallText(results);
        parts.push(`## 相关记忆（${results.length} 条）\n\n以下历史记忆与当前对话相关，可用来补充上下文。注意时间标记，优先参考近期记忆：\n\n${recallText}\n\n---\n请自然融入参考，不要逐条复述。`);
    }
    if (guidance) {
        parts.push(`## 交互引导\n\n${guidance}\n`);
    }
    if (parts.length === 0)
        return undefined;
    return { appendSystemContext: parts.join("\n") };
}
/** Build prependSystemContext for static system prompt rules (cached by provider) */
function buildPrependRules(config) {
    const rules = [];
    // 多模态记忆指令：开启 autoSaveImage 后，AI 自动将图片理解结果存入记忆
    const autoSaveImage = config.autoSaveImage === true;
    if (autoSaveImage) {
        rules.push("## 行为规则\n\n当用户发送图片或你通过任何方式获取到图片内容后，在回复用户之前，请调用 memory_save 工具，以 `[图片] 图片描述` 的格式将图片描述保存到记忆中。图片描述应为简洁的中文完整句子。");
    }
    return rules.length > 0 ? rules.join("\n\n") : undefined;
}
/** Merge append + prepend context into a single return value */
function buildHookResult(appendCtx, config) {
    if (!appendCtx && !config)
        return undefined;
    const prependSystemContext = buildPrependRules(config);
    if (!prependSystemContext)
        return appendCtx;
    return {
        prependSystemContext,
        appendSystemContext: appendCtx?.appendSystemContext || "",
    };
}
export function registerRecallHook(api, db, config, embedding, personaState, feedbackTracker, circuitBreaker) {
    api.logger.info(`[yaoyao-memory] Registering before_prompt_build hook (auto-recall${embedding ? ' + vector' : ''})`);
    // Create session filter with configured blockLabels
    const sessionFilter = createSessionFilter({
        blockLabels: config.blockLabels || [],
        blockInternal: true,
        minMessages: 1,
    });
    // ── Correction detection patterns (simple keyword/pattern matching) ──
    function detectCorrection(userMessage) {
        const lower = userMessage.toLowerCase();
        // Check for common correction patterns
        const correctionPatterns = [
            { patterns: ["不对", "不是", "错了", "不应该", "不是这样的"], tag: "memory" },
            { patterns: ["不要说", "别这么说", "语气不对", "别用"], tag: "tone" },
            { patterns: ["不相关", "没关系", "不是问这个"], tag: "relevance" },
            { patterns: ["太啰嗦", "太简洁", "说详细点", "简短点"], tag: "timing" },
        ];
        for (const { patterns, tag } of correctionPatterns) {
            if (patterns.some(p => lower.includes(p))) {
                return { isCorrection: true, tag };
            }
        }
        return null;
    }
    api.on("before_prompt_build", async (event, ctx) => {
        try {
            const startMs = Date.now();
            // Session filter: skip internal/system sessions
            const sessionKey = ctx.sessionKey || "default";
            if (!sessionFilter.shouldProcess(sessionKey)) {
                return;
            }
            const e = event;
            const userMessage = e?.message || e?.prompt;
            if (!userMessage || typeof userMessage !== "string" || userMessage.trim().length < 3) {
                return;
            }
            // ── L4 Feedback: detect user corrections and record them ──
            if (feedbackTracker && typeof userMessage === "string") {
                try {
                    const correction = detectCorrection(userMessage);
                    if (correction) {
                        feedbackTracker.record({
                            type: "correction",
                            original: userMessage.slice(0, 200),
                            tag: correction.tag,
                            context: `session: ${sessionKey}`,
                        });
                        api.logger.info(`[yaoyao-memory:feedback] Recorded correction (tag: ${correction.tag})`);
                    }
                }
                catch { /* best effort */ }
            }
            // Extract keywords for FTS5 query
            const keywords = extractKeywords(userMessage);
            if (keywords.length === 0) {
                // Short message: reuse last cached results if available
                if (userMessage.trim().length < 5) {
                    const cachedFallback = getCachedResults("__last_nonempty__");
                    if (cachedFallback) {
                        let guidance = "";
                        if (personaState && personaState.getState().confidence > 0.3) {
                            try { guidance = personaState.getGuidanceText(); } catch { /* best effort */ }
                        }
                        api.logger.debug?.("[yaoyao-memory:recall] Short message, reusing last cached results");
                        return buildHookResult(buildRecallContext(cachedFallback, guidance), config);
                    }
                }
                // Issue #20: All words are stopwords — fallback to most recent memory
                try {
                    const fallback = db.search("", 1);
                    if (fallback.length > 0) {
                        api.logger.debug?.("[yaoyao-memory:recall] No keywords, using most recent memory as fallback");
                        let guidance = "";
                        if (personaState && personaState.getState().confidence > 0.3) {
                            try { guidance = personaState.getGuidanceText(); } catch { /* best effort */ }
                        }
                        return buildHookResult(buildRecallContext(fallback, guidance), config);
                    }
                } catch { /* best effort */ }
                return;
            }
            const ftsQuery = keywords.join(" ");
            const maxResults = config.recall?.maxResults ?? 3;
            // Issue #9: Include search type in cache key to avoid mixing vector/FTS results
            const hasVectorSearch = userMessage.toLowerCase().includes("tsne") ||
                userMessage.toLowerCase().includes("向量") ||
                userMessage.toLowerCase().includes("embedding") ||
                userMessage.toLowerCase().includes("语义");
            const searchType = hasVectorSearch ? "hybrid" : (embedding ? "fts" : "fts");
            const cacheKey = `${searchType}:${ftsQuery}:${maxResults}`;
            // Check cache (30s TTL)
            const cached = getCachedResults(cacheKey);
            if (cached) {
                api.logger.debug?.("[yaoyao-memory:recall] Cache hit");
                // Compute guidance from persona state (always fresh)
                let guidance = "";
                if (personaState && personaState.getState().confidence > 0.3) {
                    try {
                        guidance = personaState.getGuidanceText();
                    }
                    catch { /* best effort */ }
                }
                return buildHookResult(buildRecallContext(cached, guidance), config);
            }
            // Build guidance text from persona state (best-effort, never blocks)
            let guidance = "";
            if (personaState && personaState.getState().confidence > 0.3) {
                try {
                    guidance = personaState.getGuidanceText();
                }
                catch { /* best effort */ }
            }
            // ── 优化4: Search strategy adaptive based on data volume ──
            let totalMemories = 0;
            let lastStatsTime = 0;
            function getTotalMemories() {
                const now = Date.now();
                if (now - lastStatsTime < 300000) return totalMemories; // 5min cache
                try {
                    const stats = db.getStats();
                    totalMemories = stats.totalMemories || 0;
                    lastStatsTime = now;
                } catch { /* best effort */ }
                return totalMemories;
            }

            // Adapt search params based on data volume
            const total = getTotalMemories();
            let adjustedMaxResults = maxResults;
            if (total < 50) {
                adjustedMaxResults = Math.max(maxResults, 5);
            } else if (total > 5000) {
                adjustedMaxResults = Math.min(maxResults, 3);
            }

            // Hybrid search: FTS5 + optional vector
            if (embedding && !circuitBreaker?.isOpen()) {
                try {
                    const vec = await embedding.embed(userMessage);
                    const results = db.hybridSearch(ftsQuery, vec, adjustedMaxResults);
                    if (results.length > 0) {
                        circuitBreaker?.recordSuccess();
                        setCachedResults(cacheKey, results);
                        api.logger.info(`[yaoyao-memory:recall] Found ${results.length} snippets (hybrid) in ${Date.now() - startMs}ms`);
                        return buildHookResult(buildRecallContext(results, guidance), config);
                    }
                }
                catch (vecErr) {
                    circuitBreaker?.recordFailure();
                    api.logger.debug?.(`[yaoyao-memory:recall] Vector failed (${circuitBreaker?.failures}/${circuitBreaker?.threshold}), FTS5 fallback: ${vecErr.message}`);
                }
            } else if (circuitBreaker?.isOpen()) {
                api.logger.debug?.("[yaoyao-memory:recall] Embedding circuit breaker open, skipping vector search");
            }
            // FTS5 search (with internal LIKE fallback for CJK)
            let results = db.search(ftsQuery, adjustedMaxResults);

            // ── 优化2: 无向量时，用原始消息补充搜索并合并去重 ──
            if (!embedding && results.length < maxResults && userMessage.length > 3) {
                try {
                    const rawMessage = userMessage.slice(0, 100);
                    const rawResults = db.search(rawMessage, maxResults);
                    for (const r of rawResults) {
                        if (results.length >= maxResults) break;
                        const isDup = results.some(e => e.snippet.slice(0, 50) === r.snippet.slice(0, 50));
                        if (!isDup) {
                            results.push(r);
                        }
                    }
                    if (rawResults.length > 0) {
                        api.logger.debug?.(`[yaoyao-memory:recall] Raw-message supplement added ${results.length - (results.length - rawResults.length)} results`);
                    }
                } catch { /* best effort */ }
            }

            if (results.length === 0) {
                api.logger.debug?.("[yaoyao-memory:recall] No relevant memories found");
                return;
            }
            // ── Time decay: 30-day half-life ──
            const now = Date.now();
            const HALF_LIFE_DAYS = 30;
            results = results.map(r => {
                if (!r.date) return r;
                try {
                    const recordDate = new Date(r.date + "T00:00:00Z");
                    const daysDiff = (now - recordDate.getTime()) / (1000 * 60 * 60 * 24);
                    const decayFactor = Math.pow(0.5, daysDiff / HALF_LIFE_DAYS);
                    return { ...r, score: r.score * decayFactor };
                } catch { return r; }
            });
            // ── Diversity dedup: same snippet prefix → keep highest score only ──
            const seen = new Map();
            results = results.filter(r => {
                const dedupeKey = r.snippet.slice(0, 50);
                if (seen.has(dedupeKey)) {
                    const existing = seen.get(dedupeKey);
                    if (r.score > existing.score) {
                        seen.set(dedupeKey, r);
                        return true;
                    }
                    return false;
                }
                seen.set(dedupeKey, r);
                return true;
            });
            setCachedResults(cacheKey, results);
            api.logger.info(`[yaoyao-memory:recall] Found ${results.length} snippets in ${Date.now() - startMs}ms`);
            return buildHookResult(buildRecallContext(results, guidance), config);
        }
        catch (err) {
            api.logger.error(`[yaoyao-memory:recall] Error: ${err instanceof Error ? err.message : String(err)}`);
        }
    });
}
function extractKeywords(text) {
    const cleaned = text.toLowerCase().replace(/[^\w\u4e00-\u9fff]/g, " ");
    const words = cleaned.split(/\s+/).filter(w => w.length > 1);
    const stopwords = new Set([
        "的", "了", "是", "在", "我", "有", "和", "就", "不", "人", "都", "一",
        "一个", "上", "也", "很", "到", "说", "要", "去", "你", "会", "着",
        "没有", "看", "好", "自己", "这", "那", "他", "她", "它", "们",
        "也", "吗", "吧", "呢", "啊", "哦", "哈", "嗯", "嘛", "哟",
        "还是", "或者", "但是", "因为", "所以", "如果", "虽然", "而且", "然后", "可以",
        // Japanese particles
        "は", "が", "を", "に", "で", "と", "の", "も", "へ", "から", "まで", "より",
        "です", "ます", "だ", "である", "する", "いる", "なる", "ない", "ある",
        // Korean particles
        "은", "는", "이", "가", "을", "를", "에", "에서", "로", "으로", "와", "과",
        "의", "도", "만", "부터", "까지", "하다", "있다", "없다", "되다",
        // English stopwords
        "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
        "have", "has", "had", "do", "does", "did", "will", "would", "can", "could",
        "shall", "should", "may", "might", "must", "i", "you", "he", "she", "it",
        "we", "they", "me", "him", "her", "us", "them", "this", "that", "these",
        "those", "and", "or", "but", "if", "because", "when", "where", "how",
        "what", "which", "who", "whom", "to", "of", "in", "for", "on", "with",
        "at", "by", "from", "as", "into", "not", "no", "yes",
    ]);
    const base = words.filter(w => !stopwords.has(w) && w.length < 30);
    // ── CJK bigram/trigram extraction ──
    // Find continuous CJK character sequences
    const cjkSequences = cleaned.match(/[\u4e00-\u9fff]{2,}/g) || [];
    for (const seq of cjkSequences) {
        if (seq.length >= 4) {
            // Generate all 2-char and 3-char combinations
            for (let i = 0; i + 1 < seq.length; i++) {
                const bigram = seq.slice(i, i + 2);
                if (!stopwords.has(bigram)) base.push(bigram);
            }
            for (let i = 0; i + 2 < seq.length; i++) {
                const trigram = seq.slice(i, i + 3);
                if (!stopwords.has(trigram)) base.push(trigram);
            }
        }
        else if (seq.length >= 2) {
            // 2-3 char sequences: use directly
            if (!stopwords.has(seq)) base.push(seq);
        }
    }
    // Deduplicate
    return [...new Set(base)];
}
