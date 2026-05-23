/**
 * L1 Extractor — Atomic fact extraction via LLM (Tencent-style)
 *
 * Extracts structured atomic facts from a conversation turn:
 * - facts: objective observations
 * - preferences: user likes/dislikes
 * - tasks: action items or TODOs
 * - identity: user self-description
 * - events: temporal happenings
 *
 * brainMode: "lite" skips LLM, uses regex heuristics (zero-dep)
 * brainMode: "full" uses LLM for high-quality extraction
 */
const L1_SYSTEM_PROMPT = `You are a memory extraction engine. Given a conversation turn, extract atomic facts.

Rules:
1. Only extract facts the user explicitly stated or strongly implied
2. Do NOT infer, guess, or hallucinate
3. Each fact must be self-contained (no "he", "it", "this" references)
4. Confidence: 1.0 = explicit, 0.8 = strongly implied, 0.5 = weakly implied

Output JSON:
{
  "facts": [
    {"type": "fact|preference|task|identity|event|correction", "content": "...", "confidence": 0.9}
  ]
}

If nothing extractable, return {"facts": []}.`;
/** Lightweight heuristic extraction (zero-dep fallback) */
export function extractHeuristic(userText, asstText, logger) {
    logger?.debug?.("[l1-debug] RESOLVE heuristic mode");
    const facts = [];
    const combined = (userText + " " + asstText).trim();
    // Identity patterns
    const identityPatterns = [
        /我是(.+?)[，。！]/,
        /我叫(.+?)[，。！]/,
        /我的名字是(.+?)[，。！]/,
        /I am (.+?)[,.!]/,
        /My name is (.+?)[,.!]/,
    ];
    for (const p of identityPatterns) {
        const m = combined.match(p);
        if (m) {
            facts.push({ type: "identity", content: `User identifies as: ${m[1].trim()}`, confidence: 0.9, source: "heuristic" });
        }
    }
    // Preference patterns
    const prefPatterns = [
        /我喜欢(.+?)[，。！]/,
        /我爱(.+?)[，。！]/,
        /我讨厌(.+?)[，。！]/,
        /我不喜欢(.+?)[，。！]/,
        /I like (.+?)[,.!]/,
        /I love (.+?)[,.!]/,
        /I hate (.+?)[,.!]/,
        /I don't like (.+?)[,.!]/,
        /I prefer (.+?)[,.!]/,
    ];
    for (const p of prefPatterns) {
        const m = combined.match(p);
        if (m) {
            facts.push({ type: "preference", content: `User preference: ${m[1].trim()}`, confidence: 0.85, source: "heuristic" });
        }
    }
    // Task patterns
    const taskPatterns = [
        /我要(.+?)[，。！]/,
        /我需要(.+?)[，。！]/,
        /记得(.+?)[，。！]/,
        /别忘了(.+?)[，。！]/,
        /I need to (.+?)[,.!]/,
        /I want to (.+?)[,.!]/,
        /Don't forget to (.+?)[,.!]/,
        /Remember to (.+?)[,.!]/,
    ];
    for (const p of taskPatterns) {
        const m = combined.match(p);
        if (m) {
            facts.push({ type: "task", content: `Task: ${m[1].trim()}`, confidence: 0.8, source: "heuristic" });
        }
    }
    // Correction patterns
    const corrPatterns = [
        /不对，(.+?)[，。！]/,
        /错了，(.+?)[，。！]/,
        /不是(.+?)[，。！]/,
        /No, (.+?)[,.!]/,
        /That's wrong[, .!]/,
        /Incorrect[, .!]/,
    ];
    for (const p of corrPatterns) {
        const m = combined.match(p);
        if (m && m[1]) {
            facts.push({ type: "correction", content: `Correction: ${m[1].trim()}`, confidence: 0.75, source: "heuristic" });
        }
    }
    for (const f of facts) {
        logger?.debug?.(`[l1-debug] ENTRY heuristic ${f.type} conf=${f.confidence} "${f.content.slice(0, 80)}"`);
    }
    if (facts.length === 0) {
        logger?.debug?.("[l1-debug] EMPTY_DUMP heuristic: no patterns matched");
    }
    return facts;
}
/** LLM-based extraction (brainMode: full) */
export async function extractLLM(client, userText, asstText, logger) {
    const prompt = `User: ${userText.slice(0, 2000)}\n\nAssistant: ${asstText.slice(0, 2000)}`;
    logger?.debug?.(`[l1-debug] INVOKE llm userChars=${userText.length} asstChars=${asstText.length}`);
    try {
        const raw = await client.extract(L1_SYSTEM_PROMPT, prompt);
        logger?.debug?.(`[l1-debug] RESULT llm rawLen=${raw.length}`);
        let parsed = { facts: [] };
        try {
            parsed = JSON.parse(raw);
        }
        catch (parseErr) {
            const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
            logger?.debug?.(`[l1-debug] NO_JSON llm raw="${raw.slice(0, 200).replace(/\s+/g, " ")}" err=${msg}`);
            return extractHeuristic(userText, asstText, logger);
        }
        const facts = (parsed.facts || [])
            .filter(f => f.content && f.content.length > 3)
            .map(f => ({
            type: (["fact", "preference", "task", "identity", "event", "correction"].includes(f.type) ? f.type : "fact"),
            content: f.content.trim(),
            confidence: Math.max(0, Math.min(1, f.confidence || 0.7)),
            source: "llm",
        }));
        for (const f of facts) {
            logger?.debug?.(`[l1-debug] ENTRY llm ${f.type} conf=${f.confidence} "${f.content.slice(0, 80)}"`);
        }
        if (facts.length === 0) {
            logger?.debug?.("[l1-debug] EMPTY_DUMP llm: no facts extracted");
        }
        return facts;
    }
    catch (err) {
        logger?.debug?.(`[l1-debug] RESULT llm failed: ${err instanceof Error ? err.message : String(err)}`);
        // LLM failed → fallback to heuristic
        return extractHeuristic(userText, asstText, logger);
    }
}
/** Unified extractor: auto-selects based on brainMode and LLM availability */
export async function extractFacts(userText, asstText, options) {
    options.logger?.debug?.(`[l1-debug] RESOLVE brainMode=${options.brainMode || "lite"} hasLLM=${!!options.llmClient}`);
    if (options.brainMode === "full" && options.llmClient) {
        return extractLLM(options.llmClient, userText, asstText, options.logger);
    }
    return extractHeuristic(userText, asstText, options.logger);
}
