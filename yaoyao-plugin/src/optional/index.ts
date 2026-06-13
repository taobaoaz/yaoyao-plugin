/**
 * Optional features index — exports all optional features and the registry.
 */
export { createFeatureRegistry, FeatureRegistry } from "./registry.ts";
export type { OptionalFeature, FeatureResult, ResolvedFeatures } from "./types.ts";

// Feature modules
export { embeddingFeature } from "./features/embedding.ts";
export { llmFeature } from "./features/llm.ts";
export { cloudSyncFeature } from "./features/cloud-sync.ts";
export { verifyFeature } from "./features/verify.ts";
export { cleanerFeature } from "./features/cleaner.ts";
export { qualityFeature } from "./features/quality.ts";
export { retainFeature } from "./features/retain.ts";
export { graphFeature } from "./features/graph.ts";
