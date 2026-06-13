/**
 * features/unify/provider.ts — Unified backend data access.
 *
 * Reads from OpenClaw DB, .dreams events, and yaoyao indices.
 * Pure data access, no tool registration.
 */
import fs from "node:fs";
import path from "node:path";
export function readDreams(memoryDir) {
    const result = { events: [], shortTermRecall: null };
    const eventsPath = path.join(memoryDir, ".dreams", "events.jsonl");
    const recallPath = path.join(memoryDir, ".dreams", "short-term-recall.json");
    try {
        if (fs.existsSync(eventsPath)) {
            const lines = fs.readFileSync(eventsPath, "utf8").split("\n").filter(Boolean);
            result.events = lines.slice(-20).map(l => { try {
                return JSON.parse(l);
            }
            catch {
                return null;
            } }).filter(Boolean);
        }
    }
    catch { /* best effort */ }
    try {
        if (fs.existsSync(recallPath)) {
            try {
                result.shortTermRecall = JSON.parse(fs.readFileSync(recallPath, "utf8"));
            }
            catch {
                result.shortTermRecall = [];
            }
        }
    }
    catch { /* best effort */ }
    return result;
}
export { queryOpenClawDB } from "../../storage/external-oc.js";
export function getYaoyaoDbPath(memoryDir) {
    return path.join(memoryDir, ".yaoyao.db");
}
export function getDailyFilesCount(memoryDir) {
    try {
        return fs.existsSync(memoryDir)
            ? fs.readdirSync(memoryDir).filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).length
            : 0;
    }
    catch {
        return 0;
    }
}
