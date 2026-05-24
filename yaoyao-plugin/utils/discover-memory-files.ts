/**
 * utils/discover-memory-files.ts — Discover memory markdown files in workspace.
 *
 * Scans workspace root and memory/ directory for relevant markdown files.
 * Zero external dependencies beyond node:fs / node:path.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { MemoryStore } from "./memory-store.ts";

export interface DiscoveredFile {
  path: string;
  filename: string;
  type: string;
  date?: string;
}

const ROOT_MEMORY_FILES = [
  "MEMORY.md", "memory.md",
  "USER.md", "user.md",
  "SOUL.md", "soul.md",
  "AGENTS.md", "agents.md",
  "TOOLS.md", "tools.md",
  "HEARTBEAT.md", "heartbeat.md",
  "DREAMS.md", "dreams.md",
  "BOOTSTRAP.md", "bootstrap.md",
  "IDENTITY.md", "identity.md",
];

/** Resolve the actual OpenClaw workspace directory from multiple candidates. */
function resolveWorkspaceDir(given: string): string {
  const candidates = [given];
  if (process.env.OPENCLAW_WORKSPACE) {
    candidates.push(process.env.OPENCLAW_WORKSPACE);
  }
  candidates.push(path.join(os.homedir(), ".openclaw", "workspace"));

  for (const dir of candidates) {
    if (!dir || dir === ".") continue;
    const resolved = path.resolve(dir);
    if (!fs.existsSync(resolved)) continue;
    // Heuristic: a valid OpenClaw workspace should have at least one marker file/dir
    const markers = ["MEMORY.md", "memory", "SOUL.md", "AGENTS.md", "USER.md"];
    const hasMarker = markers.some(m => fs.existsSync(path.join(resolved, m)));
    if (hasMarker) return resolved;
  }

  // Fallback: return given (even if wrong) so caller can log it
  return path.resolve(given || ".");
}

/** Discover all memory-relevant markdown files in workspace. */
export function discoverMemoryFiles(workspaceDir: string, store: MemoryStore): DiscoveredFile[] {
  const resolvedDir = resolveWorkspaceDir(workspaceDir);
  const results: DiscoveredFile[] = [];
  const seenPaths = new Set<string>();

  // 1. Root-level known files
  for (const name of ROOT_MEMORY_FILES) {
    const fp = path.join(resolvedDir, name);
    if (fs.existsSync(fp) && !seenPaths.has(fp)) {
      results.push({ path: fp, filename: name, type: "root" });
      seenPaths.add(fp);
    }
  }

  // 2. Daily files from store
  const dailyFiles = store.listFiles().filter(f => f.type === "daily");
  for (const file of dailyFiles) {
    if (!seenPaths.has(file.path)) {
      results.push({
        path: file.path,
        filename: file.filename,
        type: "daily",
        date: file.date,
      });
      seenPaths.add(file.path);
    }
  }

  // 3. Other .md files in memory/ directory
  const memDir = store.baseDir;
  if (fs.existsSync(memDir)) {
    for (const entry of fs.readdirSync(memDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const fp = path.join(memDir, entry.name);
      if (!seenPaths.has(fp)) {
        results.push({ path: fp, filename: entry.name, type: "memory_misc" });
        seenPaths.add(fp);
      }
    }
  }

  return results;
}