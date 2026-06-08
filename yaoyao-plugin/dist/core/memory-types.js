/**
 * core/memory-types.ts — Structured memory type classification.
 *
 * During capture, each memory is tagged with a type so that
 * retrieval can be more precise. Inspired by Cortex Memory's
 * 8 MemoryType variants and MemoryItem trait.
 *
 * This is a rule-based classifier — no LLM call needed at capture time.
 */
// ── Classifier patterns ──
const PREFERENCE_PATTERNS = [
    /喜欢|不喜欢|爱[好吃看听用]|偏爱|更(喜欢|倾向|偏向)|习惯了|习惯性|习惯|通常.*会|经常|总是|很少|从不|一般不|比较喜欢|最喜欢|最讨厌|推荐|推荐.*给/i,
    /like|love|prefer|favourite|favorite|hate|dislike|usually|always|never|often|tend to|used to|habit/i,
];
const EVENT_PATTERNS = [
    /(?:在|于|今天|昨天|明天|上周|下周|去年|今年|\d+月\d+日|星期[一二三四五六日天]|周[一二三四五六日天])[^。！？\n]*?(?:了|过|参加|去了|去了|去过|参加|完成|做了|买了|订了|出发|到达|开始|结束|遇到|见到)/i,
    /(?:today|yesterday|tomorrow|last\s+\w+|next\s+\w+|\d{4}[-/]\d{1,2}[-/]\d{1,2}).{0,50}(?:happened|went|did|completed|finished|started|ended|met|bought|ordered|arrived|departed)/i,
    /刚才|刚刚|才.*(?:问了|说了|做了|看了|写了|发了|买了|吃了|喝了)/i,
];
const ENTITY_PATTERNS = [
    /(?:我叫|我是|名字是|叫|称呼|可以叫)[我]?\s*[:：]?\s*\S{1,20}/i,
    /我在(?:用|使用|安装了|下载了|注册了|开通了)\s*\S{1,30}/i,
    /我用的是|我用的|我(?:常用|平时用|在用)\s*\S{1,20}(?:工具|软件|应用|APP|平台|网站|手机|电脑)/i,
    /(?:介绍|认识|推荐)[^。！？\n]*?(?:朋友|同事|老板|客户|老师|同学|邻居|合作伙伴|团队成员)/i,
    /(?:住在|工作在|毕业于|就职于|任职于|来自|目前(?:在|就职))/i,
    /my name is|i (?:work|live|study) (?:at|in)|i use|i (?:love|like|hate|prefer|enjoy) \w+/i,
];
const GOAL_PATTERNS = [
    /(?:计划|打算|准备|想要|希望|目标|梦想|愿望|立志|决定|下决心|承诺|flag|flag\s*\d+)/i,
    /(?:plan|planning|intend|goal|aim|target|hope|wish|want to|gonna|going to|decided|promise|resolution)/i,
    /(?:最近|接下来|接下来|后续|后面|下一步|接下来打算|准备开始)/i,
];
const RELATIONSHIP_PATTERNS = [
    /(?:老公|老婆|男朋友|女朋友|对象|室友|同事|合伙人|股东|老板|下属|上级|领导|客户|甲方|乙方|合作伙伴|搭档)/i,
    /(?:husband|wife|girlfriend|boyfriend|partner|colleague|coworker|client|customer|boss|manager)/i,
];
const BEHAVIOR_PATTERNS = [
    /(?:每次|每[天周月年]|每天|每周|每个月|每年|一贯|向来|向来如此|雷打不动|坚持|持续|一直|长期|长期以[来在]|久而久之)/i,
    /(?:every|always|constantly|consistently|persistently|routinely|regularly|habitually)/i,
];
// ── Public API ──
/**
 * Classify a capture context into a memory type.
 * Rules-based (no LLM call), runs on user + assistant combined content.
 */
export function classifyMemoryType(userText, asstText = '') {
    const combined = `${userText}\n${asstText}`;
    // Preference (highest priority pattern — direct user likes/dislikes)
    for (const p of PREFERENCE_PATTERNS) {
        if (p.test(combined))
            return {
                type: 'preference',
                confidence: 0.85,
                tags: ['preference', ...extractKeyTags(combined)],
            };
    }
    // Goal (plans/intentions)
    for (const p of GOAL_PATTERNS) {
        if (p.test(combined))
            return { type: 'goal', confidence: 0.75, tags: ['goal', ...extractKeyTags(combined)] };
    }
    // Event (temporal anchors)
    for (const p of EVENT_PATTERNS) {
        if (p.test(combined))
            return { type: 'event', confidence: 0.8, tags: ['event', ...extractKeyTags(combined)] };
    }
    // Entity (named things about the user)
    for (const p of ENTITY_PATTERNS) {
        if (p.test(combined))
            return { type: 'entity', confidence: 0.7, tags: ['entity', ...extractKeyTags(combined)] };
    }
    // Relationship
    for (const p of RELATIONSHIP_PATTERNS) {
        if (p.test(combined))
            return {
                type: 'relationship',
                confidence: 0.7,
                tags: ['relationship', ...extractKeyTags(combined)],
            };
    }
    // Behavior
    for (const p of BEHAVIOR_PATTERNS) {
        if (p.test(combined))
            return { type: 'behavior', confidence: 0.6, tags: ['behavior', ...extractKeyTags(combined)] };
    }
    // Default
    return { type: 'fact', confidence: 0.5, tags: extractKeyTags(combined) };
}
/** Extract short descriptive tags from combined content (max 3, length-limited) */
function extractKeyTags(text) {
    const cleaned = text
        .toLowerCase()
        .replace(/[^a-z\u4e00-\u9fff0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const tokens = cleaned.split(/\s+/).filter((t) => t.length >= 2 && t.length <= 20);
    // Dedup and take first 3 non-numeric tags
    const seen = new Set();
    const tags = [];
    for (const t of tokens) {
        if (seen.has(t) || /^\d+$/.test(t))
            continue;
        seen.add(t);
        tags.push(t);
        if (tags.length >= 3)
            break;
    }
    return tags;
}
