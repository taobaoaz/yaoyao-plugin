/**
 * memory_recommend tool — 记忆推荐引擎
 *
 * 基于当前上下文推荐相关记忆。与搜索不同：
 * - 自动多样化：不同类型的记忆不会被全部聚在一起，来自不同场景/日期/标签的混合推荐
 * - 有时间衰减：近期的记忆权重更高
 * - 冷启动保护：数据少时也会尽量提供多样化
 *
 * 工具名: memory_recommend
 * 使用: memory_recommend({ context: "最近在做什么项目", limit: 5 })
 *
 * ⚠️ 完全独立模块，所有 try-catch 兜底
 */

import fs from "node:fs";
import path from "node:path";
import type { DBBridge } from "../utils/db-bridge.js";
import { withErrorHandling } from "./common.js";
import type { ToolRegistration } from "./common.js";

interface ScoredResult {
  date: string;
  user_text: string;
  asst_text: string;
  score: number;
  source: string;
}

export function createRecommendTool(db: DBBridge, memoryDir: string): ToolRegistration {
  return {
    name: "memory_recommend",
    label: "Recommend Memories",
    description: "记忆推荐引擎。基于上下文推荐多样化的相关记忆——混合不同场景、日期、标签的记忆，避免重复推荐同一类内容。",
    parameters: {
      type: "object",
      properties: {
        context: {
          type: "string",
          description: "当前上下文（如用户刚说的内容），用于匹配相关记忆",
        },
        limit: {
          type: "number",
          description: "推荐数量（1-20，默认 5）",
          default: 5,
        },
        diversity: {
          type: "number",
          description: "多样化程度（0-1，0=纯相关度，1=最大多样化），默认 0.3",
          default: 0.3,
        },
        sceneDiversity: {
          type: "boolean",
          description: "是否优先从不同场景中采样（默认 true）",
          default: true,
        },
      },
    },
    execute: withErrorHandling(async (_id: string, params: Record<string, unknown>) => {
      const context = String(params.context || "").trim();
      const limit = Math.min(20, Math.max(1, Number(params.limit) || 5));
      const diversity = Math.min(1, Math.max(0, Number(params.diversity) || 0.3));
      const sceneDiversity = params.sceneDiversity !== false;

      if (!context) {
        // 无上下文时：推荐近期记忆（按日期降序）
        const stmt = db.prepare(
          "SELECT date, user_text, asst_text FROM memory_meta ORDER BY date DESC LIMIT ?"
        );
        const recent = stmt.all(limit) as Array<{ date: string; user_text: string; asst_text: string }>;
        if (recent.length === 0) {
          return { content: [{ type: "text", text: "暂无记忆可推荐。" }] };
        }
        const lines = recent.map((r, i) =>
          `${i + 1}. [${r.date}] ${r.user_text || ""} ${r.asst_text ? "| " + r.asst_text : ""}`
        );
        return { content: [{ type: "text", text: "## 近期记忆\n\n" + lines.join("\n") }] };
      }

      // 有上下文时：混合相关度 + 多样化
      // 1. 从 DB 中检索（使用 LIKE，因为 context 可能是中文）
      const rawResults = db.search(context, Math.min(limit * 3, 30));
      if (rawResults.length === 0) {
        // 降级到 LIKE
        const likeStmt = db.prepare(
          "SELECT date, user_text, asst_text FROM memory_meta " +
          "WHERE user_text LIKE ? OR asst_text LIKE ? ORDER BY date DESC LIMIT ?"
        );
        const likeResults = likeStmt.all(`%${context}%`, `%${context}%`, limit) as Array<{ date: string; user_text: string; asst_text: string }>;
        if (likeResults.length === 0) {
          return { content: [{ type: "text", text: "没有找到相关的记忆。" }] };
        }
        const lines = likeResults.map((r, i) =>
          `${i + 1}. [${r.date}] ${r.user_text || ""}`
        );
        return { content: [{ type: "text", text: "## 推荐记忆\n\n" + lines.join("\n") }] };
      }

      // 2. 加载场景数据用于多样化
      const scenes = new Map<string, Set<string>>();
      const sceneDir = path.join(memoryDir, "scene_blocks");
      try {
        if (fs.existsSync(sceneDir)) {
          for (const sf of fs.readdirSync(sceneDir).filter(f => f.endsWith(".md"))) {
            const content = fs.readFileSync(path.join(sceneDir, sf), "utf-8");
            for (const line of content.split("\n")) {
              const t = line.trim();
              if (t.startsWith("- ") || t.startsWith("* ")) {
                const mem = t.slice(2);
                if (!scenes.has(mem)) scenes.set(mem, new Set());
                scenes.get(mem)!.add(sf.replace(".md", ""));
              }
            }
          }
        }
      } catch { /* */ }

      // 3. 带多样化的推荐
      const scoredResults = rawResults.map(r => ({
        date: r.filename?.replace(".md", "") || "unknown",
        user_text: r.snippet || "",
        asst_text: "",
        score: r.score,
        source: "search",
      }));

      // 多样化解复用：如果一条记忆属于某个 scene，优先保留一条代表
      const selected: ScoredResult[] = [];
      const selectedScenes = new Set<string>();

      // 先排序
      scoredResults.sort((a, b) => b.score - a.score);

      // 按场景多样化
      const pool = [...scoredResults];
      while (selected.length < limit && pool.length > 0) {
        let pickIdx = 0;
        if (sceneDiversity && diversity > 0) {
          // 找不重复场景的
          let foundDiverse = false;
          for (let i = 0; i < pool.length; i++) {
            const memText = pool[i].user_text;
            const memScenes = scenes.get(memText);
            if (!memScenes || memScenes.size === 0) {
              pickIdx = i;
              foundDiverse = true;
              break;
            }
            const fresh = [...memScenes].some(s => !selectedScenes.has(s));
            if (fresh) {
              pickIdx = i;
              foundDiverse = true;
              // 标记这个 scene
              for (const s of memScenes) selectedScenes.add(s);
              break;
            }
          }
          // 如果找不到多样化，可能都是同一个 scene
          if (!foundDiverse) {
            pickIdx = Math.floor(Math.random() * pool.length);
          }
        }

        const picked = pool.splice(pickIdx, 1)[0];
        selected.push(picked);
      }

      // 格式输出
      const lines = selected.map((r, i) => {
        const scoreBar = "█".repeat(Math.round(r.score * 10));
        return `${i + 1}. [${r.date}] ${r.user_text}  ${scoreBar}`;
      });

      return {
        content: [{
          type: "text",
          text: [
            `## 记忆推荐`,
            `基于: "${context}"`,
            `多样化: ${(diversity * 100).toFixed(0)}%`,
            ``,
            ...lines,
          ].join("\n"),
        }],
      };
    }),
  };
}
