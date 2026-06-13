/**
 * utils/llm-client-class.ts — LLMClient implementation.
 */
import type { LLMConfig, LLMMessage, LLMResponse } from "./llm-client.ts";

export class LLMClient {
  public config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;
  }

  async chat(messages: LLMMessage[], options?: { temperature?: number; maxTokens?: number; json?: boolean }): Promise<LLMResponse> {
    let baseUrl = this.config.baseUrl.replace(/\/$/, "");
    const path = baseUrl.endsWith("/v1") ? "" : "/v1";
    const url = `${baseUrl}${path}/chat/completions`;

    const body: Record<string, unknown> = {
      model: this.config.model,
      messages,
    };

    if (options?.temperature !== undefined) {
      body.temperature = options.temperature;
    }
    if (options?.maxTokens !== undefined) {
      body.max_tokens = options.maxTokens;
    }

    if (options?.json) {
      body.response_format = { type: "json_object" };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await Promise.race([
          res.text(),
          new Promise<string>((_, reject) =>
            setTimeout(() => reject(new Error("Response body read timed out")), 15000)
          ),
        ]).catch(() => "unknown");
        throw new Error(`LLM API error ${res.status}: ${text.slice(0, 200)}`);
      }

      const data = await Promise.race([
        res.json() as Promise<Record<string, unknown>>,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Response body read timed out")), 15000)
        ),
      ]);
      const firstChoice = (data.choices as Array<Record<string, unknown>>)?.[0] as Record<string, unknown> | undefined;
      const message = firstChoice?.message as Record<string, unknown> | undefined;
      return {
        content: (message?.content as string) || "",
        model: (data.model as string) || this.config.model,
        usage: (data.usage as { prompt: number; completion: number; total: number }) || { prompt: 0, completion: 0, total: 0 },
      };
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error("LLM request timed out after 30s");
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  async extract(systemPrompt: string, userPrompt: string): Promise<string> {
    const res = await this.chat([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ], { json: true, temperature: 0.1 });
    return res.content;
  }
}
