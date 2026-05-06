# Yaoyao Memory Plugin

🎲 搭载摇摇记忆引擎的四层记忆系统 — 让 AI 拥有真正的长时记忆。

**19 个工具 · 3 个 Hook · FTS5 + sqlite-vec 混合搜索 · 情感分析 · 心理学模型 · L4 反馈学习 · 90 单元测试**

---

## 架构

```
L0 — 每日对话日志        (memory/YYYY-MM-DD.md)     ← 自动捕获
L1 — 结构化记忆索引      (.yaoyao.db FTS5 + vec)    ← 混合搜索
L2 — 场景分组            (scene_blocks/)             ← LLM 管线
L3 — 用户画像            (persona.md)                ← LLM 提炼
     ├─ PersonaStateMachine — mood/energy/trust 计算
     ├─ Mood 趋势预测 + 置信度衰减
     ├─ 自适应引导 (tone/verbosity/autonomy)
     └─ L4 反馈学习层 (FeedbackTracker)
```

## 工具 (19 个)

| 工具 | 用途 |
|------|------|
| `yaoyao_memory_search` | 🔍 FTS5 全文搜索 + CJK 模糊降级 |
| `yaoyao_memory_get` | 📖 读取指定记忆文件 |
| `memory_list` | 📋 列出所有记忆文件 |
| `memory_save` | 💾 手动记录一条记忆 |
| `memory_stats` | 📊 记忆统计（总量、日期分布、场景、反馈、标签） |
| `memory_mood` | 🎨 **分析情绪趋势** — 心情环可视化 |
| `memory_timeline` | 📅 **时间线热力图** — ███ 密度条 |
| `memory_search_timeline` | 🔍📅 **搜索 + 时间轴分组** |
| `memory_backup` | 📦 **创建快照备份**（全量 / 增量） |
| `memory_forget` | 🗑️ **按关键词或日期删除** |
| `memory_note` | 📌 **快捷笔记** — 像便签一样存 |
| `memory_optimize` | 🧠 **L4 反馈学习** — 分析纠错模式生成优化建议 |
| `memory_graph` | 🕸️ **记忆关联图谱** — 多维度关联（标签/场景/时间） |
| `memory_search_enhanced` | 🔍📈 **语义搜索增强** — 向量重排序 + 关键词高亮 |
| `memory_export` | 📤 **记忆导出** — JSONL 格式，支持跨设备迁移 |
| `memory_import` | 📥 **记忆导入** — 从 JSONL 格式恢复记忆 |
| `memory_tag` | 🏷️ **记忆标签** — 打标签、按标签搜索、热门标签 |
| `memory_remind` | ⏰ **记忆定时提醒** — 生成 cron 任务推送记忆 |
| `memory_recommend` | 🎯 **记忆推荐** — 基于上下文 + 场景多样化的智能推荐 |

## 心理学模型

插件内置 AI 状态计算引擎 **PersonaStateMachine**，自动追踪用户的交互状态：

| 维度 | 计算方式 | 作用 |
|------|----------|------|
| **Mood** (情绪) | 情感分析 + 滚动窗口 + 历史混合 | 调整语气：positive→温馨，negative→柔和 |
| **Energy** (能量) | 消息长度 + 交互频率 + 时段 | 调整回复篇幅：high→精简，low→详细 |
| **Trust** (信任) | 指数移动平均 + 早期保护 | 调整自主权：high→主动推荐，low→谨慎确认 |
| **Confidence** (置信度) | 长期空闲时自动衰减 | 长时间无交互后降低推断力度 |
| **MoodTrend** (趋势) | 最近 5 次 delta 判断 | rising→可扩展，falling→更支持 |
| **Mood 预测** | 线性外推 + 方差阻尼 | 提前适配下一轮语气 |

全部 try-catch 兜底，失效不影响主流程。

## L4 反馈学习层

自动监听用户纠错，记录到 `.feedback.jsonl`：

