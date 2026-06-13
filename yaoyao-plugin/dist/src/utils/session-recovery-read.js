/**
 * utils/session-recovery-read.ts — Cross-session memory reading.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { stripResetSuffix } from "./session-recovery.js";
function asNonEmptyString(value) {
    if (typeof value !== "string")
        return undefined;
    const trimmed = value.trim();
    return trimmed.length ? trimmed : undefined;
}
export function readCrossSessionMemories(searchDirs, options = {}) {
    const { maxMemories = 20, maxAgeMs = 7 * 24 * 60 * 60 * 1000 } = options;
    const now = Date.now();
    const results = [];
    for (const dir of searchDirs) {
        try {
            if (!existsSync(dir))
                continue;
            const files = readdirSync(dir).filter((f) => f.endsWith(".json") || f.endsWith(".jsonl"));
            for (const file of files) {
                const filePath = join(dir, file);
                try {
                    const content = readFileSync(filePath, "utf8");
                    const lines = content.split("\n").filter((l) => l.trim());
                    for (const line of lines.slice(-10)) {
                        try {
                            const entry = JSON.parse(line);
                            const text = asNonEmptyString(entry.text || entry.content);
                            const ts = typeof entry.timestamp === "number" ? entry.timestamp : now;
                            if (text && now - ts < maxAgeMs) {
                                results.push({
                                    text,
                                    source: `session:${stripResetSuffix(file)}`,
                                    timestamp: ts,
                                });
                            }
                        }
                        catch {
                            // skip malformed lines
                        }
                    }
                }
                catch {
                    // skip unreadable files
                }
            }
        }
        catch {
            // skip inaccessible dirs
        }
    }
    results.sort((a, b) => b.timestamp - a.timestamp);
    return results.slice(0, maxMemories);
}
