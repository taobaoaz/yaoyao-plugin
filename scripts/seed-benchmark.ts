/**
 * 为性能基准测试填充种子数据
 *
 * 向 .yaoyoa.db 写入 ~500 条模拟记忆数据
 *
 * 运行: node src/__tests__/seed-benchmark.ts
 */
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";

const _require = createRequire(import.meta.url);
const { DatabaseSync } = _require("node:sqlite") as typeof import("node:sqlite");
const sqliteVec = _require("sqlite-vec") as any;

const DB_PATH = path.join(process.cwd(), "memory", ".yaoyao.db");

// 确保 memory/ 目录存在
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH, { allowExtension: true });
try { sqliteVec.load(db); } catch { /* vec not available */ }

// 创建表（如果不存在）
db.exec("PRAGMA busy_timeout = 5000");
db.exec(
  "CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(" +
    "date, user_text, asst_text, " +
    "tokenize='unicode61'" +
  ")"
);
db.exec(
  "CREATE TABLE IF NOT EXISTS memory_meta (" +
    "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
    "date TEXT NOT NULL, " +
    "user_text TEXT, " +
    "asst_text TEXT, " +
    "created_at TEXT DEFAULT (datetime('now'))" +
  ")"
);

// 种子数据 — 模拟记忆条目
const topics = [
  "记忆", "数据", "测试", "搜索", "情感", "分析", "时间线",
  "备份", "恢复", "同步", "配置", "插件", "系统", "日志",
  "用户", "对话", "消息", "记录", "查询", "索引", "嵌入",
  "学习", "笔记", "文档", "项目", "计划", "任务", "目标",
  "天气", "新闻", "邮件", "图片", "音频", "视频", "文件",
];

const sentences = [
  "今天天气不错，适合出去走走",
  "完成了项目架构设计评审",
  "搜索结果返回了相关信息",
  "系统性能指标达到预期",
  "记录了用户的偏好设置",
  "对历史对话进行了情感分析",
  "生成了本周的日志摘要",
  "检查了数据备份完整性",
  "配置了新模块的接入参数",
  "用户反馈了界面体验问题",
  "时间线功能已恢复正常",
  "计划下周进行系统升级",
  "插件加载速度有所提升",
  "修复了记忆检索的bug",
  "索引重建任务已完成",
  "讨论了新的功能需求",
  "测试了CJK文本搜索效果",
  "学习了机器学习的相关知识",
  "整理了项目文档结构",
  "同步了跨设备的数据",
  "The quick brown fox jumps over the lazy dog",
  "This is a test memory entry for benchmarking",
  "Search results should return relevant snippets",
  "System performance metrics look good today",
  "User preferences have been saved successfully",
  "Memory search with FTS5 works great on English text",
  "Database query optimization is important for scale",
  "Plugin system architecture needs careful design",
  "Log analysis reveals interesting usage patterns",
  "Backup completed successfully without errors",
  "Config options were updated to match user needs",
  "Index rebuild improved search performance significantly",
  "Session management handles concurrent requests well",
  "File upload processing pipeline is functioning normally",
  "Thread safety is critical for multi-user scenarios",
];

const responses = [
  "收到，已处理",
  "好的，明白了",
  "已记录到系统",
  "请查看详细报告",
  "操作成功完成",
  "数据已保存",
  "查询结果如下",
  "任务已开始处理",
  "信息已更新",
  "正在等待处理结果",
  "Okay, noted",
  "Task completed",
  "Operation successful",
  "Please review the details",
  "Results are ready",
];

const INSERT_COUNT = 500;
// 清空旧数据 — 直接删库重建（简单可靠）
db.close();
fs.unlinkSync(DB_PATH);

const db2 = new DatabaseSync(DB_PATH, { allowExtension: true });
try { sqliteVec.load(db2); } catch { /* vec not available */ }
db2.exec("PRAGMA busy_timeout = 5000");
db2.exec(
  "CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(" +
    "date, user_text, asst_text, " +
    "tokenize='unicode61'" +
  ")"
);
db2.exec(
  "CREATE TABLE IF NOT EXISTS memory_meta (" +
    "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
    "date TEXT NOT NULL, " +
    "user_text TEXT, " +
    "asst_text TEXT, " +
    "created_at TEXT DEFAULT (datetime('now'))" +
  ")"
);

console.log(`开始写入 ${INSERT_COUNT} 条种子数据...`);
const start = Date.now();

const insertMeta2 = db2.prepare(
  "INSERT INTO memory_meta (date, user_text, asst_text) VALUES (?, ?, ?)"
);
const insertFts2 = db2.prepare(
  "INSERT INTO memory_fts (rowid, date, user_text, asst_text) VALUES (?, ?, ?, ?)"
);

// 手动事务（node:sqlite DatabaseSync 不支持 .transaction()）
db2.exec("BEGIN TRANSACTION");
for (let i = 0; i < INSERT_COUNT; i++) {
  const date = `2026-${String(Math.floor(Math.random() * 4) + 1).padStart(2, "0")}-${String(Math.floor(Math.random() * 28) + 1).padStart(2, "0")}`;
  const topic = topics[Math.floor(Math.random() * topics.length)];
  const sentence = sentences[Math.floor(Math.random() * sentences.length)];
  const response = responses[Math.floor(Math.random() * responses.length)];
  const userText = `${topic}: ${sentence} #${i}`;
  const r = insertMeta2.run(date, userText, response);
  const rowId = Number(r.lastInsertRowid);
  insertFts2.run(rowId, date, userText, response);
}
db2.exec("COMMIT");
// Rebuild FTS index to sync content table data
db2.exec("INSERT INTO memory_fts(memory_fts) VALUES('rebuild')");
const ms = Date.now() - start;

const count = db2.prepare("SELECT COUNT(*) as c FROM memory_meta").get() as any;
const ftsCount = db2.prepare("SELECT COUNT(*) as c FROM memory_fts").get() as any;
const sizeKB = fs.statSync(DB_PATH).size / 1024;

console.log(`✅ 写入完成: ${count.c} 条 meta, ${ftsCount.c} 条 FTS, ${ms}ms`);
console.log(`💾 DB 大小: ${sizeKB.toFixed(1)} KB`);

db2.close();
