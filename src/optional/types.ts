/**
 * Optional Feature types — unified interface for pluggable features.
 *
 * Every optional capability (embedding, LLM, cloud sync, verify, etc.)
 * implements this interface so the registry can manage them uniformly.
 */
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { YaoyaoMemoryConfig } from "../utils/memory-store.js";

/** Result of initializing a feature */
export interface FeatureResult<T = unknown> {
  /** Whether the feature is active */
  active: boolean;
  /** The initialized service/instance (null if inactive) */
  service: T | null;
  /** Human-readable status message for logs */
  message: string;
  /** Optional warning if feature is partially working */
  warning?: string;
}

/** Optional feature interface */
export interface OptionalFeature<T = unknown> {
  /** Unique identifier */
  readonly id: string;
  /** Display name */
  readonly name: string;
  /** IDs of other features this one depends on */
  readonly dependencies: string[];
  /** Config key path that controls this feature (e.g. "embedding.enabled") */
  readonly configKey?: string;
  /** Default enabled state when configKey is absent */
  readonly defaultEnabled: boolean;

  /**
   * Initialize the feature.
   *
   * @param api   — OpenClaw plugin API
   * @param config — plugin config
   * @param deps  — already-initialized dependent features (id → FeatureResult)
   * @returns FeatureResult — active=false means graceful skip
   */
  init(
    api: OpenClawPluginApi,
    config: YaoyaoMemoryConfig,
    deps: Map<string, FeatureResult>
  ): FeatureResult<T>;

  /** Clean up resources when plugin stops */
  close?(result: FeatureResult<T>): void;
}

/** Resolved features map — populated after registry.initAll() */
export type ResolvedFeatures = Map<string, FeatureResult>;
