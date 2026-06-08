/**
 * features/unify/provider.ts — Unified backend data access.
 *
 * Reads from OpenClaw DB, .dreams events, and yaoyao indices.
 * Pure data access, no tool registration.
 */
import fs from 'node:fs';
import path from 'node:path';
export function readDreams(memoryDir) {
    const result = { events: [], shortTermRecall: null };
    const eventsPath = path.join(memoryDir, '.dreams', 'events.jsonl');
    const recallPath = path.join(memoryDir, '.dreams', 'short-term-recall.json');
    try {
        if (fs.existsSync(eventsPath)) {
            const lines = fs.readFileSync(eventsPath, 'utf8').split('\n').filter(Boolean);
            result.events = lines
                .slice(-20)
                .map((l) => {
                try {
                    return JSON.parse(l);
                }
                catch (e) {
                    const msg = e instanceof Error ? e.message : String(e);
                    console.warn(`[yaoyao-memory:unify] Parse dream event failed: ${msg}`);
                    return null;
                }
            })
                .filter(Boolean);
        }
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[yaoyao-memory:unify] Read dreams failed: ${msg}`);
    }
    try {
        if (fs.existsSync(recallPath)) {
            try {
                result.shortTermRecall = JSON.parse(fs.readFileSync(recallPath, 'utf8'));
            }
            catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                console.warn(`[yaoyao-memory:unify] Parse short-term recall failed: ${msg}`);
                result.shortTermRecall = [];
            }
        }
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[yaoyao-memory:unify] Read short-term recall failed: ${msg}`);
    }
    return result;
}
export { queryOpenClawDB } from "../../storage/external-oc.js";
export function getYaoyaoDbPath(memoryDir) {
    return path.join(memoryDir, '.yaoyao.db');
}
export function getDailyFilesCount(memoryDir) {
    try {
        return fs.existsSync(memoryDir)
            ? fs.readdirSync(memoryDir).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).length
            : 0;
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[yaoyao-memory:unify] Count daily files failed: ${msg}`);
        return 0;
    }
}
