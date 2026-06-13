/**
 * utils/model-capabilities.ts — Multimodal capability classifier + cache (v1.8.3)
 *
 * 判断某个 LLM model 是否支持 image / audio / video 输入。
 *
 * 数据源（按优先级）：
 *   1. 精确匹配 STATIC_TABLE
 *   2. 模式匹配 STATIC_PATTERNS
 *   3. 缓存 (persisted 到 <memoryDir>/model-capabilities.json)
 *   4. 默认保守 (不支持任一模态)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type Modality = "image" | "audio" | "video";

export interface ModelCapabilities {
  image: boolean;
  audio: boolean;
  video: boolean;
  source: "static" | "cache" | "unknown";
  detectedAt: number;
  note?: string;
}


/* ── Exact-match table for known specific models ──────────── */
interface ExactEntry {
  caps: { image?: boolean; audio?: boolean; video?: boolean };
  note: string;
}

const STATIC_TABLE: Record<string, ExactEntry> = {
  // OpenAI — multimodal
  "gpt-4o":              { caps: { image: true, audio: true }, note: "OpenAI GPT-4o" },
  "gpt-4o-mini":         { caps: { image: true, audio: true }, note: "OpenAI GPT-4o mini" },
  "gpt-4-turbo":         { caps: { image: true },             note: "OpenAI GPT-4 Turbo" },
  "gpt-4-vision":        { caps: { image: true },             note: "OpenAI GPT-4 Vision" },
  "gpt-5":               { caps: { image: true, audio: true }, note: "OpenAI GPT-5" },
  "gpt-5-mini":          { caps: { image: true, audio: true }, note: "OpenAI GPT-5 mini" },
  "gpt-5-nano":          { caps: { image: true, audio: true }, note: "OpenAI GPT-5 nano" },
  "o1":                  { caps: { image: true },             note: "OpenAI o1" },
  "o1-preview":          { caps: { image: true },             note: "OpenAI o1 preview" },
  "o1-mini":             { caps: { image: true },             note: "OpenAI o1 mini" },
  "o3":                  { caps: { image: true },             note: "OpenAI o3" },
  "o3-mini":             { caps: { image: true },             note: "OpenAI o3 mini" },
  "o4-mini":             { caps: { image: true },             note: "OpenAI o4 mini" },

  // OpenAI — text-only
  "gpt-3.5-turbo":       { caps: {}, note: "OpenAI GPT-3.5 Turbo (text-only)" },
  "gpt-3.5":             { caps: {}, note: "OpenAI GPT-3.5 (text-only)" },
  "gpt-4":               { caps: {}, note: "OpenAI GPT-4 base (text-only)" },

  // Anthropic — multimodal (Claude 3+ family)
  "claude-3-opus":       { caps: { image: true }, note: "Anthropic Claude 3 Opus" },
  "claude-3-sonnet":     { caps: { image: true }, note: "Anthropic Claude 3 Sonnet" },
  "claude-3-haiku":      { caps: { image: true }, note: "Anthropic Claude 3 Haiku" },
  "claude-3-5-sonnet":   { caps: { image: true }, note: "Anthropic Claude 3.5 Sonnet" },
  "claude-3-5-haiku":    { caps: { image: true }, note: "Anthropic Claude 3.5 Haiku" },
  "claude-3-7-sonnet":   { caps: { image: true }, note: "Anthropic Claude 3.7 Sonnet" },
  "claude-sonnet-4":     { caps: { image: true }, note: "Anthropic Claude Sonnet 4" },
  "claude-opus-4":       { caps: { image: true }, note: "Anthropic Claude Opus 4" },

  // Google — multimodal
  "gemini-1.5-pro":      { caps: { image: true, audio: true, video: true }, note: "Google Gemini 1.5 Pro" },
  "gemini-1.5-flash":    { caps: { image: true, audio: true, video: true }, note: "Google Gemini 1.5 Flash" },
  "gemini-2.0-flash":    { caps: { image: true, audio: true, video: true }, note: "Google Gemini 2.0 Flash" },
  "gemini-2.5-pro":      { caps: { image: true, audio: true, video: true }, note: "Google Gemini 2.5 Pro" },
  "gemini-2.5-flash":    { caps: { image: true, audio: true, video: true }, note: "Google Gemini 2.5 Flash" },
  "gemini-pro-vision":   { caps: { image: true }, note: "Google Gemini Pro Vision" },

  // Qwen VL family
  "qwen-vl-max":         { caps: { image: true }, note: "Qwen VL Max" },
  "qwen-vl-plus":        { caps: { image: true }, note: "Qwen VL Plus" },
  "qwen2-vl-72b":        { caps: { image: true }, note: "Qwen2-VL 72B" },
  "qwen2-vl-7b":         { caps: { image: true }, note: "Qwen2-VL 7B" },
  "qwen2.5-vl-72b":      { caps: { image: true }, note: "Qwen2.5-VL 72B" },
  "qwen2.5-vl-7b":       { caps: { image: true }, note: "Qwen2.5-VL 7B" },

  // Zhipu GLM-4V
  "glm-4v":              { caps: { image: true }, note: "Zhipu GLM-4V" },
  "glm-4v-plus":         { caps: { image: true }, note: "Zhipu GLM-4V Plus" },

  // Meta Llama vision
  "llama-3.2-11b-vision":  { caps: { image: true }, note: "Meta Llama 3.2 11B Vision" },
  "llama-3.2-90b-vision":  { caps: { image: true }, note: "Meta Llama 3.2 90B Vision" },

  // DeepSeek — text-only
  "deepseek-chat":       { caps: {}, note: "DeepSeek Chat (text-only)" },
  "deepseek-reasoner":   { caps: {}, note: "DeepSeek Reasoner (text-only)" },
  "deepseek-v3":         { caps: {}, note: "DeepSeek V3 (text-only)" },
  "deepseek-v2.5":       { caps: {}, note: "DeepSeek V2.5 (text-only)" },
};

