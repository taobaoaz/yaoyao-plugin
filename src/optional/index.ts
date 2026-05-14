/**
 * Optional features index — exports all optional features and the registry.
 */
export { createFeatureRegistry, FeatureRegistry } from "./registry.js";
export type { OptionalFeature, FeatureResult, ResolvedFeatures } from "./types.js";

// Feature modules
export { embeddingFeature } from "./features/embedding.js";
export { llmFeature } from "./features/llm.js";
export { cloudSyncFeature } from "./features/cloud-sync.js";
export { verifyFeature } from "./features/verify.js";
export { cleanerFeature } from "./features/cleaner.js";
export { qualityFeature } from "./features/quality.js";
export { retainFeature } from "./features/retain.js";
export { graphFeature } from "./features/graph.js";
