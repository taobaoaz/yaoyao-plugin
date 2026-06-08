import { scoreConfidenceSupport } from "../utils/confidence-scorer.js";
import { INTENT_WEIGHTS } from "../core/search/intent.js";
import { applyTimeDecay, applyScoring, applyDiversitySampling, applyMmrDiversity, filterByScope, accumulateKeywords, runRecallFilter, checkRepeatQuery, recordRecentQuery, } from "./recall-utils.js";
import { buildRecallContext, buildHookResult, makeSimpleTrace } from "./recall-formatter.js";
export async function doPostProcess(results, mode, userText, cfg, scopeManager, agentId, intent, resultCache, stats, startMs, audit, sessionKey, logger) {
    let processed = filterByScope(results, scopeManager, agentId);
    processed = applyTimeDecay(processed, cfg.halfLife, cfg.decayMode);
    processed = applyScoring(processed, userText);
    processed.sort((a, b) => b.score - a.score);
    if (cfg.enableIntentDriven && intent) {
        const weights = INTENT_WEIGHTS[intent];
        for (const r of processed) {
            const vecScore = typeof r.vectorScore === 'number'
                ? r.vectorScore
                : r.score;
            const ts = r.timestamp;
            const tempScore = ts ? Math.pow(0.5, (Date.now() - ts) / (30 * 24 * 60 * 60 * 1000)) : 0.5;
            r.score = weights.fts * r.score + weights.vector * vecScore + weights.temporal * tempScore;
        }
        processed.sort((a, b) => b.score - a.score);
    }
    if (cfg.enableMmr) {
        processed = applyMmrDiversity(processed, cfg.mmrLambda, cfg.maxResults);
    }
    else {
        processed = applyDiversitySampling(processed, cfg.jaccardBase, cfg.jaccardMin);
    }
    const limited = processed.slice(0, cfg.maxResults);
    const confidence = scoreConfidenceSupport(userText, userText);
    if (confidence.score < cfg.scoreThreshold) {
        logger.debug?.(`[yaoyao-memory:recall] Confidence ${confidence.score.toFixed(2)} < threshold ${cfg.scoreThreshold}`);
        return;
    }
    const filtered = await runRecallFilter(limited, userText, cfg);
    const recentQueries = [];
    const repeatNote = checkRepeatQuery(userText, cfg.maxResults, cfg.scoreThreshold, recentQueries);
    if (repeatNote) {
        logger.debug?.(`[yaoyao-memory:recall] ${repeatNote}`);
    }
    recordRecentQuery(userText, cfg.maxResults, cfg.scoreThreshold, filtered.length, recentQueries);
    accumulateKeywords(sessionKey, userText, cfg.maxContextKeywords);
    resultCache.set(`${agentId || 'default'}:${userText.slice(0, 120)}`, filtered);
    stats.recordQuery(makeSimpleTrace(userText, mode, startMs, results.length, filtered.length));
    if (audit && filtered.length > 0) {
        audit.record('recall', {
            query: userText,
            agentId,
            mode,
            results: filtered.length,
            durationMs: Date.now() - startMs,
            ...(repeatNote ? { repeatNote } : {}),
        });
    }
    if (filtered.length > 0) {
        return buildHookResult(buildRecallContext(filtered, cfg.maxContextChars), cfg.position);
    }
}
