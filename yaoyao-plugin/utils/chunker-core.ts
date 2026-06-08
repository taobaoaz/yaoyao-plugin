/**
 * utils/chunker-core.ts — Core chunking algorithm.
 */
import type { ChunkerConfig, ChunkMetadata, ChunkResult } from './chunker.ts';
import { findSplitEnd, clamp } from './chunker-split.ts';

function sliceTrimWithIndices(
  text: string,
  start: number,
  end: number,
): { chunk: string; meta: ChunkMetadata } {
  const raw = text.slice(start, end);
  const leading = raw.match(/^\s*/)?.[0]?.length ?? 0;
  const trailing = raw.match(/\s*$/)?.[0]?.length ?? 0;
  const chunk = raw.trim();

  const trimmedStart = start + leading;
  const trimmedEnd = end - trailing;

  return {
    chunk,
    meta: {
      startIndex: trimmedStart,
      endIndex: Math.max(trimmedStart, trimmedEnd),
      length: chunk.length,
    },
  };
}

export function chunkDocumentImpl(text: string, config: ChunkerConfig): ChunkResult {
  if (!text || text.trim().length === 0) {
    return { chunks: [], metadatas: [], totalOriginalLength: 0, chunkCount: 0 };
  }

  const totalOriginalLength = text.length;
  const chunks: string[] = [];
  const metadatas: ChunkMetadata[] = [];

  let pos = 0;
  const maxGuard = Math.max(
    4,
    Math.ceil(text.length / Math.max(1, config.maxChunkSize - config.overlapSize)) + 5,
  );
  let guard = 0;

  while (pos < text.length && guard < maxGuard) {
    guard++;

    const remaining = text.length - pos;
    if (remaining <= config.maxChunkSize) {
      const { chunk, meta } = sliceTrimWithIndices(text, pos, text.length);
      if (chunk.length > 0) {
        chunks.push(chunk);
        metadatas.push(meta);
      }
      break;
    }

    const maxEnd = Math.min(pos + config.maxChunkSize, text.length);
    const minEnd = Math.min(pos + config.minChunkSize, maxEnd);

    const end = findSplitEnd(text, pos, maxEnd, minEnd, config);
    const { chunk, meta } = sliceTrimWithIndices(text, pos, end);

    if (chunk.length < config.minChunkSize) {
      const hardEnd = Math.min(pos + config.maxChunkSize, text.length);
      const hard = sliceTrimWithIndices(text, pos, hardEnd);
      if (hard.chunk.length > 0) {
        chunks.push(hard.chunk);
        metadatas.push(hard.meta);
      }
      if (hardEnd >= text.length) break;
      pos = Math.max(hardEnd - config.overlapSize, pos + 1);
      continue;
    }

    chunks.push(chunk);
    metadatas.push(meta);

    if (end >= text.length) break;

    const nextPos = Math.max(end - config.overlapSize, pos + 1);
    pos = nextPos;
  }

  return {
    chunks,
    metadatas,
    totalOriginalLength,
    chunkCount: chunks.length,
  };
}
