/**
 * utils/session-recovery-read.ts — Cross-session memory reading.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { stripResetSuffix } from "./session-recovery.ts";

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

export interface CrossSessionMemory {
  text: string;
  source: string;
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
            } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[yaoyao-memory] skip malformed lines: ${msg}`);
    }
          }
        } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[yaoyao-memory] skip unreadable files: ${msg}`);
    }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[yaoyao-memory] skip inaccessible dirs: ${msg}`);
    }
  }

  results.sort((a, b) => b.timestamp - a.timestamp);
  return results.slice(0, maxMemories);
}
