/**
 * Scene Extractor — L2: groups memories into scene blocks.
 *
 * Uses LLM to analyze extracted memories and group them into
 * themed scene blocks for better context recall.
 * Scene blocks are stored as Markdown files in memory/scene_blocks/.
 */
import path from "node:path";
import fs from "node:fs";
import type { LLMClient } from "../utils/llm-client.js";

const TAG = "[yaoyao-memory:l2-scenes]";

const SCENE_SYSTEM_PROMPT = `你是"场景归纳专家"。分析以下记忆条目，将它们归类到不同的场景块中。

场景块规则：
1. 每个场景块应该围绕一个主题（如"工作项目"、"生活计划"、"学习进展"）
2. 场景名称用"xxx相关"格式（10-30字）
3. 每个记忆只能属于一个场景
4. 无关联的记忆归入"其他"

输出格式（JSON 数组）：
[
  {
    "scene_name": "场景名称",
    "memories": ["记忆内容1", "记忆内容2"]
  }
]`;

export interface SceneBlock {
  scene_name: string;
  /** Index file path */
  path?: string;
  memories: string[];
  created_at?: string;
  updated_at?: string;
}

export async function runSceneExtraction(params: {
  memories: Array<{ content: string; date?: string }>;
  llm: LLMClient | null;
  memoryDir: string;
  logger?: { info: (s: string) => void; debug?: (s: string) => void; error: (s: string) => void };
}): Promise<{ success: boolean; sceneCount: number; sceneNames: string[] }> {
  const { memories, llm, memoryDir, logger } = params;
  const log = logger || console;

  if (!llm || memories.length === 0) {
    log.debug?.(`${TAG} No LLM or memories, skipping scene extraction`);
    return { success: false, sceneCount: 0, sceneNames: [] };
  }

  // Build the prompt
  const memoryText = memories.map(m => `[${m.date || "unknown"}]: ${m.content.slice(0, 200)}`).join("\n");
  const prompt = `请将以下记忆归类到场景中：\n\n${memoryText}`;

  try {
    const response = await llm.extract(SCENE_SYSTEM_PROMPT, prompt);
    const scenes = parseSceneResponse(response);

    if (!scenes || scenes.length === 0) {
      log.debug?.(`${TAG} No scenes extracted`);
      return { success: false, sceneCount: 0, sceneNames: [] };
    }

    // Ensure scene directory
    const scenesDir = path.join(memoryDir, "scene_blocks");
    fs.mkdirSync(scenesDir, { recursive: true });

    const sceneNames: string[] = [];

    for (const scene of scenes) {
      if (!scene.scene_name || !scene.memories || scene.memories.length === 0) continue;
      sceneNames.push(scene.scene_name);

      // Write each scene as a Markdown file
      const safeName = scene.scene_name.replace(/[\/\\?%*:|"<>]/g, "_").slice(0, 100);
      const filePath = path.join(scenesDir, `${safeName}.md`);
      const now = new Date().toISOString();

      const content = [
        `# ${scene.scene_name}`,
        ``,
        `> 场景建立时间: ${now}`,
        ``,
        `---`,
        ``,
        ...scene.memories.map((m: string) => `- ${m}`),
        ``,
      ].join("\n");

      fs.writeFileSync(filePath, content, "utf-8");
    }

    log.info?.(`${TAG} Created ${scenes.length} scene blocks`);
    return { success: true, sceneCount: scenes.length, sceneNames };
  } catch (err: any) {
    log.error?.(`${TAG} Scene extraction failed: ${err.message}`);
    return { success: false, sceneCount: 0, sceneNames: [] };
  }
}

function parseSceneResponse(response: string): Array<{ scene_name: string; memories: string[] }> {
  try {
    let clean = response.trim();
    if (clean.startsWith("```")) {
      clean = clean.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/g, "");
    }
    const parsed = JSON.parse(clean);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    const match = response.match(/\[[\s\S]*\]/);
    if (match) {
      try { return JSON.parse(match[0]); } catch { return []; }
    }
    return [];
  }
}
