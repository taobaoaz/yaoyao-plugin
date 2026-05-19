/**
 * Long Context Chunking System
 * 从 Brain (memory-lancedb-pro) 学习：CJK 友好的语义分块
 * 零外部依赖，纯本地
 */

export interface ChunkMetadata {
  startIndex: number;
  endIndex: number;
  length: number;
}

export interface ChunkResult {
  chunks: string[];
  metadatas: ChunkMetadata[];
  totalOriginalLength: number;
  chunkCount: number;
}

export interface ChunkerConfig {
  maxChunkSize: number;
  overlapSize: number;
  minChunkSize: number;
  semanticSplit: boolean;
  maxLinesPerChunk: number;
}

export const DEFAULT_CHUNKER_CONFIG: ChunkerConfig = {
  maxChunkSize: 4000,
  overlapSize: 200,
  minChunkSize: 200,
  semanticSplit: true,
  maxLinesPerChunk: 50,
};

import { chunkDocumentImpl } from "./chunker-core.ts";
import { findSplitEnd, clamp, countLines, SENTENCE_ENDING } from "./chunker-split.ts";

export { findSplitEnd, clamp, countLines, SENTENCE_ENDING };

// CJK Unicode ranges
const CJK_RE =
  /[\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/;

function getCjkRatio(text: string): number {
  let cjk = 0;
  let total = 0;
  for (const ch of text) {
    if (/\s/.test(ch)) continue;
    total++;
    if (CJK_RE.test(ch)) cjk++;
  }
  return total === 0 ? 0 : cjk / total;
}

const CJK_CHAR_TOKEN_DIVISOR = 2.5;
const CJK_RATIO_THRESHOLD = 0.3;

export function chunkDocument(text: string, config: ChunkerConfig = DEFAULT_CHUNKER_CONFIG): ChunkResult {
  return chunkDocumentImpl(text, config);
}

export function smartChunk(text: string, targetLimit = 8192): ChunkResult {
  const cjkHeavy = getCjkRatio(text) > CJK_RATIO_THRESHOLD;
  const divisor = cjkHeavy ? CJK_CHAR_TOKEN_DIVISOR : 1;

  const config: ChunkerConfig = {
    maxChunkSize: Math.max(200, Math.floor(targetLimit * 0.7 / divisor)),
    overlapSize: Math.max(0, Math.floor(targetLimit * 0.05 / divisor)),
    minChunkSize: Math.max(100, Math.floor(targetLimit * 0.1 / divisor)),
    semanticSplit: true,
    maxLinesPerChunk: 50,
  };

  return chunkDocumentImpl(text, config);
}
