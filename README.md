# Yaoyao Memory Plugin

🎲 搭载摇摇记忆引擎的四层记忆系统 — 让 AI 拥有真正的长时记忆。

**11 个工具 · FTS5 + sqlite-vec 混合搜索 · 情感分析 · 时间线 · 一键备份**

---

## 架构

```
L0 — 每日对话日志        (memory/YYYY-MM-DD.md)     ← 自动捕获
L1 — 结构化记忆索引      (.yaoyao.db FTS5 + vec)    ← 混合搜索
L2 — 场景分组            (scene_blocks/)             ← LLM 管线
L3 — 用户画像            (persona.md)                ← LLM 提炼
```

## 工具 (11 个)

| 工具 | 用途 |
|------|------|
| `yaoyao_memory_search` | 🔍 FTS5 全文搜索 + CJK 模糊降级 |
| `yaoyao_memory_get` | 📖 读取指定记忆文件 |
| `memory_list` | 📋 列出所有记忆文件 |
| `memory_save` | 💾 手动记录一条记忆 |
| `memory_stats` | 📊 记忆统计（总量、日期分布） |
| `memory_mood` | 🎨 **分析情绪趋势** — 心情环可视化 |
| `memory_timeline` | 📅 **时间线热力图** — ███ 密度条 |
| `memory_search_timeline` | 🔍📅 **搜索 + 时间轴分组** |
| `memory_backup` | 📦 **创建快照备份** |
| `memory_forget` | 🗑️ **按关键词或日期删除** |
| `memory_note` | 📌 **快捷笔记** — 像便签一样存 |

## 快速开始

安装：
```bash
openclaw plugins install yaoyao-memory
```

## 配置

```json5
{
  "enabled": true,
  "config": {
    // L0 自动捕获
    "capture": { "enabled": true },

    // L1 自动召回
    "recall": { "enabled": true, "maxResults": 3 },

    // 向量搜索（可选）
    "embedding": {
      "enabled": false,
      "baseUrl": "https://api.openai.com/v1",
      "apiKey": "sk-xxx",
      "model": "text-embedding-3-small",
      "dimensions": 1024
    },

    // LLM 管线（可选，L1→L2→L3）
    // 💡 如果已配置 embedding，LLM 会自动复用 embedding 的 apiKey/baseUrl
    //    无需额外配置！插件启动时会自动检测并输出提示。
    //    如需关闭，设置 llm: { enabled: false }
    //    如需自定义，设置下方的 apiKey / baseUrl / model
    "llm": {
      "apiKey": "",
      "baseUrl": "https://api.deepseek.com",
      "model": "deepseek-chat"
    },

    // 自动清理
    "cleanup": {
      "enabled": true,
      "l0l1RetentionDays": 30
    },

    // 排除的 session 标签
    "blockLabels": []
  }
}
```

## 数据存储

| 路径 | 格式 |
|------|------|
| `memory/YYYY-MM-DD.md` | 每日对话日志 |
| `memory/persona.md` | 用户画像文件 |
| `memory/.yaoyao.db` | FTS5 + sqlite-vec 索引 |
| `memory/.backups/` | 时间戳快照备份 |
| `memory/.pipeline/` | L1→L3 管线检查点 |
| `memory/scene_blocks/` | 场景分组数据 |
| `memory/.archive/` | 已清理的旧日志 |

## 特性

- **中文友好** — FTS5 无法匹配 CJK 时自动降级 LIKE 模糊搜索
- **心情环** — 情感分析引擎，对话情绪一目了然
- **零依赖** — 仅 node:sqlite + sqlite-vec，无 Python 无额外 npm

## 要求

- OpenClaw ^2026.3.x
- Node.js ^22（原生 sqlite 支持）
- 可选：embedding API key 用于向量搜索
- 可选：LLM API key 用于记忆提取管线