/* ── Pattern matching for family-level detection ────────────── */

interface PatternEntry {
  re: RegExp;
  caps: { image?: boolean; audio?: boolean; video?: boolean };
  note: string;
}

const STATIC_PATTERNS: PatternEntry[] = [
  { re: /^gpt-4o(?:-|$)/i, caps: { image: true, audio: true }, note: "OpenAI GPT-4o family" },
  { re: /^gpt-4[.-]?vision/i, caps: { image: true }, note: "OpenAI GPT-4 Vision family" },
  { re: /^gpt-4[.-]?turbo/i, caps: { image: true }, note: "OpenAI GPT-4 Turbo family" },
  { re: /^gpt-5/i, caps: { image: true, audio: true }, note: "OpenAI GPT-5 family" },
  { re: /^o1(?:-|$)/i, caps: { image: true }, note: "OpenAI o1 family" },
  { re: /^o3(?:-|$)/i, caps: { image: true }, note: "OpenAI o3 family" },
  { re: /^o4/i, caps: { image: true }, note: "OpenAI o4 family" },
  { re: /^claude-3/i, caps: { image: true }, note: "Anthropic Claude 3 family" },
  { re: /^claude-sonnet-4/i, caps: { image: true }, note: "Anthropic Claude Sonnet 4 family" },
  { re: /^claude-opus-4/i, caps: { image: true }, note: "Anthropic Claude Opus 4 family" },
  { re: /^gemini-1\.5/i, caps: { image: true, audio: true, video: true }, note: "Google Gemini 1.5 family" },
  { re: /^gemini-2/i, caps: { image: true, audio: true, video: true }, note: "Google Gemini 2.x family" },
  { re: /^gemini-pro-vision/i, caps: { image: true }, note: "Google Gemini Pro Vision" },
  { re: /qwen.*-vl/i, caps: { image: true }, note: "Qwen VL family" },
  { re: /qwen.*vision/i, caps: { image: true }, note: "Qwen Vision family" },
  { re: /qwen2\.5-vl/i, caps: { image: true }, note: "Qwen2.5-VL family" },
  { re: /glm-?4v/i, caps: { image: true }, note: "Zhipu GLM-4V family" },
  { re: /llama-3\.2.*vision/i, caps: { image: true }, note: "Meta Llama 3.2 Vision family" },
  { re: /llava/i, caps: { image: true }, note: "LLaVA family" },
  { re: /internvl/i, caps: { image: true }, note: "InternVL family" },
  { re: /cogvlm/i, caps: { image: true }, note: "CogVLM family" },
  { re: /yi-vl/i, caps: { image: true }, note: "Yi-VL family" },
];

