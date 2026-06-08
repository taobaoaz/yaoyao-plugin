/**
 * core/search/entity-extractor.ts — Zero-dependency entity extraction.
 *
 * Extracts tech/framework/project names from text for entity boost.
 * Uses regex + curated entity list to avoid external NLP deps.
 *
 * Centralizes what was duplicated in multi-signal.ts and additive-scorer.ts.
 */
// ── Entity patterns ──
const ENTITY_PATTERNS = [
    // Tech acronyms/compound: ReactSDK, JavaOS, TypeScriptAPI
    /\b[A-Z][a-z]+(?:OS|SDK|API|DB|UI|UX|CLI|IDE|VM|AI)\b/g,
    // Verb + entity: "use React", "migrated to PostgreSQL", "switched to Vue"
    /\b(?:use|using|used|migrate|migrated|switch|switched|prefer|prefers|recommend|recommends)\s+([A-Z][a-zA-Z0-9_-]+)/g,
    // PascalCase multi-word: Clean Architecture, Hexagonal Architecture
    /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g,
    // Version numbers: Python 3.12, Node.js 20
    /\b([A-Za-z][\w.]+)\s+\d+\.\d+(?:\.\d+)?/g,
    // Backtick-quoted terms: `sqlite-vec`, `FTS5`
    /`([^`]+)`/g,
    // Version suffixes: react@18.2.0
    /\b([a-zA-Z][\w-]+)@[\d.]+/g,
    // File extensions: .tsx, .py, .go
    /\b([A-Za-z]\w{2,})\.(?:tsx?|jsx?|py|rs|go|java|kt|swift|rb|php|c(?:pp)?|h(?:pp)?)\b/g,
];
/** Curated knowledge base of entities (250+ entries) */
const KNOWN_ENTITIES = new Set([
    // ── Frameworks & libraries ──
    'react',
    'vue',
    'angular',
    'svelte',
    'solidjs',
    'preact',
    'lit',
    'stencil',
    'nextjs',
    'nuxt',
    'remix',
    'gatsby',
    'astro',
    'qwik',
    'express',
    'fastify',
    'nest',
    'nestjs',
    'spring',
    'springboot',
    'django',
    'flask',
    'rails',
    'tailwind',
    'bootstrap',
    'materialui',
    'chakra',
    'shadcn',
    'antd',
    'semanticui',
    'pytorch',
    'tensorflow',
    'keras',
    'jax',
    'langchain',
    'llamaindex',
    'huggingface',
    'transformers',
    'diffusers',
    'jquery',
    'lodash',
    'rxjs',
    'redux',
    'zustand',
    'jotai',
    'recoil',
    'prisma',
    'typeorm',
    'sequelize',
    'knex',
    'drizzle',
    'graphql',
    'apollo',
    'relay',
    'socketio',
    'grpc',
    'rest',
    'trpc',
    'electron',
    'tauri',
    'reactnative',
    'flutter',
    'ionic',
    'capacitor',
    // ── Languages ──
    'typescript',
    'javascript',
    'ecmascript',
    'python',
    'rust',
    'go',
    'golang',
    'java',
    'kotlin',
    'swift',
    'objectivec',
    'csharp',
    'cpp',
    'cplusplus',
    'ruby',
    'php',
    'scala',
    'elixir',
    'haskell',
    'clojure',
    'erlang',
    'zig',
    'nim',
    'vlang',
    'mojo',
    'dart',
    'sql',
    'bash',
    'shell',
    'powershell',
    'perl',
    'lua',
    // ── Databases ──
    'postgresql',
    'postgres',
    'mysql',
    'mariadb',
    'sqlite',
    'duckdb',
    'mongodb',
    'couchdb',
    'realm',
    'firestore',
    'redis',
    'valkey',
    'memcached',
    'elasticsearch',
    'opensearch',
    'meilisearch',
    'typesense',
    'clickhouse',
    'druid',
    'pinot',
    'cassandra',
    'scylla',
    'dynamodb',
    'cosmosdb',
    'neo4j',
    'arangodb',
    'janusgraph',
    'influxdb',
    'timescaledb',
    'questdb',
    'kafka',
    'pulsar',
    'rabbitmq',
    'nats',
    'zeromq',
    // ── Cloud & infra ──
    'aws',
    'gcp',
    'azure',
    'alicloud',
    'tencentcloud',
    'huaweicloud',
    'kubernetes',
    'k8s',
    'docker',
    'podman',
    'containerd',
    'terraform',
    'pulumi',
    'ansible',
    'chef',
    'puppet',
    'nginx',
    'caddy',
    'apache',
    'haproxy',
    'envoy',
    'traefik',
    'cloudflare',
    'fastly',
    'akamai',
    'vercel',
    'netlify',
    'render',
    'flyio',
    'railway',
    'github',
    'gitlab',
    'bitbucket',
    'gitea',
    'jenkins',
    'githubactions',
    'gitlabci',
    'circleci',
    'travis',
    // ── Architecture patterns ──
    'clean architecture',
    'hexagonal',
    'hexagonal architecture',
    'onion',
    'onion architecture',
    'microservices',
    'microservice',
    'monolith',
    'monolithic',
    'eventdriven',
    'eventsourcing',
    'cqrs',
    'event sourcing',
    'mvc',
    'mvvm',
    'mvp',
    'flux',
    'soa',
    'serverless',
    'lambda',
    'faas',
    'ddd',
    'domain driven design',
    'tdd',
    'bdd',
    'restful',
    'rest api',
    'graphql',
    // ── Chinese entities ──
    '微信',
    'wechat',
    '支付宝',
    'alipay',
    '华为',
    'huawei',
    '阿里',
    'alibaba',
    '腾讯',
    'tencent',
    '字节',
    'bytedance',
    '百度',
    'baidu',
    '小米',
    'xiaomi',
    '美团',
    'meituan',
    '京东',
    'jd',
    '拼多多',
    'pinduoduo',
    '滴滴',
    'didier',
    '鸿蒙',
    'harmonyos',
    'harmony',
    '方舟',
    '微博',
    'weibo',
    '小红书',
    'xhs',
    '抖音',
    'douyin',
    'tiktok',
    // ── Operating systems ──
    'linux',
    'macos',
    'windows',
    'ubuntu',
    'debian',
    'centos',
    'rhel',
    'fedora',
    'arch',
    'alpine',
    'suse',
    'redhat',
    'android',
    'ios',
    'ipados',
    'tvos',
    'watchos',
    'freebsd',
    'openbsd',
    'netbsd',
    // ── AI/ML ──
    'gpt',
    'gpt4',
    'gpt4o',
    'claude',
    'llama',
    'mistral',
    'gemini',
    'openai',
    'anthropic',
    'googleai',
    'rag',
    'finetune',
    'finetuning',
    'rlhf',
    'dpo',
    'ppo',
    'embedding',
    'embeddings',
    'vector',
    'semantic search',
    'llm',
    'ml',
    'nlp',
    'ner',
    'pos',
    // ── Testing ──
    'jest',
    'vitest',
    'mocha',
    'chai',
    'cypress',
    'playwright',
    'pytest',
    'unittest',
    'selenium',
    'webdriver',
]);
/** Minimum text length to attempt extraction */
const MIN_TEXT_LENGTH = 3;
// ── Public API ──
/**
 * Extract entity mentions from text.
 * Returns up to 10 unique entities, lowercased.
 */
export function extractEntities(text) {
    if (!text || text.length < MIN_TEXT_LENGTH)
        return [];
    const found = new Set();
    // Pattern-based extraction
    for (const pattern of ENTITY_PATTERNS) {
        const matches = text.matchAll(pattern);
        for (const m of matches) {
            const name = m[1] || m[0];
            const cleaned = name.toLowerCase().replace(/\s+/g, '');
            if (cleaned.length >= 2) {
                found.add(cleaned);
            }
        }
    }
    // Known entity lookup (case-insensitive substring match)
    const lower = text.toLowerCase();
    for (const entity of KNOWN_ENTITIES) {
        if (lower.includes(entity)) {
            found.add(entity);
        }
    }
    // Cap at 10 to avoid noise
    return Array.from(found).slice(0, 10);
}
/**
 * Compute entity overlap boost factor between query and memory text.
 *
 * Returns Jaccard similarity: |intersection| / |union|
 * Returns 0 if either side is empty.
 */
export function computeEntityBoost(queryEntities, memoryEntities) {
    if (queryEntities.length === 0 || memoryEntities.length === 0)
        return 0;
    const intersection = queryEntities.filter((e) => memoryEntities.includes(e));
    if (intersection.length === 0)
        return 0;
    const union = new Set([...queryEntities, ...memoryEntities]);
    return intersection.length / union.size;
}
/**
 * Extract entities AND compute boost in one call.
 */
export function computeEntityBoostFromTexts(query, memorySnippet) {
    if (!query || !memorySnippet)
        return 0;
    const queryEntities = extractEntities(query);
    const memoryEntities = extractEntities(memorySnippet);
    return computeEntityBoost(queryEntities, memoryEntities);
}
