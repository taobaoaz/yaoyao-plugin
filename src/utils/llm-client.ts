/**
 * LLM Client — lightweight OpenAI-compatible API caller.
 * Accepts raw plugin config and looks for llm/embedding fields.
 */
import { getObj } from "./config.ts";
import { DEFAULT_PROVIDER_MODELS, detectModel, isForbiddenHost } from "./llm-client-utils.ts";
import { LLMClient } from "./llm-client-class.ts";

export interface LLMConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMResponse {
  content: string;
  model: string;
  usage: { prompt: number; completion: number; total: number };
}

export { DEFAULT_PROVIDER_MODELS, detectModel };
export { LLMClient };

export interface CreateLLMClientResult {
  client: LLMClient | null;
  source: "explicit" | "embedding-auto" | null;
}

export function createLLMClient(
  config: Record<string, unknown> | undefined,
  embeddingConfig?: Record<string, unknown> | null
): CreateLLMClientResult {
  const result: CreateLLMClientResult = { client: null, source: null };

  if (!config || typeof config !== "object") return result;

  const llmSection = getObj(config, "llm") || {};
  const providerModels = (llmSection.providerModels || {}) as Record<string, string> | undefined;

  const llmApiKey = String(llmSection.apiKey || "");
  if (llmApiKey) {
    const baseUrl = String(llmSection.baseUrl || "").trim();
    if (!baseUrl) return result;
    if (isForbiddenHost(baseUrl)) return result;
    const model = String(llmSection.model || detectModel(baseUrl, providerModels));
    if (!model) return result;
    result.client = new LLMClient({ apiKey: llmApiKey, baseUrl, model });
    result.source = "explicit";
    return result;
  }

  if (embeddingConfig && typeof embeddingConfig === "object") {
    const embeddingApiKey = String(embeddingConfig.apiKey || "");
    const embeddingEnabled = embeddingConfig.enabled !== false;
    if (embeddingApiKey && embeddingEnabled) {
      const baseUrl = String(embeddingConfig.baseUrl || "").trim();
      if (!baseUrl) return result;
      if (isForbiddenHost(baseUrl)) return result;
      const model = detectModel(baseUrl, providerModels);
      if (!model) return result;
      result.client = new LLMClient({ apiKey: embeddingApiKey, baseUrl, model });
      result.source = "embedding-auto";
      return result;
    }
  }

  return result;
}
