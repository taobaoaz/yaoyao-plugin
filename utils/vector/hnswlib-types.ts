/**
 * utils/vector/hnswlib-types.ts — HNSW type definitions.
 */

export interface HnswlibModule {
  HierarchicalNSW: new (space: string, dimensions: number) => HnswIndex;
}

export interface HnswIndex {
  initIndex(opts: { maxElements: number; allowReplaceDeleted?: boolean }): void;
  addPoint(vector: number[], label: number): void;
  markDelete(label: number): void;
  searchKnn(query: number[], k: number): { distances: number[]; neighbors: number[] };
  writeIndexSync(filepath: string): void;
  readIndexSync(filepath: string): void;
  getCurrentCount(): number;
}

export interface HnswMeta {
  dimensions: number;
  model?: string;
  count: number;
  space: string;
  dim?: number;
  ef_construction?: number;
  max_elements?: number;
  indexType?: string;
}
