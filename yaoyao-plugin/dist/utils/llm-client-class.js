export class LLMClient {
    config;
    constructor(config) {
        this.config = config;
    }
    async chat(messages, options) {
        const baseUrl = this.config.baseUrl.replace(/\/$/, '');
        const path = baseUrl.endsWith('/v1') ? '' : '/v1';
        const url = `${baseUrl}${path}/chat/completions`;
        const body = {
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
            body.response_format = { type: 'json_object' };
        }
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${this.config.apiKey}`,
                },
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            if (!res.ok) {
                const text = await Promise.race([
                    res.text(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Response body read timed out')), 15000)),
                ]).catch(() => 'unknown');
                throw new Error(`LLM API error ${res.status}: ${text.slice(0, 200)}`);
            }
            const data = await Promise.race([
                res.json(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Response body read timed out')), 15000)),
            ]);
            const firstChoice = data.choices?.[0];
            const message = firstChoice?.message;
            return {
                content: message?.content || '',
                model: data.model || this.config.model,
                usage: data.usage || {
                    prompt: 0,
                    completion: 0,
                    total: 0,
                },
            };
        }
        catch (err) {
            if (err instanceof Error && err.name === 'AbortError') {
                throw new Error('LLM request timed out after 30s', { cause: err });
            }
            throw err;
        }
        finally {
            clearTimeout(timeout);
        }
    }
    async extract(systemPrompt, userPrompt) {
        const res = await this.chat([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
        ], { json: true, temperature: 0.1 });
        return res.content;
    }
}
