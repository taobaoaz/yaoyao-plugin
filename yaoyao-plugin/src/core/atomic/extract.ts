/**
 * core/atomic/extract.ts — Atomic fact extraction engines.
 */

import type { AtomicFact, FactExtractionResult, ExtractionMode } from "./types.ts";

// === Regex extractor (Lite mode, zero-dependency) ===

const ENTITY_PATTERNS = [
  /([我你他她它]|用户|AI|助手|小摇摇|yaoyao)/gi,
  /([A-Z][a-zA-Z]*)/g, // 首字母大写的词（包括单字母I）
  /(\d{4}-\d{2}-\d{2})/g, // 日期
  /([\u4e00-\u9fa5]{2,6})/g, // 中文名词
];

const RELATION_PATTERNS = [
  /(喜欢|讨厌|需要|想要|使用|创建|删除|更新|修复|优化|完成)/g,
  /(is|are|was|were|has|have|had|do|does|did|like|want|need|use|create|delete|update|fix|optimize)/gi,
];

function regexExtract(text: string): FactExtractionResult {
  const facts: AtomicFact[] = [];
  const entities = new Set<string>();
  let discarded = 0;

  // Split into sentences
  const sentences = text.split(/[。！？.!?\n]+/).filter((s) => s.trim().length > 5);

  for (const sentence of sentences) {
    const foundEntities: string[] = [];
    for (const pattern of ENTITY_PATTERNS) {
      const matches = sentence.match(pattern) ?? [];
      for (const m of matches) {
        foundEntities.push(m);
        entities.add(m);
      }
    }

    const foundRelations = [];
    for (const pattern of RELATION_PATTERNS) {
      const matches = sentence.match(pattern) ?? [];
      foundRelations.push(...matches);
    }

    if (foundEntities.length >= 2 && foundRelations.length > 0) {
      facts.push({
        id: `fact-${Date.now()}-${facts.length}`,
        subject: foundEntities[0] ?? "unknown",
        predicate: foundRelations[0] ?? "related_to",
        object: foundEntities[1] ?? "something",
        confidence: 0.5,
        source: "regex-extraction",
        timestamp: Date.now(),
        tags: [],
      });
    } else {
      discarded++;
    }
  }

  return { facts, entities: [...entities], discarded };
}

// === LLM extractor placeholder (Full mode) ===

function llmExtract(_text: string, _llmCallback?: (prompt: string) => Promise<string>): FactExtractionResult {
  // Placeholder: in Full mode, call LLM to extract structured facts
  // Expected LLM output: JSON array of {subject, predicate, object, confidence}
  return { facts: [], entities: [], discarded: 0 };
}

// === Hybrid extractor ===

function hybridExtract(text: string, llmCallback?: (prompt: string) => Promise<string>): FactExtractionResult {
  const regexResult = regexExtract(text);

  // If regex found enough facts, use them
  if (regexResult.facts.length >= 3) {
    return regexResult;
  }

  // Otherwise try LLM if available
  if (llmCallback) {
    const llmResult = llmExtract(text, llmCallback);
    if (llmResult.facts.length > 0) {
      return llmResult;
    }
  }

  return regexResult;
}

// === Public API ===

export function extractAtomicFacts(
  text: string,
  mode: ExtractionMode = "hybrid",
  llmCallback?: (prompt: string) => Promise<string>,
): FactExtractionResult {
  switch (mode) {
    case "regex":
      return regexExtract(text);
    case "llm":
      return llmExtract(text, llmCallback);
    case "hybrid":
    default:
      return hybridExtract(text, llmCallback);
  }
}
