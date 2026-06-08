/**
 * utils/memory-parser.ts — Markdown memory parser with 5 strategies.
 *
 * Delegates sanitization + deduplication to markdown-helpers.ts.
 * Zero external dependencies.
 */

import type { ParsedEntry } from './markdown-helpers.ts';
import {
  MIN_ENTRY_LENGTH,
  dedupeEntries,
  maybeFlush,
  isSkippableLine,
  isHeader,
} from './markdown-helpers.ts';

// ── Strategy: Dated ──────────────────────────────────────────────────────────

/** Split on #/## YYYY-MM-DD headers, extract bullets from raw text. */
function parseDated(content: string, source: string, fileDate: string): ParsedEntry[] {
  const segments: Array<{ raw: string; date: string }> = [];
  let buffer = '';
  let currentDate = fileDate;

  for (const rawLine of content.split('\n')) {
    const trimmed = rawLine.trim();
    const dateMatch = trimmed.match(/^#{1,2}\s+(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) {
      if (buffer.trim().length >= MIN_ENTRY_LENGTH) {
        segments.push({ raw: buffer.trim(), date: currentDate });
      }
      currentDate = dateMatch[1];
      buffer = '';
      continue;
    }
    if (isSkippableLine(trimmed)) continue;
    buffer += rawLine + '\n';
  }
  if (buffer.trim().length >= MIN_ENTRY_LENGTH) {
    segments.push({ raw: buffer.trim(), date: currentDate });
  }

  const entries: ParsedEntry[] = [];
  for (const seg of segments) {
    entries.push(...extractBullets(seg.raw, seg.date, `${source}:bullet`));
    const entry = maybeFlush(seg.raw, seg.date, `${source}:dated`, 2);
    if (entry) entries.push(entry);
  }
  return entries;
}

// ── Strategy: Sectioned ──────────────────────────────────────────────────────

/** Split on any header (# to ######). */
function parseSectioned(content: string, source: string, fileDate: string): ParsedEntry[] {
  const entries: ParsedEntry[] = [];
  let buffer = '';

  for (const rawLine of content.split('\n')) {
    const trimmed = rawLine.trim();
    if (isHeader(trimmed)) {
      const entry = maybeFlush(buffer, fileDate, `${source}:section`, 1);
      if (entry) entries.push(entry);
      buffer = '';
      continue;
    }
    if (isSkippableLine(trimmed)) continue;
    buffer += rawLine + '\n';
  }
  const entry = maybeFlush(buffer, fileDate, `${source}:section`, 1);
  if (entry) entries.push(entry);
  return entries;
}

// ── Strategy: Bullet ─────────────────────────────────────────────────────────

/** Extract each bullet / numbered item as its own entry. */
export function extractBullets(text: string, date: string, meta: string): ParsedEntry[] {
  const entries: ParsedEntry[] = [];
  let buffer = '';

  function flush(): void {
    const entry = maybeFlush(buffer, date, meta, 2);
    if (entry) entries.push(entry);
    buffer = '';
  }

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (isHeader(trimmed) || trimmed === '---') {
      flush();
      continue;
    }
    if (isSkippableLine(trimmed)) {
      if (buffer) flush();
      continue;
    }

    const isBullet = /^[-*+]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed);
    if (isBullet) {
      flush();
      buffer = trimmed.replace(/^[-*+\d.]\s+/, '');
    } else if (buffer) {
      buffer += ' ' + trimmed;
    }
  }
  flush();
  return entries;
}

function parseBullet(content: string, source: string, fileDate: string): ParsedEntry[] {
  return extractBullets(content, fileDate, `${source}:bullet`);
}

// ── Strategy: Paragraph ──────────────────────────────────────────────────────

/** Split on blank lines, treating each block as an entry. */
function parseParagraph(content: string, source: string, fileDate: string): ParsedEntry[] {
  const entries: ParsedEntry[] = [];
  for (const block of content.split(/\n{2,}/)) {
    const trimmed = block.trim();
    if (trimmed.length < MIN_ENTRY_LENGTH) continue;
    if (isSkippableLine(trimmed) || isHeader(trimmed)) continue;
    const entry = maybeFlush(trimmed, fileDate, `${source}:paragraph`, 0);
    if (entry) entries.push(entry);
  }
  return entries;
}

// ── Strategy: Mixed ──────────────────────────────────────────────────────────

/** Run all strategies, deduplicate by content hash. */
function parseMixed(content: string, source: string, fileDate: string): ParsedEntry[] {
  const all = [
    ...parseDated(content, source, fileDate),
    ...parseSectioned(content, source, fileDate),
    ...parseBullet(content, source, fileDate),
    ...parseParagraph(content, source, fileDate),
  ];
  return dedupeEntries(all);
}

// ── File Type Detection ──────────────────────────────────────────────────────

function detectFileType(
  filename: string,
): 'dated' | 'sectioned' | 'bullet' | 'paragraph' | 'mixed' {
  const lower = filename.toLowerCase();
  if (/^\d{4}-\d{2}-\d{2}/.test(lower)) return 'dated';
  if (lower.includes('memory') && lower.endsWith('.md')) return 'mixed';
  if (lower === 'user.md' || lower === 'soul.md') return 'paragraph';
  if (lower === 'agents.md' || lower === 'tools.md' || lower === 'heartbeat.md') return 'sectioned';
  if (lower === 'dreams.md') return 'mixed';
  return 'mixed';
}

/** Unified parser — selects strategy by file type. */
export function parseFile(content: string, filename: string, fileDate: string): ParsedEntry[] {
  const type = detectFileType(filename);
  switch (type) {
    case 'dated':
      return parseDated(content, filename, fileDate);
    case 'sectioned':
      return parseSectioned(content, filename, fileDate);
    case 'bullet':
      return parseBullet(content, filename, fileDate);
    case 'paragraph':
      return parseParagraph(content, filename, fileDate);
    case 'mixed':
      return parseMixed(content, filename, fileDate);
    default:
      return parseMixed(content, filename, fileDate);
  }
}
