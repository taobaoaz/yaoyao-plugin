/**
 * Persona Generator — L3: generates and updates user persona from memories.
 *
 * Uses LLM to synthesize memories into a structured user profile.
 * Output is stored as a single Markdown file: memory/persona.md
 */
import path from "node:path";
import fs from "node:fs";
import type { LLMClient } from "../utils/llm-client.js";
import { parseJSONResponse } from "../utils/llm-parse.js";

const TAG = "[yaoyao-memory:l3-persona]";

const PERSONA_SYSTEM_PROMPT = `你是"用户画像专家"。根据提供的记忆信息，生成或更新用户的个人画像。

画像应包含以下部分（JSON格式输出）：

{
  "name": "用户名称（未知则填'用户'）",
  "summary": "用户简介（50-100字）",
  "traits": {
    "personality": ["性格特征1", "性格特征2"],
    "skills": ["技能或专业领域"],
    "preferences": {
      "likes": ["喜欢的事物"],
      "dislikes": ["不喜欢的事物"]
    }
  },
  "habits": {
    "patterns": ["行为模式"],
    "tone": "偏好语气（正式/随意/幽默等）"
  },
  "goals": {
    "current": ["当前目标"],
    "interests": ["兴趣领域"]
  },
  "updatedAt": "ISO时间戳"
}

要求：
1. 基于提供的记忆信息，不要编造
2. 信息不足的字段填空数组或null
3. 输出且只输出合法的JSON`;

export interface Persona {
  name: string;
  summary: string;
  traits: {
    personality: string[];
    skills: string[];
    preferences: { likes: string[]; dislikes: string[] };
  };
  habits: {
    patterns: string[];
    tone: string | null;
  };
  goals: {
    current: string[];
    interests: string[];
  };
  updatedAt: string;
}

export async function generateOrUpdatePersona(params: {
  memories: string[];
  existingPersona: Persona | null;
  llm: LLMClient | null;
  memoryDir: string;
  logger?: { info: (s: string) => void; debug?: (s: string) => void; error: (s: string) => void };
}): Promise<{ success: boolean; persona: Persona | null }> {
  const { memories, existingPersona, llm, memoryDir, logger } = params;
  const log = logger || console;

  if (!llm || memories.length < 3) {
    log.debug?.(`${TAG} Not enough data for persona generation`);
    return { success: false, persona: null };
  }

  const memorySummary = memories.slice(-20).join("\n");
  const existing = existingPersona
    ? `现有画像：\n${JSON.stringify(existingPersona, null, 2)}\n\n`
    : "无现有画像。\n\n";
  const prompt = `${existing}请根据以下新记忆生成/更新画像：\n\n${memorySummary}`;

  try {
    const response = await llm.extract(PERSONA_SYSTEM_PROMPT, prompt);
    const persona = parseJSONResponse<Persona>(response);

    if (!persona || !persona.summary) {
      log.debug?.(`${TAG} Invalid persona response`);
      return { success: false, persona: null };
    }

    persona.updatedAt = new Date().toISOString();

    // Write to persona.md
    const personaPath = path.join(memoryDir, "persona.md");
    const content = formatPersonaMarkdown(persona);
    fs.writeFileSync(personaPath, content, "utf-8");

    log.info?.(`${TAG} Persona updated for "${persona.name}"`);
    return { success: true, persona };
  } catch (err: any) {
    log.error?.(`${TAG} Persona generation failed: ${err.message}`);
    return { success: false, persona: null };
  }
}

function formatPersonaMarkdown(persona: Persona): string {
  const lines = [
    `# Persona — ${persona.name}`,
    ``,
    `> ${persona.summary}`,
    ``,
    `**更新于**: ${new Date(persona.updatedAt).toLocaleString("zh-CN")}`,
    ``,
    `---`,
    ``,
    `## 性格特征`,
    ...persona.traits.personality.map(t => `- ${t}`),
    ``,
    `## 技能与专业`,
    ...persona.traits.skills.map(s => `- ${s}`),
    ``,
    `## 喜好`,
    `**喜欢**:`,
    ...persona.traits.preferences.likes.map(l => `- ${l}`),
    `**不喜欢**:`,
    ...persona.traits.preferences.dislikes.map(d => `- ${d}`),
    ``,
    `## 行为模式`,
    ...persona.habits.patterns.map(p => `- ${p}`),
    `**偏好语气**: ${persona.habits.tone || "未指定"}`,
    ``,
    `## 目标与兴趣`,
    `**当前目标**:`,
    ...persona.goals.current.map(g => `- ${g}`),
    `**兴趣领域**:`,
    ...persona.goals.interests.map(i => `- ${i}`),
    ``,
    `---`,
    `_此文件由 yaoyao-memory 插件自动生成，基于对话记忆提炼_`,
  ];

  return lines.join("\n");
}
