# Yaoyao Memory Plugin v1.9.0

> 摇摇 · 4 层 AI 记忆引擎 — FTS5 + sqlite-vec 混合检索、自动捕获、时间线、云备份、主题趋势。
> v1.8.x：全面适配小艺 Claw 架构（环境/通道/技能/设备/安全），论文驱动的记忆增强，SmartVector 四信号融合 + Dual Process 情景缓存 + 多模态记忆（hidden，测试中）。

[![Version](https://img.shields.io/badge/version-1.9.0-blue)](#)
[![Tools](https://img.shields.io/badge/tools-39%20%2B%201%20hidden-orange)](#-registered-tools)
[![Tests](https://img.shields.io/badge/tests-761%20passing-brightgreen)](#-testing)
[![Node](https://img.shields.io/badge/node-%E2%89%A518.0.0-339933)](package.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow)](LICENSE)

---

## 🌟 核心特性

| 模块 | 能力 |
|---|---|
| **4 层记忆架构** | L0 原始日志 → L1 事实抽取 → L2 语义合并 → L3 原子事实 → L4 关系图谱 |
| **混合检索** | FTS5 BM25 + sqlite-vec 向量 + 时间衰减 + 重要性加权（v1.8.2 七因子价值函数） |
| **自动捕获 / 召回** | 对话结束时自动落盘 L0，回答前自动注入相关记忆 |
| **小艺 Claw 适配** | 环境检测分层、channel/device 上下文、设备工具感知、Skills 输出识别、MEMORY.md 读写、Hardened 安全感知 |
| **论文驱动** | FadeMem (ICLR 2025) · MemX (EntropyRouter) · RecMem · Dual Process (Episodic-Semantic) · 七因子价值函数 |
| **零依赖基线** | 仅 `sqlite-vec`（默认向量后端）；`hnswlib-node` 为可选高性能 ANN |
| **本地优先** | 100% 本地存储，无遥测、无分析、无网络上报（除可选 LLM 增强和云备份） |

---

## 🚀 v1.8.x 头版亮点

### 🧬 小艺 Claw 架构全局适配（v1.8.0）

小艺 Claw 是 OpenClaw 之上的一个特殊运行环境（带 `core_skills/`、`xiaoyi-channel`、workspace 配置等独有信号）。yaoyao 不复制小艺的实现，而是把"小艺特性"作为 **加性适配层**叠在标准 OpenClaw 检测之上：

```
检测优先级（宁可漏检不可误判）：
┌─────────────────────────────────────────────────────┐
│  1. 高置信：xiaoyi-channel 插件 OR core_skills/secret-guardian
│  2. 中置信：SOUL.md + IDENTITY.md OR xiaoyiprovider
│  3. 低置信：env vars XIAOYI_CHANNEL_ACTIVE / XIAOYI_DEVICE_TYPE
│  →  高 ≥1 或 中 ≥2 才标记为 openclaw-xiaoyi
└─────────────────────────────────────────────────────┘
```

**适配行为（全部 optional，标准 OpenClaw 零影响）**

| 维度 | 小艺感知行为 |
|---|---|
| **Channel 上下文** | `agent_end` event 提取 channel 类型（a2a / websocket / standard）和 device（pad / phone / tablet），写入 capture meta 的 `source` 字段 |
| **设备工具调用** | 检测 `call_device_tool`（create_note / create_calendar_event 等），提取工具名+结果摘要到 `deviceInteractions`；日历类工具的 temporal 分类自动提升为 `"dynamic"` 且 expiryAt 缩短 |
| **Skills 输出识别** | 识别 `ship-learn-next` 等 Skill 产出，标记 `skillSource: { name, category }`，recall 支持 skill 过滤 |
| **MEMORY.md 长期记忆** | 新增 `memory_workspace` 工具，支持 `MEMORY.md` / `USER.md` / `IDENTITY.md` / `SOUL.md` / `TOOLS.md` 的 get / append / write；bootstrap 时预读 MEMORY.md 作为补充上下文 |
| **Hardened 安全** | 检测到 `secret-guardian` + `execution-validator` 双活跃时自动启用更激进脱敏 + 强制 `verifyActive=true` |
| **claw-core 共存** | 通用共存检测：UDS socket / `openclaw.json` 槽位 / `core_skills/` / `gspd_memory` 插件；运行时动态切换策略 |

### 🧬 论文驱动的记忆增强（v1.8.1）

| 论文 | 实现 |
|---|---|
| **FadeMem** (ICLR 2025) | 激活衰减 + 竞争性记忆巩固 |
| **MemX** (arXiv:2604.02176) | 上下文长度自适应检索（EntropyRouter） |
| **RecMem** (arXiv:2603.02758) | 双向参考路径解码 |

### 🧬 SmartVector 四信号融合 + 七因子价值函数（v1.8.2）

```
V(m) = w₁·BM25 + w₂·Vector + w₃·TimeDecay + w₄·Importance
```

新增 `signal-fusion` 核心模块，按 RRF (Reciprocal Rank Fusion) 融合 BM25 / FTS5 / 向量 / 实体增强四个信号；价值函数扩到七因子：

```
emotionalIntensity · goalRelevance · valueAlignment · userRelevance
            taskUtility · reliability · usageHistory
```

权重基于 LongMemEval 实证近似：reliability 和 userRelevance 各 0.20 主导，goalRelevance 0.12（query-time 决策不主导遗忘）。

### 🧬 Dual Process 情景缓存（v1.8.2）

基于 arXiv:2605.17625 "Episodic-Semantic Memory Architecture"：

- **System 1（episodic cache）** — 定长环形缓冲（默认 20 条），近匹配检索 O(n)，延迟 < 0.1ms
- **System 2（semantic LTM）** — 完整 SQLite + sqlite-vec 检索，延迟 < 10ms
- 自动 fallback：System 1 命中且评分高直接返回；未命中走 System 2 并把 System 2 结果回填 episodic

---

## 📦 安装

```bash
# 标准 OpenClaw 环境
openclaw plugin install yaoyao-memory-plugin
# 或 git 安装
openclaw plugin install git+https://github.com/taobaoaz/yaoyao-plugin.git
```

启动后你会看到：

```
🎲 ══════════════════════════════════════════
🎲    摇摇 · 记忆引擎已启动
🎲    v1.9.0  ·  39 Tools  ·  4 Hooks
🎲    FTS5 + sqlite-vec + 时间线 + 云备份
🎲    记忆目录: ~/.openclaw/workspace/memory/
🎲    环境检测: 全部通过
🎲 ══════════════════════════════════════════
```

---

## 🏗️ 架构

### 4 层记忆引擎

```
┌─────────────────────────────────────────────────┐
│  L3 — 关系图谱 (Memory Graph)                    │  ← 4 种关系类型
│       reinforces · supersedes · contradicts · elaborates
├─────────────────────────────────────────────────┤
│  L2 — 语义合并 (Semantic Consolidation)          │  ← LLM 合并相似条目
├─────────────────────────────────────────────────┤
│  L1 — 事实抽取 (Atomic Facts)                    │  ← LLM 提取原子事实
├─────────────────────────────────────────────────┤
│  L0 — 原始日志 (Daily Logs)                      │  ← 每日 markdown + SQLite WAL
└─────────────────────────────────────────────────┘
```

每条记忆都携带 `temporal` 标签（`static` / `dynamic` / `ephemeral`），决定衰减曲线和保留策略。

### 28 项 Brain 设计

| 类别 | 模块数 | 简述 |
|---|---|---|
| 捕获 | 6 | debounce / 内容提取 / 过滤 / 水位线 / meta |
| 存储 | 5 | SQLite FTS5 + sqlite-vec + WAL + 分片 + 归档 |
| 检索 | 7 | BM25 / 向量 / 多信号融合 / 时间线 / 推荐 |
| 维护 | 4 | 压缩 / 去重 / 清理 / 升级迁移 |
| 增强 | 6 | LLM 管线 / 情绪 / 标签 / 趋势 / 验证 |
| 系统 | 4 | 健康检查 / 遥测 / 配置 / 共存检测 |

### 召回与捕获优化

19 项腾讯 OpenClaw 实战优化已落地：分层 TTL 缓存、模式固化、JIT 预热、查询扩展、Jaccard 多样化、时间衰减半衰期、跨会话上下文等。

---

## 🪝 Hooks（4 个）

| Hook | 文件 | 触发时机 |
|---|---|---|
| `auto-capture` | `dist/src/hooks/auto-capture.js` | 对话结束（`agent_end`） |
| `auto-recall` | `dist/src/hooks/auto-recall.js` | 用户提问前 |
| `command-new` | `dist/src/hooks/command-new.js` | `/memory-new` 显式建档 |
| `heartbeat-recall` | `dist/src/hooks/heartbeat-recall.js` | 心跳/空闲回填 |

---

## 🔧 已注册工具（38 个）

| # | 工具 | 说明 |
|---|---|---|
| 1 | `memory_save` | 保存单条记忆（手动或自动捕获入口） |
| 2 | `memory_get` | 按 ID 取单条记忆 |
| 3 | `memory_list` | 分页列出记忆（按时间/类别/标签过滤） |
| 4 | `memory_search` | 主搜索（hybrid / fts / vector 三策略） |
| 5 | `memory_search_enhanced` | 增强搜索（关键词高亮 + 上下文提取） |
| 6 | `memory_search_multi` | 多信号融合搜索（v1.8.2 SmartVector） |
| 7 | `memory_search_timeline` | 时间线感知搜索 |
| 8 | `memory_adaptive_search` | 自适应搜索（MemX EntropyRouter 路由） |
| 9 | `memory_atomic_fact` | 原子事实抽取与查询 |
| 10 | `memory_graph` | 知识图谱查询 |
| 11 | `memory_graph_relation` | 关系图谱查询（reinforces/supersedes/contradicts/elaborates） |
| 12 | `memory_timeline` | 时间线视图 |
| 13 | `memory_tag` | 标签管理 |
| 14 | `memory_note` | 便签/备忘 |
| 15 | `memory_cron` | 定时提醒检测 |
| 16 | `memory_remind` | 主动提醒 |
| 17 | `memory_forget` | 主动遗忘 |
| 18 | `memory_recommend` | 基于上下文的关联记忆推荐 |
| 19 | `memory_stats` | 统计（按类别/标签/时间分布） |
| 20 | `memory_quality` | 质量分析（重复/空洞/低价值检测） |
| 21 | `memory_conflicts` | 冲突检测（对立记忆识别） |
| 22 | `memory_verify` | 防幻觉验证（推测性内容标记） |
| 23 | `memory_skill_analytics` | Skill 产出分析（哪个 Skill 产出最多价值记忆） |
| 24 | `memory_benchmark` | 性能基准（搜索延迟 / 缓存命中率 / 信号权重分布） |
| 25 | `memory_workspace` | **v1.8.0+** 读写 MEMORY.md / USER.md / IDENTITY.md / SOUL.md / TOOLS.md |
| 26 | `memory_analyze` | **v1.8.0+** 分析入口（v1.7.4+ 已迁移至 yaoyao-soul，本工具为迁移提示 stub） |
| 27 | `memory_call` | 在记忆上下文里调用工具 |
| 28 | `memory_healthcheck` | 健康检查（环境/数据库/配置/缓存） |
| 29 | `memory_telemetry` | 遥测（纯本地，无外发） |
| 30 | `memory_unify` | 多源记忆合并 |
| 31 | `memory_retain` | 保留检查（即将被清理的记忆预审） |
| 32 | `memory_backup` | 备份（本地 tar.gz） |
| 33 | `memory_export` | 导出（JSON / Markdown） |
| 34 | `memory_import` | 导入（JSON / Markdown） |
| 35 | `memory_import_oc` | 从 OpenClaw workspace 导入 |
| 36 | `memory_import_workspace` | 从 workspace 全量导入 |
| 37 | `memory_trends` | 主题趋势（词频变化 / 上升 / 衰减） |
| 38 | `memory_cloud_sync` | 云备份同步（SFTP / Samba / S3 / WebDAV） |

---

## 🧪 测试功能（Hidden · 默认关闭）

> **配套隐藏声明**：本节列出的工具处于测试状态，**默认不在 runtime 注册，也不会出现在上文「已注册工具」主表里**。只有当你在 `openclaw.json` 里把对应配置块的 `enabled` 显式置为 `true`，工具才会被注册、才会在主表里被计入。
>
> 上方 badge `tools-38 + 1 hidden` 中「+1 hidden」指的就是这一节列出的测试工具；主表 38 个始终是默认交付。

| # | 工具 | 触发配置 | 状态 | 说明 |
|---|---|---|---|---|
| 🧪 1 | `memory_multimodal` | `config.multimodal.enabled = true` | 测试 | 多模态记忆（image / audio / video），仅在显式开启后注册 |

**启用方式（仅在你确认需要时开启）**

```jsonc
// openclaw.json
{
  "multimodal": {
    "enabled": true,
    "storageDir": "~/.openclaw/workspace/memory/multimodal",
    "maxFileSizeMb": 50
  }
}
```

**配套规则**

- `enabled` 默认 `false`，不开启时插件行为与 v1.8.x 完全一致
- 测试功能不进入主表、不计入默认工具数、不参与核心契约回归

---

## ⚙️ 配置

完整 schema 见 [openclaw.plugin.json](openclaw.plugin.json)。关键分组：

```jsonc
{
  "capture": {
    "enabled": true,            // 自动捕获开关
    "mode": "async",            // sync | async (默认 async, 通过 write-queue 缓冲)
    "maxContentLen": 500,       // 单条捕获最大字符数
    "minContentLen": 3,         // 短输入阈值
    "batchSize": 10,            // 异步批量上限
    "debounceMs": 300,          // flush 最小延迟
    "excludeAgents": []         // 不参与捕获的 agent label
  },
  "recall": {
    "enabled": true,
    "strategy": "hybrid",       // hybrid | fts | vector
    "maxResults": 3,
    "topK": 5,                  // 向量候选数
    "minScore": 0.5,            // 向量相似度阈值
    "cacheTTL": 30000,          // 搜索结果缓存 (ms)
    "maxCacheSize": 50,
    "halfLife": 30,             // 时间衰减半衰期（天）
    "jaccardBase": 0.75,        // 多样化采样 Jaccard 阈值
    "maxSessions": 1000,        // 跨会话上下文累积上限
    "maxContextKeywords": 20
  },
  "embedding": {
    "enabled": false,           // 启用后支持向量+混合搜索
    "provider": "openai",
    "model": "",                // 留空根据 provider 自动选择
    "dimensions": 1024,
    "vectorBackend": "sqlite-vec",  // sqlite-vec (零依赖) | hnswlib (高性能, 需手动装)
    "hnswMaxElements": 50000,
    "timeoutMs": 15000,
    "retries": 1
  },
  "llm": {
    "enabled": true,            // 留空则自动复用 embedding 配置
    "model": "",
    "providerModels": {}        // 自定义 provider→model 映射
  },
  "cleanup": {
    "enabled": true,
    "l0l1RetentionDays": 30,    // 每日日志保留天数
    "allowAggressiveCleanup": false,
    "maxBackups": 10
  },
  "verify": { "enabled": true },   // 防幻觉（推测性内容标记）
  "quality": { "enabled": true },  // 注册 memory_quality
  "retain": { "enabled": true },   // 注册 memory_retain
  "graph": { "enabled": true },    // 注册 memory_graph
  "autoSaveImage": false,          // AI 收到图片后自动保存描述
  "cloud": {
    "enabled": true,
    "autoSync": false,
    "conflictPolicy": "newer",     // newer | keep_both
    "cmdTimeoutMs": 30000
  }
}
```

### 环境变量（仅小艺 Claw 检测）

| 变量 | 作用 |
|---|---|
| `XIAOYI_CHANNEL_ACTIVE=1` | 标记小艺 channel 激活 |
| `XIAOYI_DEVICE_TYPE=pad\|phone\|tablet` | 设备类型提示（低置信） |
| `OPENCLAW_HOME` | OpenClaw 安装根 |
| `OPENCLAW_CONFIG_PATH` | openclaw.json 路径 |

---

## 🧪 测试

```bash
npm test                  # 全部 761 单元测试
npm run test:ci           # CI 子集（排除 parallel）
npm run test:db           # 仅 DB 层
npm run test:store        # 仅 memory-store
npm run benchmark         # 性能基准
```

**当前状态：761 测试全部通过**，覆盖 186 个测试模块，覆盖率重点模块包括：

- SmartVector 多信号融合（BM25 + 向量 + 时间衰减 + 重要性）
- 七因子价值函数（7 个独立因子 + 加权综合）
- Dual Process 情景缓存（System 1 / System 2 回填）
- FadeMem 激活衰减与竞争巩固
- MemX EntropyRouter
- RecMem 双向参考路径解码
- 小艺环境检测 6 路信号（含 SOUL.md + IDENTITY.md 推理）
- MEMORY.md 读写 + 白名单
- Hardened 安全脱敏
- 共存检测（UDS / 槽位 / core_skills）
- SRMU 三层守卫（RelevanceGate / SemanticShiftDetector / MemoryBackprop）
- MemGAS 多粒度（GMM 聚类 + 熵路由）
- SkVM 工具调用缓存

---

## 📊 性能基准

| 指标 | 实测 |
|---|---|
| FTS5 单关键词搜索 | < 1ms (10k 记忆) |
| 向量检索 (sqlite-vec, 1024d) | < 5ms (10k 记忆) |
| 四信号融合（SmartVector） | < 1ms |
| Dual Process 快路径 | < 0.1ms |
| 七因子价值函数 | < 0.5ms |
| L1 原子事实抽取（LLM） | 300–800ms |
| L2 语义合并（LLM） | 500–1500ms |
| 启动到 banner 显示 | < 200ms |

---

## 🔒 兼容性

| 平台 | 状态 |
|---|---|
| OpenClaw 标准环境 | ✅ 完全支持 |
| OpenClaw + LLM 增强 | ✅ 可选启用 |
| 小艺 Claw（v1.8.0+） | ✅ 自动识别，零配置适配 |
| Claw-Core（v1.7.9+） | ✅ 共存模式（coexist / standalone） |
| 旧版 OpenClaw（< 2026.4.2） | ❌ pluginApi 不兼容 |

`openclaw.plugin.json` 的 `compat` 字段声明：

```json
{
  "openclaw.compat.pluginApi": ">=2026.4.2",
  "openclaw.build.openclawVersion": "2026.5.6"
}
```

---

## 🛣️ 路线图

### ✅ v1.8.x（已完成）

- [x] v1.8.0 — 小艺 Claw 架构全局适配（环境/通道/技能/设备/安全 6 维）
- [x] v1.8.1 — 论文驱动增强（FadeMem / MemX / RecMem）
- [x] v1.8.2 — SmartVector 四信号融合 + 七因子价值函数 + Dual Process 情景缓存
- [x] v1.8.2-hotfix — TypeScript 严格模式零错误 + 4 项功能 bug 修复
- [x] 39 个工具 + 4 个 hook + 761 单元测试

### 📋 v1.9（计划）

- [ ] 跨设备记忆同步（P0）
- [ ] LLM 自动情绪曲线生成
- [x] 记忆冲突自动消解（基于时间+来源+置信度）
- [x] 自适应 TTL（按类别）

### 🔮 v2.0（远期）

- [x] 多模态记忆（图片 / 音频 / 视频嵌入，v1.8.3 hidden）
- [ ] 端到端加密的云同步
- [ ] 联邦记忆（多 agent 共享部分记忆）
- [ ] 主动遗忘（基于遗忘曲线理论的智能清理）

---

## 🛡️ 安全

- **本地优先**：所有记忆数据存储在本地 SQLite + markdown 文件，不上传任何遥测
- **零网络外发**：除可选 LLM 增强（用户配置）和云备份（用户显式启用）外无网络调用
- **内容脱敏**：Hardened 环境自动启用 token / API key / password pattern 占位替换
- **防幻觉**：`verify` 模块在 auto-capture 中标记推测性 / 纠正性内容，避免错误记忆固化
- **配置完整性**：schema 校验 + 热重载保护
- **完整安全声明**：见 [SECURITY.md](SECURITY.md)

```json
"openclawSecurity": {
  "dataStorage": "100% local (SQLite FTS5 + filesystem). No telemetry. No analytics.",
  "dependencies": "Minimal: sqlite-vec for optional vector search; typescript (dev)."
}
```

---

## 🤝 贡献

欢迎 PR。所有改动请附带：

1. `npm test` 全通过（761 测试）
2. `npm run build` 零错误
3. 新功能对应单元测试
4. CHANGELOG.md 更新

---

## 📄 License

[MIT](LICENSE) — 摇摇 (Yaoyao)

仓库：[github.com/taobaoaz/yaoyao-plugin](https://github.com/taobaoaz/yaoyao-plugin)
问题反馈：[Issues](https://github.com/taobaoaz/yaoyao-plugin/issues)
安全披露：[SECURITY.md](SECURITY.md)
