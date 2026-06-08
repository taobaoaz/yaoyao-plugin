/**
 * storage/external-oc.ts — OpenClaw external DB access.
 *
 * Encapsulates raw SQL queries against the OpenClaw native memory DB
 * (~/.openclaw/memory/main.sqlite) so features/ layers don't write SQL.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createCompatDB } from "../platform/db/compat.js";
function getOpenClawMemoryDir() {
    return path.join(os.homedir(), '.openclaw', 'memory');
}
export function queryOpenClawDB(sql, params) {
    const dbPath = path.join(getOpenClawMemoryDir(), 'main.sqlite');
    try {
        if (!fs.existsSync(dbPath))
            return null;
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[yaoyao-memory:external] Check OC DB failed: ${msg}`);
        return null;
    }
    try {
        const { db } = createCompatDB(dbPath);
        const rows = db.prepare(sql).all(...(params || []));
        db.close();
        return rows;
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[yaoyao-memory:external] Query OC DB failed: ${msg}`);
        return null;
    }
}
