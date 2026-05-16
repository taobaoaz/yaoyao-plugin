/**
 * Session Recovery — Cross-session context restoration (from Brain v1.1.0)
 * Zero external dependency. Scans other agents' memory files for shared context.
 */

import { dirname, join } from "node:path";
import { readdirSync, readFileSync, existsSync } from "node:fs";

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

/** Strip .reset. suffix from session file names. */
export function stripResetSuffix(fileName: string): string {
  const resetIndex = fileName.indexOf(".reset.");
  if (resetIndex === -1) return fileName;
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

function deriveOpenClawHomeFromWorkspacePath(workspacePath: string): string | undefined {
  const normalized = workspacePath.trim().replace(/[\\/]+$/, "");
  if (!normalized) return undefined;
  const matched = normalized.match(/^(.*?)[\\/]workspace(?:[\\/].*)?$/);
  if (!matched || !matched[1]) return undefined;
  const home = matched[1].trim();
  return home.length ? home : undefined;
}

function deriveOpenClawHomeFromSessionFilePath(sessionFilePath: string): string | undefined {
  const normalized = sessionFilePath.trim();
  if (!normalized) return undefined;
  const matched = normalized.match(/^(.*?)[\\/]agents[\\/][^\\/]+[\\/]sessions(?:[\\/][^\\/]+)?$/);
  if (!matched || !matched[1]) return undefined;
  const home = matched[1].trim();
  return home.length ? home : undefined;
}

function listConfiguredAgentIds(cfg: unknown): string[] {
  try {
    const root = cfg as Record<string, unknown>;
    const agents = root.agents as Record<string, unknown> | undefined;
    const list = agents?.list as unknown;
    if (!Array.isArray(list)) return [];

    const ids: string[] = [];
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const id = asNonEmptyString((item as Record<string, unknown>).id);
      if (id) ids.push(id);
    }
    return ids;
  } catch {
    return [];
  }
}

export interface SessionSearchParams {
  context: Record<string, unknown>;
  cfg: unknown;
  workspaceDir: string;
  currentSessionFile?: string;
  sourceAgentId?: string;
}

/**
 * Resolve directories to search for cross-session memories.
 * Scans current agent sessions + other configured agents' sessions.
 */
export function resolveSessionSearchDirs(params: SessionSearchParams): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const addDir = (value: string | undefined) => {
    const dir = asNonEmptyString(value);
    if (!dir || seen.has(dir)) return;
    seen.add(dir);
    out.push(dir);
  };
  const addHome = (homes: string[], value: string | undefined) => {
    const home = asNonEmptyString(value);
    if (!home || homes.includes(home)) return;
    homes.push(home);
  };
  const addAgentId = (agentIds: string[], value: string | undefined) => {
    const agentId = asNonEmptyString(value);
    if (!agentId || agentId.includes("/") || agentId.includes("\\") || agentIds.includes(agentId)) return;
    agentIds.push(agentId);
  };

  const previousSessionEntry = (params.context.previousSessionEntry || {}) as Record<string, unknown>;
  const sessionEntry = (params.context.sessionEntry || {}) as Record<string, unknown>;
  const sessionEntries = [previousSessionEntry, sessionEntry];

  if (params.currentSessionFile) addDir(dirname(params.currentSessionFile));
  for (const entry of sessionEntries) {
    const file = asNonEmptyString(entry.sessionFile);
    if (file) addDir(dirname(file));
    addDir(asNonEmptyString(entry.sessionsDir));
    addDir(asNonEmptyString(entry.sessionDir));
  }
  addDir(join(params.workspaceDir, "sessions"));

  const openclawHomes: string[] = [];
  addHome(openclawHomes, asNonEmptyString(process.env.OPENCLAW_HOME));
  addHome(openclawHomes, deriveOpenClawHomeFromWorkspacePath(params.workspaceDir));
  if (params.currentSessionFile) {
    addHome(openclawHomes, deriveOpenClawHomeFromSessionFilePath(params.currentSessionFile));
  }
  for (const entry of sessionEntries) {
    const entryFile = asNonEmptyString(entry.sessionFile);
    if (entryFile) addHome(openclawHomes, deriveOpenClawHomeFromSessionFilePath(entryFile));
  }
  try {
    const root = params.cfg as Record<string, unknown>;
    const agents = root.agents as Record<string, unknown> | undefined;
    const defaults = agents?.defaults as Record<string, unknown> | undefined;
    const defaultWorkspace = asNonEmptyString(defaults?.workspace);
    if (defaultWorkspace) addHome(openclawHomes, deriveOpenClawHomeFromWorkspacePath(defaultWorkspace));

    const list = agents?.list as unknown;
    if (Array.isArray(list)) {
      for (const item of list) {
        if (!item || typeof item !== "object") continue;
        const workspace = asNonEmptyString((item as Record<string, unknown>).workspace);
        if (workspace) addHome(openclawHomes, deriveOpenClawHomeFromWorkspacePath(workspace));
      }
    }
  } catch {
    // ignore
  }

  const agentIds: string[] = [];
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

/**
 * Read recent memories from other sessions for context restoration.
 * Returns { text, source, timestamp } tuples sorted by recency.
 */
export interface CrossSessionMemory {
  text: string;
  source: string; // e.g. "agent:main:session:abc123"
  timestamp: number;
}

export function readCrossSessionMemories(
  searchDirs: string[],
  options: { maxMemories?: number; maxAgeMs?: number } = {},
): CrossSessionMemory[] {
  const { maxMemories = 20, maxAgeMs = 7 * 24 * 60 * 60 * 1000 } = options;
  const now = Date.now();
  const results: CrossSessionMemory[] = [];

  for (const dir of searchDirs) {
    try {
      if (!existsSync(dir)) continue;
      const files = readdirSync(dir).filter((f: string) => f.endsWith(".json") || f.endsWith(".jsonl"));
      for (const file of files) {
        const filePath = join(dir, file);
        try {
          const content = readFileSync(filePath, "utf8");
          const lines = content.split("\n").filter((l: string) => l.trim());
          for (const line of lines.slice(-10)) {
            try {
              const entry = JSON.parse(line) as Record<string, unknown>;
              const text = asNonEmptyString(entry.text || entry.content);
              const ts = typeof entry.timestamp === "number" ? entry.timestamp : now;
              if (text && now - ts < maxAgeMs) {
                results.push({
                  text,
                  source: `session:${stripResetSuffix(file)}`,
                  timestamp: ts,
                });
              }
            } catch {
              // skip malformed lines
            }
          }
        } catch {
          // skip unreadable files
        }
      }
    } catch {
      // skip inaccessible dirs
    }
  }

  results.sort((a, b) => b.timestamp - a.timestamp);
  return results.slice(0, maxMemories);
}