- **纠错检测**：`"不对"/"不是"/"错了"/"太啰嗦"/"语气不对"` 等模式匹配
- **反馈统计**：按标签分组（memory / tone / relevance / timing）
- **`memory_optimize` 工具**：手动触发分析，输出优化建议
- **`FeedbackTracker.learn()`**：自动从历史反馈中学习模式

## 测试

**87 个单元测试 · 38 个 describe · 14 个测试模块 · 全零依赖**

| 测试模块 | 数量 | 覆盖 |
|----------|------|------|
| `sentiment.test.ts` | 9 | 情感分析（中/英、混合、空文本） |
| `memory-store.test.ts` | 14 | 存储/读写/列出/清理 |
| `llm-parse.test.ts` | 9 | JSON 解析、日期格式化 |
| `session-filter.test.ts` | 12 | Session 过滤规则 |
| `db-bridge.test.ts` | 15 | FTS5/向量/混合搜索/边缘 |
| `db-bridge-extra.test.ts` | 7 | 混合搜索/插入/LIKE/CJK |
| `persona-state.test.ts` | 13 | 状态/更新/引导/衰减/预测/持久化 |
| `feedback-tracker.test.ts` | 9 | 记录/统计/学习/压缩 |
| `memory-export.test.ts` | 5 | JSONL 格式/日期筛选/关键词过滤 |
| `memory-tag.test.ts` | 7 | 标签添加/搜索/移除/热门/清理/大小写 |
| `memory-graph.test.ts` | 4 | FTS5/场景关联/跨项目搜索 |
| `memory-search-enhanced.test.ts` | 7 | FTS5/LIKE/关键词提取/高亮 |
| `memory-import.test.ts` | 4 | JSONL 解析/格式校验/日期截断 |

## 心理学模型

## 性能基准

在 500 条数据下：

| 操作 | 延迟 (avg) |
|------|-----------|
| FTS5 单次查询 | **0.06ms** |
| FTS5 多词查询 | **0.03ms** |
| LIKE 降级（CJK） | **~0ms** |
| 插入 + FTS5 索引 | **11.1ms** |
| 混合搜索（FTS5 only） | **0.16ms** |

DB 大小：~204KB（500 条条目）。

运行：`npm run benchmark`

## 快速开始

```bash
# ClawHub
openclaw plugins install yaoyao-memory

# 或从 GitHub 手动安装
git clone https://github.com/taobaoaz/yaoyao-plugin.git
cd yaoyao-plugin
openclaw plugins install .
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

    // 向量搜索（可选，开启后支持混合搜索）
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
    "blockLabels": [],

    // 多模态记忆：AI 自动保存图片描述到记忆（默认关闭）
    "autoSaveImage": false
  }
}
```

## 数据存储

| 路径 | 格式 |
|------|------|
| `memory/YYYY-MM-DD.md` | 每日对话日志 |
| `memory/persona.md` | 用户画像文件 |
| `memory/.yaoyao.db` | FTS5 + sqlite-vec 索引 |
| `memory/.backups/` | 时间戳快照备份（全量/增量） |
| `memory/.backups/.last-backup.json` | 增量备份时间戳标记 |
| `memory/.pipeline/` | L1→L3 管线检查点 |
| `memory/.pipeline/` | L1→L3 管线检查点 |
| `memory/.feedback.jsonl` | L4 反馈学习记录 |
| `memory/scene_blocks/` | 场景分组数据 |
| `memory/.archive/` | 已清理的旧日志 |

## 特性

- **中文友好** — FTS5 无法匹配 CJK 时自动降级 LIKE 模糊搜索
- **心情环** — 情感分析引擎，对话情绪一目了然
- **心理学模型** — 状态追踪 + 趋势分析 + 自适应引导
- **L4 反馈学习** — 自动监听纠错、统计模式、生成优化建议
- **零依赖** — 仅 node:sqlite + sqlite-vec，无 Python 无额外 npm
- **101 测试全绿** — 全零依赖，node:test 原生运行

## 要求

- OpenClaw ^2026.3.x
- Node.js ^22（原生 sqlite 支持）
- 可选：embedding API key 用于向量搜索
- 可选：LLM API key 用于记忆提取管线

