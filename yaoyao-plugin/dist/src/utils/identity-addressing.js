/**
 * Identity & Addressing Extractor
 * 从 Brain (memory-lancedb-pro) 学习：自动提取用户姓名和称呼偏好
 * 零外部依赖，纯正则
 */
function trimCapturedValue(value) {
    return value
        .replace(/^[\s"'"‘’「」『』*_`~：:]+/, "")
        .replace(/[\s"'"‘’「」『』*_`~。！，、,.!?:：；;]+$/u, "")
        .trim();
}
function extractFirst(patterns, text) {
    for (const pattern of patterns) {
        const match = pattern.exec(text);
        const captured = match?.[1] ? trimCapturedValue(match[1]) : "";
        if (captured)
            return captured;
    }
    return undefined;
}
// ── Name extraction patterns ──
const NAME_PATTERNS = [
    /(?:我的名字是|我(?:现在)?叫|本名是|姓名[:：])\s*([^\s，。,.!！?？"'"「」『』\n]+)/iu,
    /calls?\s+themselves\s+['"]([^'"]+)['"]/i,
    /name\s+is\s+['"]?([^'",\n]+)['"]?/i,
];
// ── Addressing preference patterns ──
const ADDRESSING_PATTERNS = [
    /(?:以后你叫我|以后请叫我|请叫我|以后称呼我(?:为)?|称呼我(?:为)?|称呼其为|称呼他为)\s*([^\s，。,.!！?？"'"「」『』\n]+)/iu,
    /(?:希望(?:在[^\n。]{0,20})?(?:以后)?(?:你)?(?:被)?称呼(?:我|其|他)?为)\s*([^\s，。,.!！?？"'"「」『』\n]+)/iu,
    /(?:被称呼为|称呼偏好(?:是)?|Preferred address(?: is)?|be addressed as|addressed as|call me|address me as)\s*['"]?([^'",.\n]+)['"]?/i,
    /(?:addressive identifier is|preferred (?:and permanently assigned )?addressive identifier is)\s*['"]?([^'",.\n]+)['"]?/i,
];
// ── Hint patterns (for classification) ──
const NAME_HINT_PATTERNS = [
    /^姓名[:：]/m,
    /^## Identity$/m,
    /(?:^|\n)-\s*Name:\s+/i,
    /用户当前姓名\/自称为/u,
];
const ADDRESSING_HINT_PATTERNS = [
    /^称呼偏好[:：]/m,
    /^## Addressing$/m,
    /Preferred form of address/i,
    /被称呼为/u,
    /addressive identifier/i,
];
function makeCandidate(kind, value, sourceText) {
    return { kind, value, sourceText };
}
/** Extract identity candidates from raw user text. */
export function extractIdentityCandidates(text) {
    const sourceText = text.trim();
    if (!sourceText)
        return [];
    const name = extractFirst(NAME_PATTERNS, sourceText);
    const addressing = extractFirst(ADDRESSING_PATTERNS, sourceText);
    const candidates = [];
    if (name) {
        candidates.push(makeCandidate("name", name, sourceText));
    }
    if (addressing) {
        const duplicateOfName = name && addressing === name;
        if (!duplicateOfName || candidates.length === 0) {
            candidates.push(makeCandidate("addressing", addressing, sourceText));
        }
    }
    return candidates;
}
/** Extract just the name and addressing values. */
export function extractIdentityValues(text) {
    const sourceText = text.trim();
    if (!sourceText)
        return {};
    return {
        name: extractFirst(NAME_PATTERNS, sourceText),
        addressing: extractFirst(ADDRESSING_PATTERNS, sourceText),
    };
}
/** Check if a text contains identity-related hints. */
export function classifyIdentityMemory(text) {
    const sourceText = text.trim();
    if (!sourceText) {
        return { hasName: false, hasAddressing: false };
    }
    const extracted = extractIdentityValues(sourceText);
    const hasName = !!extracted.name || NAME_HINT_PATTERNS.some((p) => p.test(sourceText));
    const hasAddressing = !!extracted.addressing || ADDRESSING_HINT_PATTERNS.some((p) => p.test(sourceText));
    return { hasName, hasAddressing, name: extracted.name, addressing: extracted.addressing };
}
