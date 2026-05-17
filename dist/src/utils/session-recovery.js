/**
 * Session Recovery — Cross-session context restoration (from Brain v1.1.0)
 * Zero external dependency. Scans other agents' memory files for shared context.
 */
import { dirname, join } from "node:path";
import { readdirSync, readFileSync, existsSync } from "node:fs";
function asNonEmptyString(value) {
    if (typeof value !== "string")
        return undefined;
    const trimmed = value.trim();
    return trimmed.length ? trimmed : undefined;
}
/** Strip .reset. suffix from session file names. */
export function stripResetSuffix(fileName) {
    const resetIndex = fileName.indexOf(".reset.");
    if (resetIndex === -1)
        return fileName;
    // Preserve file extension after the reset suffix
    const beforeReset = fileName.slice(0, resetIndex);
    const afterReset = fileName.slice(resetIndex + ".reset.".length);
    // afterReset may contain "123.json" — we want to append the extension part
    const extMatch = afterReset.match(/\.[^.]+$/);
    if (extMatch) {
        return beforeReset + extMatch[0];
    }
    return beforeReset;
}
function deriveOpenClawHomeFromWorkspacePath(workspacePath) {
    const normalized = workspacePath.trim().replace(/[\\/]+$/, "");
    if (!normalized)
        return undefined;
    const matched = normalized.match(/^(.*?)[\\/]workspace(?:[\\/].*)?$/);
    if (!matched || !matched[1])
        return undefined;
    const home = matched[1].trim();
    return home.length ? home : undefined;
}
function deriveOpenClawHomeFromSessionFilePath(sessionFilePath) {
    const normalized = sessionFilePath.trim();
    if (!normalized)
        return undefined;
    const matched = normalized.match(/^(.*?)[\\/]agents[\\/][^\\/]+[\\/]sessions(?:[\\/][^\\/]+)?$/);
    if (!matched || !matched[1])
        return undefined;
    const home = matched[1].trim();
    return home.length ? home : undefined;
}
function listConfiguredAgentIds(cfg) {
    try {
        const root = cfg;
        const agents = root.agents;
        const list = agents?.list;
        if (!Array.isArray(list))
            return [];
        const ids = [];
        for (const item of list) {
            if (!item || typeof item !== "object")
                continue;
            const id = asNonEmptyString(item.id);
            if (id)
                ids.push(id);
        }
        return ids;
    }
    catch {
        return [];
    }
}
/**
 * Resolve directories to search for cross-session memories.
 * Scans current agent sessions + other configured agents' sessions.
 */
export function resolveSessionSearchDirs(params) {
    const out = [];
    const seen = new Set();
    const addDir = (value) => {
        const dir = asNonEmptyString(value);
        if (!dir || seen.has(dir))
            return;
        seen.add(dir);
        out.push(dir);
    };
    const addHome = (homes, value) => {
        const home = asNonEmptyString(value);
        if (!home || homes.includes(home))
            return;
        homes.push(home);
    };
    const addAgentId = (agentIds, value) => {
        const agentId = asNonEmptyString(value);
        if (!agentId || agentId.includes("/") || agentId.includes("\\") || agentIds.includes(agentId))
            return;
        agentIds.push(agentId);
    };
    const previousSessionEntry = (params.context.previousSessionEntry || {});
    const sessionEntry = (params.context.sessionEntry || {});
    const sessionEntries = [previousSessionEntry, sessionEntry];
    if (params.currentSessionFile)
        addDir(dirname(params.currentSessionFile));
    for (const entry of sessionEntries) {
        const file = asNonEmptyString(entry.sessionFile);
        if (file)
            addDir(dirname(file));
        addDir(asNonEmptyString(entry.sessionsDir));
        addDir(asNonEmptyString(entry.sessionDir));
    }
    addDir(join(params.workspaceDir, "sessions"));
    const openclawHomes = [];
    addHome(openclawHomes, asNonEmptyString(process.env.OPENCLAW_HOME));
    addHome(openclawHomes, deriveOpenClawHomeFromWorkspacePath(params.workspaceDir));
    if (params.currentSessionFile) {
        addHome(openclawHomes, deriveOpenClawHomeFromSessionFilePath(params.currentSessionFile));
    }
    for (const entry of sessionEntries) {
        const entryFile = asNonEmptyString(entry.sessionFile);
        if (entryFile)
            addHome(openclawHomes, deriveOpenClawHomeFromSessionFilePath(entryFile));
    }
    try {
        const root = params.cfg;
        const agents = root.agents;
        const defaults = agents?.defaults;
        const defaultWorkspace = asNonEmptyString(defaults?.workspace);
        if (defaultWorkspace)
            addHome(openclawHomes, deriveOpenClawHomeFromWorkspacePath(defaultWorkspace));
        const list = agents?.list;
        if (Array.isArray(list)) {
            for (const item of list) {
                if (!item || typeof item !== "object")
                    continue;
                const workspace = asNonEmptyString(item.workspace);
                if (workspace)
                    addHome(openclawHomes, deriveOpenClawHomeFromWorkspacePath(workspace));
            }
        }
    }
    catch {
        // ignore
    }
    const agentIds = [];
    addAgentId(agentIds, params.sourceAgentId);
    addAgentId(agentIds, asNonEmptyString(params.context.agentId));
    for (const entry of sessionEntries) {
        addAgentId(agentIds, asNonEmptyString(entry.agentId));
    }
    for (const configuredId of listConfiguredAgentIds(params.cfg)) {
        addAgentId(agentIds, configuredId);
    }
    addAgentId(agentIds, "main");
    for (const home of openclawHomes) {
        for (const agentId of agentIds) {
            addDir(join(home, "agents", agentId, "sessions"));
        }
    }
    return out;
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
