/**
 * features/multimodal/processor.ts — Business logic for multimodal memories (v1.8.x hidden feature).
 *
 * Pure functions wrapping MultimodalStorage: save / get / list / search / link / delete.
 * Search uses description+tags+extractedText substring match (cross-modal embedding
 * is out of scope; the hook is reserved for future vision/audio encoders).
 */
import { statSync } from "node:fs";
import { MultimodalStorage, newMultimodalId, sha256OfBytes } from "./storage.ts";
import type {
  MultimodalMemory,
  MultimodalListFilter,
  MultimodalSearchResult,
  Modality,
  SourceType,
} from "./types.ts";

export interface SaveMultimodalInput {
  type: Modality;
  description: string;
  sourceType: SourceType;
  source: string;
  mimeType?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  extractedText?: string;
  id?: string;
}

export interface SaveMultimodalResult {
  ok: boolean;
  entry?: MultimodalMemory;
  error?: string;
}

function guessMime(t: Modality, hint?: string): string {
  if (hint) return hint;
  if (t === "image") return "image/png";
  if (t === "audio") return "audio/mpeg";
  return "video/mp4";
}

function guessExt(mimeType: string): string {
  const m = (mimeType || "").toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("gif")) return "gif";
  if (m.includes("webp")) return "webp";
  if (m.includes("svg")) return "svg";
  if (m.includes("wav")) return "wav";
  if (m.includes("flac")) return "flac";
  if (m.includes("ogg")) return "ogg";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("m4a")) return "m4a";
  if (m.includes("mp4")) return "mp4";
  if (m.includes("webm")) return "webm";
  if (m.includes("quicktime")) return "mov";
  if (m.includes("matroska")) return "mkv";
  return "bin";
}

function describeModality(t: Modality): string {
  return t === "image" ? "[image]" : t === "audio" ? "[audio]" : "[video]";
}

export class MultimodalProcessor {
  private storage: MultimodalStorage;

  constructor(rootDir: string) {
    this.storage = new MultimodalStorage(rootDir);
  }

  getStorage(): MultimodalStorage {
    return this.storage;
  }

  save(input: SaveMultimodalInput, maxFileSizeMb = 50): SaveMultimodalResult {
    try {
      const id = input.id || newMultimodalId();
      const mimeType = guessMime(input.type, input.mimeType);
      const ext = guessExt(mimeType);
      const now = Date.now();

      let sizeBytes = 0;
      let sha256 = "";
      let sourceRef = input.source;

      if (input.sourceType === "base64") {
        const bytes = Buffer.from(input.source, "base64");
        if (bytes.length > maxFileSizeMb * 1024 * 1024) {
          return { ok: false, error: "file too large: " + bytes.length + "B > " + maxFileSizeMb + "MB" };
        }
        const stored = this.storage.saveContent(id, ext, bytes);
        sizeBytes = stored.sizeBytes;
        sha256 = stored.sha256;
        sourceRef = stored.contentPath;
      } else if (input.sourceType === "url") {
        sha256 = sha256OfBytes(Buffer.from(input.source));
        sizeBytes = input.source.length;
      } else {
        // path
        try {
          const st = statSync(input.source);
          if (st.size > maxFileSizeMb * 1024 * 1024) {
            return { ok: false, error: "file too large: " + st.size + "B > " + maxFileSizeMb + "MB" };
          }
          sizeBytes = st.size;
        } catch (e: unknown) {
          return { ok: false, error: "cannot access path: " + ((e as Error).message || String(e)) };
        }
        sha256 = sha256OfBytes(Buffer.from(input.source + ":" + sizeBytes));
      }

      const entry: MultimodalMemory = {
        id,
        type: input.type,
        description: input.description,
        tags: input.tags || [],
        mimeType,
        sizeBytes,
        sourceType: input.sourceType,
        sourceRef,
        sha256,
        metadata: input.metadata || {},
        extractedText: input.extractedText,
        linkedMemoryIds: [],
        createdAt: now,
        updatedAt: now,
      };

      this.storage.upsert(entry);
      return { ok: true, entry };
    } catch (e: unknown) {
      return { ok: false, error: (e as Error).message || String(e) };
    }
  }

  get(id: string): MultimodalMemory | null {
    return this.storage.get(id);
  }

  list(filter: MultimodalListFilter = {}): { items: MultimodalMemory[]; total: number } {
    return this.storage.list(filter);
  }

  search(query: string, opts: { type?: Modality; limit?: number } = {}): MultimodalSearchResult[] {
    const q = (query || "").trim().toLowerCase();
    if (!q) return [];
    const tokens = q.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return [];

    let items = this.storage.loadIndex();
    if (opts.type) items = items.filter(e => e.type === opts.type);

    const results: MultimodalSearchResult[] = [];
    for (const e of items) {
      const hay = (e.description + " " + (e.extractedText || "") + " " + e.tags.join(" ")).toLowerCase();
      let hits = 0;
      let firstHit = -1;
      for (const t of tokens) {
        const i = hay.indexOf(t);
        if (i >= 0) {
          hits++;
          if (firstHit < 0 || i < firstHit) firstHit = i;
        }
      }
      if (hits === 0) continue;
      const score = hits / tokens.length;
      const snippet = firstHit >= 0
        ? hay.slice(Math.max(0, firstHit - 20), Math.min(hay.length, firstHit + 60))
        : undefined;
      results.push({ ...e, score, snippet });
    }

    results.sort((a, b) => b.score - a.score || b.createdAt - a.createdAt);
    const limit = Math.max(1, Math.min(100, opts.limit || 10));
    return results.slice(0, limit);
  }

  link(id: string, memoryId: string): boolean {
    return this.storage.linkMemory(id, memoryId);
  }

  delete(id: string): boolean {
    const entry = this.storage.get(id);
    if (!entry) return false;
    const ext = guessExt(entry.mimeType);
    return this.storage.remove(id, ext);
  }

  formatEntry(e: MultimodalMemory, snippet?: string): string {
    const lines = [
      describeModality(e.type) + " " + e.id,
      "  描述: " + e.description,
      "  MIME: " + e.mimeType + "  大小: " + e.sizeBytes + "B",
      "  标签: " + (e.tags.length ? e.tags.join(", ") : "(无)"),
      "  来源: " + e.sourceType + "  引用: " + e.sourceRef,
      "  SHA-256: " + e.sha256.slice(0, 16) + "...",
      "  创建: " + new Date(e.createdAt).toISOString(),
    ];
    if (snippet) lines.push("  片段: " + snippet);
    if (e.extractedText) lines.push("  提取: " + e.extractedText.slice(0, 120));
    if (e.linkedMemoryIds.length) lines.push("  关联文本记忆: " + e.linkedMemoryIds.join(", "));
    return lines.join("\n");
  }
}
