/**
 * utils/llm-client-utils.ts — LLM client utilities.
 */

export const DEFAULT_PROVIDER_MODELS: Record<string, string> = {
  gitee: 'Qwen3-8B',
  deepseek: 'deepseek-chat',
  openai: 'gpt-4o-mini',
  siliconflow: 'Qwen/Qwen2.5-7B-Instruct',
  azure: 'gpt-4o-mini',
  anthropic: 'claude-3-5-sonnet-20241022',
  google: 'gemini-1.5-flash',
  ollama: 'llama3.1',
  groq: 'llama-3.1-70b-versatile',
  mistral: 'mistral-small-latest',
  fireworks: 'accounts/fireworks/models/llama-v3p1-70b-instruct',
};

/** Auto-detect LLM model name based on provider base URL. */
export function detectModel(baseUrl: string, customMap?: Record<string, string>): string {
  const url = baseUrl.toLowerCase();
  if (customMap) {
    for (const [provider, model] of Object.entries(customMap)) {
      if (url.includes(provider.toLowerCase())) return model;
    }
  }
  for (const [provider, model] of Object.entries(DEFAULT_PROVIDER_MODELS)) {
    if (url.includes(provider.toLowerCase())) return model;
  }
  return '';
}

/** SSRF protection: block internal / link-local / private IP ranges */
const FORBIDDEN_HOSTS = [
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '169.254',
  '192.168',
  '10.',
  '172.',
  'fc00',
  'fe80',
];

export function isForbiddenHost(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    const host = url.hostname.toLowerCase();
    return FORBIDDEN_HOSTS.some((h) => host === h || host.startsWith(h));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[yaoyao-memory:utils] Operation failed: ${msg}`);
    return true;
  }
}
