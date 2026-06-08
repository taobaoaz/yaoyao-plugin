/**
 * Self-Improvement Log — 学习和错误记录
 * 从 Brain (memory-lancedb-pro) 学习：结构化记录经验
 * 零外部依赖，纯本地文件操作
 */

import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const DEFAULT_LEARNINGS_TEMPLATE = `# Learnings

Append structured entries:
- LRN-YYYYMMDD-XXX for corrections / best practices / knowledge gaps
- Include summary, details, suggested action, metadata, and status`;

export const DEFAULT_ERRORS_TEMPLATE = `# Errors

Append structured entries:
- ERR-YYYYMMDD-XXX for command/tool/integration failures
- Include symptom, context, probable cause, and prevention`;

const fileWriteQueues = new Map<string, Promise<void>>();

async function withFileWriteQueue<T>(filePath: string, action: () => Promise<T>): Promise<T> {
  const previous = fileWriteQueues.get(filePath) ?? Promise.resolve();
  let release: (() => void) | undefined;
  const lock = new Promise<void>((resolve) => {
    release = resolve;
  });
  const next = previous.then(() => lock);
  fileWriteQueues.set(filePath, next);

  await previous;
  try {
    return await action();
  } finally {
    release?.();
    if (fileWriteQueues.get(filePath) === next) {
      fileWriteQueues.delete(filePath);
    }
  }
}

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

async function nextLearningId(filePath: string, prefix: 'LRN' | 'ERR'): Promise<string> {
  const date = todayYmd();
  let count = 0;
  try {
    const content = await readFile(filePath, 'utf-8');
    const matches = content.match(new RegExp(`\\[${prefix}-${date}-\\d{3}\\]`, 'g'));
    count = matches?.length ?? 0;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[yaoyao-memory] ignore: ${msg}`);
  }
  return `${prefix}-${date}-${String(count + 1).padStart(3, '0')}`;
}

export async function ensureSelfImprovementFiles(baseDir: string): Promise<void> {
  const learningsDir = join(baseDir, '.learnings');
  await mkdir(learningsDir, { recursive: true });

  const ensureFile = async (filePath: string, content: string) => {
    try {
      const existing = await readFile(filePath, 'utf-8');
      if (existing.trim().length > 0) return;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[yaoyao-memory] write default below: ${msg}`);
    }
    await writeFile(filePath, `${content.trim()}\n`, 'utf-8');
  };

  await ensureFile(join(learningsDir, 'LEARNINGS.md'), DEFAULT_LEARNINGS_TEMPLATE);
  await ensureFile(join(learningsDir, 'ERRORS.md'), DEFAULT_ERRORS_TEMPLATE);
}

export interface AppendSelfImprovementEntryParams {
  baseDir: string;
  type: 'learning' | 'error';
  summary: string;
  details?: string;
  suggestedAction?: string;
  category?: string;
  area?: string;
  priority?: string;
  status?: string;
  source?: string;
}

export async function appendSelfImprovementEntry(
  params: AppendSelfImprovementEntryParams,
): Promise<{ id: string; filePath: string }> {
  const {
    baseDir,
    type,
    summary,
    details = '',
    suggestedAction = '',
    category = 'best_practice',
    area = 'config',
    priority = 'medium',
    status = 'pending',
    source = 'yaoyao-memory/self_improvement_log',
  } = params;

  await ensureSelfImprovementFiles(baseDir);
  const learningsDir = join(baseDir, '.learnings');
  const fileName = type === 'learning' ? 'LEARNINGS.md' : 'ERRORS.md';
  const filePath = join(learningsDir, fileName);
  const idPrefix = type === 'learning' ? 'LRN' : 'ERR';

  const id = await withFileWriteQueue(filePath, async () => {
    const entryId = await nextLearningId(filePath, idPrefix);
    const nowIso = new Date().toISOString();
    const titleSuffix = type === 'learning' ? ` ${category}` : '';
    const entry = [
      `## [${entryId}]${titleSuffix}`,
      '',
      `**Logged**: ${nowIso}`,
      `**Priority**: ${priority}`,
      `**Status**: ${status}`,
      `**Area**: ${area}`,
      '',
      '### Summary',
      summary.trim(),
      '',
      '### Details',
      details.trim() || '-',
      '',
      '### Suggested Action',
      suggestedAction.trim() || '-',
      '',
      '### Metadata',
      `- Source: ${source}`,
      '---',
      '',
    ].join('\n');
    const prev = await readFile(filePath, 'utf-8').catch(() => '');
    const separator = prev.trimEnd().length > 0 ? '\n\n' : '';
    await appendFile(filePath, `${separator}${entry}`, 'utf-8');
    return entryId;
  });

  return { id, filePath };
}