/* ── Cache IO ───────────────────────────────────────────────── */

const CACHE_FILE = "model-capabilities.json";

export interface ModelCapabilitiesCache {
  [model: string]: ModelCapabilities;
}

function cachePath(baseDir: string): string {
  return join(baseDir, CACHE_FILE);
}

export function loadCache(baseDir: string): ModelCapabilitiesCache {
  const fp = cachePath(baseDir);
  if (!existsSync(fp)) return {};
  try {
    const raw = JSON.parse(readFileSync(fp, "utf-8")) as unknown;
    if (!raw || typeof raw !== "object") return {};
    return raw as ModelCapabilitiesCache;
  } catch {
    return {};
  }
}

export function saveCache(baseDir: string, cache: ModelCapabilitiesCache): void {
  const fp = cachePath(baseDir);
  if (!existsSync(baseDir)) {
    mkdirSync(baseDir, { recursive: true });
  }
  writeFileSync(fp, JSON.stringify(cache, null, 2) + "\n", "utf-8");
}


/* ── Classifier ─────────────────────────────────────────────── */

export function classifyModel(model: string): ModelCapabilities {
  const now = Date.now();
  if (!model || typeof model !== "string") {
    return { image: false, audio: false, video: false, source: "unknown", detectedAt: now, note: "no model" };
  }
  const m = model.toLowerCase().trim();

  // 1. Exact match
  const exact = STATIC_TABLE[m];
  if (exact) {
    return {
      image: !!exact.caps.image,
      audio: !!exact.caps.audio,
      video: !!exact.caps.video,
      source: "static",
      detectedAt: now,
      note: exact.note,
    };
  }

  // 2. Pattern match
  for (const { re, caps, note } of STATIC_PATTERNS) {
    if (re.test(m)) {
      return {
        image: !!caps.image,
        audio: !!caps.audio,
        video: !!caps.video,
        source: "static",
        detectedAt: now,
        note,
      };
    }
  }

  // 3. Conservative default for unrecognized models
  return {
    image: false,
    audio: false,
    video: false,
    source: "unknown",
    detectedAt: now,
    note: "unknown model: " + model,
  };
}

/** Returns true if model supports at least one modality (image/audio/video). */
export function isMultimodalCapable(caps: ModelCapabilities): boolean {
  return caps.image || caps.audio || caps.video;
}

/**
 * Resolve the current active model from plugin config.
 * Priority: config.llm.model > config.embedding.model > "".
 */
export function resolveCurrentModel(config: Record<string, unknown> | undefined): string {
  if (!config || typeof config !== "object") return "";
  const llm = (config as Record<string, unknown>).llm as Record<string, unknown> | undefined;
  if (llm && typeof llm === "object") {
    const m = String(llm.model || "").trim();
    if (m) return m;
  }
  const emb = (config as Record<string, unknown>).embedding as Record<string, unknown> | undefined;
  if (emb && typeof emb === "object") {
    const m = String(emb.model || "").trim();
    if (m) return m;
  }
  return "";
}

/**
 * Look up cached capability, fall back to classify + record.
 * Always returns a result; cache file is updated lazily on miss.
 */
export function recordAndClassify(baseDir: string, model: string): ModelCapabilities {
  if (!model) {
    return { image: false, audio: false, video: false, source: "unknown", detectedAt: Date.now(), note: "no model" };
  }
  const cache = loadCache(baseDir);
  const existing = cache[model];
  if (existing) {
    return { ...existing, source: "cache" };
  }
  const fresh = classifyModel(model);
  cache[model] = fresh;
  try {
    saveCache(baseDir, cache);
  } catch {
    /* cache write is best-effort; failure should not break boot */
  }
  return fresh;
}

/** Returns the full cache (read-only snapshot). */
export function listCached(baseDir: string): ModelCapabilitiesCache {
  return loadCache(baseDir);
}

/** Drop a single model from the cache (used for invalidation / user override). */
export function invalidateModel(baseDir: string, model: string): boolean {
  const cache = loadCache(baseDir);
  if (!cache[model]) return false;
  delete cache[model];
  saveCache(baseDir, cache);
  return true;
}

/** Clear the entire cache. */
export function clearCache(baseDir: string): void {
  saveCache(baseDir, {});
}
