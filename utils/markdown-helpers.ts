/**
 * utils/markdown-helpers.ts — Shared markdown parsing utilities.
 *
 * Sanitization, line classification, and deduplication helpers.
 * Zero external dependencies.
 */

import crypto from "node:crypto";

export interface ParsedEntry {
  text: string;
  date: string;
  meta: string;
  priority: number; // 0=paragraph, 1=section, 2=dated/bullet
}

export const MIN_ENTRY_LENGTH = 15;
export const MAX_ENTRY_LENGTH = 2000;

// ── Deduplication ────────────────────────────────────────────────────────────

function hashText(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/** Deduplicate entries by text hash, keeping highest priority. */
export function dedupeEntries(entries: ParsedEntry[]): ParsedEntry[] {
  const seen = new Map<string, ParsedEntry>();
  for (const entry of entries) {
    const h = hashText(entry.text);
    const existing = seen.get(h);
    if (!existing || entry.priority > existing.priority) {
      seen.set(h, entry);
    }
  }
  return Array.from(seen.values());
}

// ── Markdown Sanitization ────────────────────────────────────────────────────

export function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")          // code blocks
    .replace(/`([^`]+)`/g, "$1")              // inline code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // links
    .replace(/\*\*([^*]+)\*\*/g, "$1")       // bold
    .replace(/\b_([^_]+)_\b/g, "$1")         // italic (word boundaries)
    .replace(/\*([^*]+)\*/g, "$1")           // italic
    .replace(/#{1,6}\s*/gm, "")              // headers
    .replace(/^>\s*/gm, "")                   // blockquotes
    .replace(/\|\s*[-:]+\s*\|/g, "")         // table separators
    .replace(/\|/g, " ")                      // table cells
    .trim();
}

// ── Line Helpers ─────────────────────────────────────────────────────────────

export function isSkippableLine(trimmed: string): boolean {
  return trimmed === "" || trimmed.startsWith("<!--") || trimmed === "---";
}

export function isHeader(trimmed: string): boolean {
  return /^#{1,6}\s+/.test(trimmed);
}

/** Flush accumulated text as an entry if long enough. */
export function maybeFlush(
  text: string,
  date: string,
  meta: string,
  priority: number,
): ParsedEntry | null {
  const cleaned = text.trim();
  if (cleaned.length < MIN_ENTRY_LENGTH) return null;
  return { text: stripMarkdown(cleaned), date, meta, priority };
}
