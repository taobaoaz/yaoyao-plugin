/**
 * LLM Client — lightweight OpenAI-compatible API caller.
 * Accepts raw plugin config and looks for llm/embedding fields.
 */
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

/** Create an LLM client from plugin config (llm section) */
export function createLLMClient(config: Record<string, unknown> | undefined): LLMClient | null {
  if (!config || typeof config !== "object") return null;
  // Look for llm section first, then fallback to top-level fields
  const llmSection = (config.llm || {}) as Record<string, unknown>;
  const apiKey = String(llmSection.apiKey || "");
  const baseUrl = String(llmSection.baseUrl || "");
  const model = String(llmSection.model || "");

  if (!apiKey) return null;

  return new LLMClient({
    apiKey,
    baseUrl: baseUrl || "https://api.deepseek.com",
    model: model || "deepseek-chat",
  });
}

export class LLMClient {
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;
  }

  async chat(messages: LLMMessage[], options?: { temperature?: number; maxTokens?: number; json?: boolean }): Promise<LLMResponse> {
    let baseUrl = this.config.baseUrl.replace(/\/$/, "");
    // Handle baseUrl that already contains /v1 prefix (e.g. https://ai.gitee.com/v1)
    const path = baseUrl.endsWith("/v1") ? "" : "/v1";
    const url = `${baseUrl}${path}/chat/completions`;

    const body: Record<string, unknown> = {
      model: this.config.model,
      messages,
      temperature: options?.temperature ?? 0.3,
      max_tokens: options?.maxTokens ?? 4096,
    };

    if (options?.json) {
      body.response_format = { type: "json_object" };
    }

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "unknown");
      throw new Error(`LLM API error ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = await res.json() as any;
    return {
      content: data.choices?.[0]?.message?.content || "",
      model: data.model || this.config.model,
      usage: data.usage || { prompt: 0, completion: 0, total: 0 },
    };
  }

  async extract(systemPrompt: string, userPrompt: string): Promise<string> {
    const res = await this.chat([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ], { json: true, temperature: 0.1 });
    return res.content;
  }
}
