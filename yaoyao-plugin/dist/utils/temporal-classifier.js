/**
 * Temporal Classifier — 记忆时间属性分类
 * 从 Brain (memory-lancedb-pro) 学习：区分永久事实 vs 时间敏感信息
 * 纯正则/关键词，零外部依赖
 */
// Dynamic keywords — time-sensitive indicators.
const DYNAMIC_PATTERNS_EN = [
    /\btoday\b/i, /\byesterday\b/i, /\btomorrow\b/i, /\brecently\b/i,
    /\bcurrently\b/i, /\bright now\b/i, /\bthis week\b/i, /\bthis month\b/i,
    /\blast week\b/i, /\bnext week\b/i, /\bthis morning\b/i, /\btonight\b/i,
    /\blater\b/i,
];
const DYNAMIC_KEYWORDS_ZH = [
    "今天", "昨天", "明天", "最近", "正在", "刚才", "刚刚",
    "这周", "这个月", "上周", "下周", "目前", "现在",
    "今晚", "今早", "稍后", "待会",
];
// Static keywords — permanent fact indicators.
const STATIC_PATTERNS_EN = [
    /\bfavorite\b/i, /\bprefer\b/i, /\balways\b/i, /\bname is\b/i,
    /\bborn\b/i, /\bgraduated\b/i, /\blive in\b/i, /\bwork at\b/i,
    /\bjob\b/i, /\bprofession\b/i, /\bhobby\b/i, /\ballergic\b/i,
];
const STATIC_KEYWORDS_ZH = [
    "喜欢", "偏好", "一直", "名字", "叫做", "出生",
    "毕业", "住在", "工作", "职业", "爱好", "过敏",
];
/**
 * Classify memory text as static (permanent fact) or dynamic (time-sensitive).
 * Rule-based: keywords → classification. Default: "static" (safer default).
 */
export function classifyTemporal(text) {
    const hasDynamic = DYNAMIC_PATTERNS_EN.some((re) => re.test(text)) ||
        DYNAMIC_KEYWORDS_ZH.some((kw) => text.includes(kw));
    const hasStatic = STATIC_PATTERNS_EN.some((re) => re.test(text)) ||
        STATIC_KEYWORDS_ZH.some((kw) => text.includes(kw));
    // If BOTH match → "dynamic" wins (time-sensitive info takes priority)
    if (hasDynamic)
        return "dynamic";
    if (hasStatic)
        return "static";
    return "static";
}
// Expiry rules: pattern → milliseconds to add from now
const EXPIRY_RULES = [
    {
        patterns: [/后天/, /day after tomorrow/i],
        offsetMs: 48 * 60 * 60 * 1000,
    },
    {
        patterns: [/明天/, /\btomorrow\b/i],
        offsetMs: 24 * 60 * 60 * 1000,
    },
    {
        patterns: [/下周/, /\bnext week\b/i],
        offsetMs: 7 * 24 * 60 * 60 * 1000,
    },
    {
        patterns: [/这周/, /\bthis week\b/i],
        offsetMs: 3 * 24 * 60 * 60 * 1000,
    },
    {
        patterns: [/下个月/, /\bnext month\b/i],
        offsetMs: 30 * 24 * 60 * 60 * 1000,
    },
    {
        patterns: [/这个月/, /\bthis month\b/i],
        offsetMs: 15 * 24 * 60 * 60 * 1000,
    },
    {
        patterns: [/今晚/, /\btonight\b/i],
        offsetMs: 12 * 60 * 60 * 1000,
    },
    {
        patterns: [/今天/, /\btoday\b/i],
        offsetMs: 18 * 60 * 60 * 1000,
    },
];
/**
 * Infer expiry timestamp from temporal expressions in text.
 * Returns undefined if no temporal expression found.
 */
export function inferExpiry(text, now) {
    const baseTime = now ?? Date.now();
    for (const rule of EXPIRY_RULES) {
        for (const pattern of rule.patterns) {
            if (pattern.test(text)) {
                return baseTime + rule.offsetMs;
            }
        }
    }
    return undefined;
}
