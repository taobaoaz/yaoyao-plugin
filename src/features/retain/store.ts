/**
 * features/retain/store.ts — Retain data persistence.
 *
 * File I/O for boost records and important tags.
 */
import fs from "node:fs";
import path from "node:path";
import type { BoostRecord, ImportantTag } from "../../core/retain/retain.ts";

const PIPELINE_DIR = ".pipeline";
const BOOST_FILE = ".retain-boost.jsonl";
const IMPORTANT_FILE = ".important-tags.json";

function boostFilePath(baseDir: string): string {
  return path.join(baseDir, PIPELINE_DIR, BOOST_FILE);
}

function importantTagsFilePath(baseDir: string): string {
  return path.join(baseDir, PIPELINE_DIR, IMPORTANT_FILE);
}

function ensurePipelineDir(baseDir: string): void {
  const d = path.join(baseDir, PIPELINE_DIR);
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

export function loadBoostRecords(baseDir: string): BoostRecord[] {
  const fp = boostFilePath(baseDir);
  const records: BoostRecord[] = [];
  try {
    if (!fs.existsSync(fp)) return records;
    const raw = fs.readFileSync(fp, "utf-8");
    for (const line of raw.split("\n").filter(Boolean)) {
      try { records.push(JSON.parse(line) as BoostRecord); } catch { /* skip */ }
    }
  } catch { /* best effort */ }
  return records;
}

export function appendBoostRecord(baseDir: string, record: BoostRecord): void {
  ensurePipelineDir(baseDir);
  const fp = boostFilePath(baseDir);
  fs.appendFileSync(fp, JSON.stringify(record) + "\n", "utf-8");
}

export function loadImportantTags(baseDir: string): ImportantTag[] {
  const fp = importantTagsFilePath(baseDir);
  try {
    if (!fs.existsSync(fp)) return [];
    return JSON.parse(fs.readFileSync(fp, "utf-8")) as ImportantTag[];
  } catch { return []; }
}

export function saveImportantTags(baseDir: string, tags: ImportantTag[]): void {
  ensurePipelineDir(baseDir);
  const fp = importantTagsFilePath(baseDir);
  fs.writeFileSync(fp, JSON.stringify(tags, null, 2), "utf-8");
}
