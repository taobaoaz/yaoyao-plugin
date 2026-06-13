/**
 * core/remind/cron.ts — Pure cron expression conversion, zero platform awareness.
 */
/**
 * Convert Chinese human-readable time description to cron expression.
 * Covers common Chinese time descriptions, automatically extracts hours and minutes.
 */
export function convertHumanToCron(descr, minuteOffset = 30) {
    if (typeof descr !== "string")
        throw new TypeError("convertHumanToCron: descr must be a string");
    if (!Number.isFinite(minuteOffset))
        minuteOffset = 30;
    const lower = descr.toLowerCase().replace(/\s+/g, "");
    let hour = "09";
    let minute = "00";
    const minMatch = lower.match(/(\d+)分/);
    if (minMatch)
        minute = minMatch[1].padStart(2, "0");
    const hourMatch = lower.match(/(\d+)点/);
    if (hourMatch)
        hour = hourMatch[1].padStart(2, "0");
    const clampedOffset = Math.max(0, Math.min(59, minuteOffset));
    let startMinute = Number(minute);
    if (clampedOffset > 0) {
        startMinute = (startMinute + Math.floor(Math.random() * (clampedOffset + 1))) % 60;
    }
    minute = String(startMinute).padStart(2, "0");
    if (/下午/.test(lower) || /晚上/.test(lower)) {
        const h = Number(hour);
        if (h >= 1 && h <= 11)
            hour = String(h + 12).padStart(2, "0");
    }
    if (/中午/.test(lower)) {
        hour = "12";
        minute = "00";
    }
    const intervalMin = lower.match(/每(?:隔)?(\d+)分钟/);
    if (intervalMin) {
        return `*/${intervalMin[1].padStart(2, "0")} * * * *`;
    }
    if (/每半小时/.test(lower) || /每30分钟/.test(lower)) {
        return `*/30 * * * *`;
    }
    const intervalHour = lower.match(/每(?:隔)?(\d+)小时/);
    if (intervalHour) {
        return `0 */${intervalHour[1]} * * *`;
    }
    if (/每小时/.test(lower) || /每个小时/.test(lower)) {
        return `${minute} * * * *`;
    }
    if (/工作日/.test(lower) || /周一到周五/.test(lower) || /星期一到五/.test(lower)) {
        return `${minute} ${hour} * * 1-5`;
    }
    if (/周末/.test(lower)) {
        return `${minute} ${hour} * * 0,6`;
    }
    const weekdays = {
        "一": "1", "二": "2", "三": "3", "四": "4",
        "五": "5", "六": "6", "日": "0", "天": "0",
    };
    for (const [cn, num] of Object.entries(weekdays)) {
        if (lower.includes(`每周${cn}`)) {
            return `${minute} ${hour} * * ${num}`;
        }
    }
    if (/每天/.test(lower) || /每日/.test(lower)) {
        return `${minute} ${hour} * * *`;
    }
    return null;
}
