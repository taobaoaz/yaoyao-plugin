/**
 * features/unify/tool.ts — memory_unify tool.
 *
 * Thin layer: param validation → provider data → formatter output.
 * Data access in provider.ts, formatting in formatter.ts.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { withErrorHandling } from "../../tools/common.ts";
import type { ToolRegistration } from "../../tools/common.ts";
import type { MemoryStore } from "../../utils/memory-store.ts";
import { queryOpenClawDB, readDreams, getYaoyaoDbPath, getDailyFilesCount } from "./provider.ts";
import {
  formatStatusReport,
  formatBackendsReport,
  formatCrossSearchResults,
} from "./formatter.ts";

export function createUnifyTool(store: MemoryStore): ToolRegistration {
  return {
    id: "memory_unify",
    name: "memory_unify",
    label: "Memory Unify",
    description:
      "🔗 统一记忆管理 — 查看 OpenClaw 所有记忆后端的状态，包括内置记忆、yaoyao 索引、.dreams 短期召回",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["status", "search_all", "backends"],
          description: "status=统一状态面板, search_all=跨后端搜索, backends=后端详情",
        },
        query: { type: "string", description: "搜索关键词（action=search_all 时必填）" },
      },
      required: ["action"],
    },
    execute: withErrorHandling(async (_id: string, params: Record<string, unknown>) => {
      const action = String(params.action);
      const memoryDir = store.baseDir;

      if (action === "status") {
        const ocFiles = queryOpenClawDB("SELECT COUNT(*) as c FROM files");
        const ocChunks = queryOpenClawDB("SELECT COUNT(*) as c FROM chunks");
        const ocFts = queryOpenClawDB("SELECT COUNT(*) as c FROM chunks_fts");
        const ocDbPath = path.join(os.homedir(), ".openclaw", "memory", "main.sqlite");
        const ocDbSize = fs.existsSync(ocDbPath) ? (fs.statSync(ocDbPath).size / 1024).toFixed(1) : "N/A";
        const dreams = readDreams(memoryDir);
        const yaoDbPath = getYaoyaoDbPath(memoryDir);

        return {
          content: [{
            type: "text",
            text: formatStatusReport({
              ocFileCount: ocFiles ? Number(ocFiles[0].c) : 0,
              ocChunkCount: ocChunks ? Number(ocChunks[0].c) : 0,
              ocFtsCount: ocFts ? Number(ocFts[0].c) : 0,
              ocDbSize,
              dreamEvents: dreams.events.length,
              hasShortTermRecall: !!dreams.shortTermRecall,
              yaoDbExists: fs.existsSync(yaoDbPath),
              yaoDbSize: fs.existsSync(yaoDbPath) ? (fs.statSync(yaoDbPath).size / 1024).toFixed(1) : "N/A",
              dailyFiles: getDailyFilesCount(memoryDir),
            }),
          }],
        };
      }

      if (action === "backends") {
        const files = queryOpenClawDB("SELECT path, source, size FROM files");
        const dreams = readDreams(memoryDir);
        const yaoInfo = [
          "- FTS5 全文索引 + sqlite-vec 向量搜索",
          "- 情感分析 + 时间线 + 趋势分析 + 质量评估",
          "- 云备份 (WebDAV/S3/SFTP/Samba)",
          "- L1→L2→L3 LLM 提取管线",
        ];

        return {
          content: [{
            type: "text",
            text: formatBackendsReport(files, dreams.events as Array<Record<string, unknown>>, yaoInfo),
          }],
        };
      }

      if (action === "search_all") {
        const query = String(params.query || "");
        if (!query || query.length < 2) {
          return { content: [{ type: "text", text: "❌ 搜索关键词至少 2 个字符" }] };
        }

        const ocResults = queryOpenClawDB(
          "SELECT path, text FROM chunks_fts WHERE text MATCH ? LIMIT 5",
          [query]
        );
        const dreams = readDreams(memoryDir);
        const dreamMatches = dreams.events.filter((e: unknown) => {
          return JSON.stringify(e).toLowerCase().includes(query.toLowerCase());
        });

        return {
          content: [{
            type: "text",
            text: formatCrossSearchResults(query, ocResults, dreamMatches as Array<Record<string, unknown>>),
          }],
        };
      }

      return { content: [{ type: "text", text: "❌ 未知操作。支持: status, search_all, backends" }] };
    }),
  };
}
