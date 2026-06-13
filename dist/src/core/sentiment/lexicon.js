const cn = {
    joy: new Set([
        "开心", "高兴", "快乐", "幸福", "美好", "满意",
        "舒服", "轻松", "惊喜", "爽", "酷", "完美", "无敌",
        "超级", "太棒", "真好", "不错", "漂亮", "靠谱",
        "恭喜", "祝贺", "好运", "幸运", "期待", "希望",
        "进步", "成长", "收获", "丰富", "爽了",
    ]),
    sadness: new Set([
        "难过", "伤心", "痛苦", "悲伤", "凄凉", "心碎",
        "失落", "空虚", "沮丧", "抑郁", "苦闷", "伤感", "愁",
        "心酸", "哀伤", "痛心", "揪心", "绝望", "哭了", "流泪",
        "崩溃",
    ]),
    anger: new Set([
        "生气", "愤怒", "烦", "讨厌", "恨", "恼火", "暴躁",
        "怒", "气死", "忍不了", "受不了", "疯了", "抓狂",
        "烦死了", "懒得", "烦人", "不满", "不爽",
    ]),
    fear: new Set([
        "害怕", "担心", "紧张", "焦虑", "恐惧", "恐慌", "不安",
        "心惊", "忐忑", "畏惧", "惧怕", "胆怯", "心惊肉跳",
        "后怕", "吓人", "吓死", "可怕", "恐怖",
    ]),
    surprise: new Set([
        "惊讶", "震惊", "意外", "吃惊", "诧异", "惊叹", "目瞪口呆",
        "竟然", "居然", "没想到", "天哪", "天啊", "我去",
        "哇", "咦", "哈", "唉？", "咦？", "什么",
        "不可思议", "难以置信",
    ]),
    disgust: new Set([
        "恶心", "难受", "没劲", "无聊", "坑", "惨", "废", "垃圾",
        "扯淡", "离谱", "过分", "烂", "差", "糟", "糟糕",
        "烦人", "无味", "俗气", "庸俗", "乏味", "腻", "厌倦",
        "失望", "遗憾", "可惜",
    ]),
};
const en = {
    joy: new Set([
        "happy", "joy", "joyful", "glad", "delighted", "pleased",
        "excited", "thrilled", "elated", "ecstatic", "euphoric",
        "wonderful", "fantastic", "amazing", "great", "awesome",
        "excellent", "brilliant", "superb", "perfect", "beautiful",
        "nice", "good", "best",
        "love", "like", "enjoy", "adore", "cherish",
        "thank", "thanks", "grateful", "appreciate",
        "success", "win", "triumph", "achievement", "proud",
        "fun", "cool", "wow", "yay", "woohoo",
        "hope", "looking forward",
    ]),
    sadness: new Set([
        "sad", "sadness", "unhappy", "miserable", "depressed",
        "heartbroken", "devastated", "grief", "sorrow", "gloomy",
        "melancholy", "dismal", "bleak", "hopeless", "despair",
        "lonely", "alone", "isolated", "abandoned", "forsaken",
        "cry", "tears", "weep", "sobbing",
        "lost", "broken", "empty", "hurt", "painful",
    ]),
    anger: new Set([
        "angry", "anger", "furious", "enraged", "livid", "irate",
        "annoyed", "irritated", "frustrated", "exasperated",
        "mad", "outraged", "infuriated", "incensed",
        "hate", "loathe", "despise", "detest", "abhor",
        "hostile", "aggressive", "fierce",
    ]),
    fear: new Set([
        "fear", "afraid", "scared", "frightened", "terrified",
        "horrified", "panicked", "alarmed", "anxious", "worried",
        "nervous", "apprehensive", "uneasy", "dread", "dreadful",
        "startled", "shocked", "spooked", "creeped",
        "timid", "cowardly", "hesitant",
    ]),
    surprise: new Set([
        "surprise", "surprised", "amazed", "astonished", "astounded",
        "shocked", "stunned", "flabbergasted", "dumbfounded",
        "unexpected", "unanticipated", "sudden", "abrupt",
        "remarkable", "extraordinary", "incredible", "unbelievable",
        "wow", "whoa", "oh", "aha",
    ]),
    disgust: new Set([
        "disgust", "disgusted", "disgusting", "repulsed", "revolting",
        "nauseated", "sick", "sickened", "gross", "grossed",
        "awful", "terrible", "horrible", "dreadful",
        "boring", "dull", "tedious", "mundane", "stale",
        "poor", "lousy", "pathetic", "miserable",
        "waste", "useless", "stupid", "dumb",
    ]),
};
export const JOY_MARKERS = new Set([
    "哈哈", "嘻嘻", "hhh", "haha", "lol", "lmao",
    "😊", "😃", "😄", "🤣", "🥰", "😍", "🎉", "🥳",
]);
export const SAD_MARKERS = new Set(["😢", "😭", "😥", "😰", "🥺", "😞", "😔"]);
export const ANGRY_MARKERS = new Set(["😠", "😡", "🤬", "💢"]);
export const SURPRISE_MARKERS = new Set(["😱", "😮", "😲", "🤯", "😳", "😨"]);
export const NEGATION_PREFIXES = ["不", "没", "未", "别", "无", "莫"];
export { cn, en };
