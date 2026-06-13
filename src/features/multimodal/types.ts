/**
 * features/multimodal/types.ts (v1.8.x hidden feature).
 */
export type Modality = "image" | "audio" | "video";
export type SourceType = "url" | "path" | "base64";
export interface MultimodalMemory {
  id: string;
  type: Modality;
  description: string;
  tags: string[];
  mimeType: string;
  sizeBytes: number;
  sourceType: SourceType;
  sourceRef: string;
  sha256: string;
  metadata: Record<string, unknown>;
  extractedText?: string;
  linkedMemoryIds: string[];
  createdAt: number;
  updatedAt: number;
}

/** Filter for list() */
export interface MultimodalListFilter {
  type?: Modality;
  tags?: string[];
  limit?: number;
  offset?: number;
}

/** Search result extends the entry with score + matched snippet. */
export interface MultimodalSearchResult extends MultimodalMemory {
  score: number;
  snippet?: string;
}
