/**
 * Tests for utils/llm-client.ts — LLM client config + model detection.
 *
 * Run: node --experimental-strip-types --test src/__tests__/llm-client.test.ts
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { DEFAULT_PROVIDER_MODELS, createLLMClient, LLMClient } from '../utils/llm-client.ts';
import type { LLMConfig } from '../utils/llm-client.ts';

describe('DEFAULT_PROVIDER_MODELS', () => {
  it('contains known providers', () => {
    assert.ok('deepseek' in DEFAULT_PROVIDER_MODELS);
    assert.ok('openai' in DEFAULT_PROVIDER_MODELS);
  });

  it('maps to non-empty model names', () => {
    for (const [provider, model] of Object.entries(DEFAULT_PROVIDER_MODELS)) {
      assert.ok(model.length > 0, `${provider} should map to a non-empty model`);
    }
  });
});

describe('createLLMClient', () => {
  it('returns result with null client when no LLM config is present', () => {
    const result = createLLMClient({});
    assert.strictEqual(result.client, null);
    assert.strictEqual(result.source, null);
  });

  it('returns null client when apiKey is missing', () => {
    const result = createLLMClient({
      llm: { baseUrl: 'https://api.openai.com/v1' },
    });
    assert.strictEqual(result.client, null);
  });

  it('returns null for internal URL (SSRF protection)', () => {
    const result = createLLMClient({
      llm: { apiKey: 'test', baseUrl: 'http://localhost:8080' },
    });
    assert.strictEqual(result.client, null);
  });

  it('creates client with explicit config and auto-detected model', () => {
    const result = createLLMClient({
      llm: {
        apiKey: 'test-key',
        baseUrl: 'https://api.openai.com/v1',
      },
      embedding: {},
    });
    assert.ok(result.client !== null, 'Should create client');
    assert.strictEqual(result.source, 'explicit');
    assert.strictEqual(result.client!.config.apiKey, 'test-key');
    assert.strictEqual(result.client!.config.model, DEFAULT_PROVIDER_MODELS.openai);
  });

  it('uses custom model override', () => {
    const result = createLLMClient({
      llm: {
        apiKey: 'test-key',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-chat-v3',
      },
      embedding: {},
    });
    assert.ok(result.client !== null);
    assert.strictEqual(result.client!.config.model, 'deepseek-chat-v3');
  });

  it('detects model from deepseek baseUrl', () => {
    const result = createLLMClient({
      llm: {
        apiKey: 'test-key',
        baseUrl: 'https://api.deepseek.com/v1',
      },
      embedding: {},
    });
    assert.ok(result.client !== null);
    assert.strictEqual(result.client!.config.model, DEFAULT_PROVIDER_MODELS.deepseek);
  });

  it('auto-detects from embedding config when no explicit LLM', () => {
    const result = createLLMClient(
      {},
      { apiKey: 'embed-key', baseUrl: 'https://api.openai.com/v1', enabled: true },
    );
    assert.ok(result.client !== null, 'Should create from embedding config');
    assert.strictEqual(result.source, 'embedding-auto');
  });

  it('returns null when embedding is not enabled', () => {
    const result = createLLMClient(
      {},
      { apiKey: 'embed-key', baseUrl: 'https://api.openai.com/v1', enabled: false },
    );
    assert.strictEqual(result.client, null);
  });
});

describe('LLMClient.chat (mocked fetch)', () => {
  let originalFetch: typeof globalThis.fetch;

  before(() => {
    originalFetch = globalThis.fetch;
  });
  after(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns parsed content from mocked API', async () => {
    globalThis.fetch = async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'Mocked reply!' } }],
          model: 'mock-v1',
          usage: { prompt: 5, completion: 10, total: 15 },
        }),
      }) as Response;

    const client = new LLMClient({
      apiKey: 'k',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
    });
    const res = await client.chat([{ role: 'user', content: 'Hi' }]);
    assert.strictEqual(res.content, 'Mocked reply!');
    assert.strictEqual(res.model, 'mock-v1');
    assert.strictEqual(res.usage.total, 15);
  });

  it('includes auth Bearer header', async () => {
    let auth = '';
    globalThis.fetch = async (_input, init) => {
      auth = (init?.headers as Record<string, string>)?.['Authorization'] || '';
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'ok' } }],
          model: 'm',
          usage: { prompt: 1, completion: 1, total: 2 },
        }),
      }) as Promise<Response>;
    };
    const client = new LLMClient({
      apiKey: 'sk-mykey',
      baseUrl: 'https://api.openai.com/v1',
      model: 'm',
    });
    await client.chat([{ role: 'user', content: 'hi' }]);
    assert.ok(auth.includes('sk-mykey'), 'Auth header should contain API key');
  });

  it('throws on HTTP error', async () => {
    globalThis.fetch = async () =>
      ({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: 'Unauthorized' } }),
        text: async () => JSON.stringify({ error: { message: 'Unauthorized' } }),
      }) as Response;

    const client = new LLMClient({
      apiKey: 'bad',
      baseUrl: 'https://api.openai.com/v1',
      model: 'm',
    });
    await assert.rejects(() => client.chat([{ role: 'user', content: 'hi' }]), { message: /401/ });
  });
});

describe('LLMClient.extract', () => {
  let originalFetch: typeof globalThis.fetch;
  before(() => {
    originalFetch = globalThis.fetch;
  });
  after(() => {
    globalThis.fetch = originalFetch;
  });

  it('sends system+user messages and returns content', async () => {
    globalThis.fetch = async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: '{"name":"Alice","age":30}' } }],
          model: 'm',
          usage: { prompt: 50, completion: 10, total: 60 },
        }),
      }) as Response;

    const client = new LLMClient({ apiKey: 'k', baseUrl: 'https://api.openai.com/v1', model: 'm' });
    const result = await client.extract('You are a parser', 'Parse this');
    assert.strictEqual(result, '{"name":"Alice","age":30}');
  });
});
