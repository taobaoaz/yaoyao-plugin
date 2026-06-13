# Yaoyao Memory Plugin v1.7.8

🎲 搭载摇摇记忆引擎的四层记忆系统 — 让 AI 拥有真正的长时记忆。

**31+ 工具 · 4 个 Hook · FTS5 + sqlite-vec 混合搜索 · 47 项引擎设计 · 698 单元测试**

> 🧠 **v1.7.8 SRMU 记忆反传播**：新增 RelevanceGate 复合评分过滤、SemanticShiftDetector 主题漂移检测、MemoryBackprop A-Mem 交叉记忆关系发现，三层守卫协同提升记忆质量。

> 🌐 **官网**: [https://hvfejh3fgzox4.kimi.site](https://hvfejh3fgzox4.kimi.site)
>
> 📋 安装时看到 Moderation 标记？请阅读 [SECURITY.md](./SECURITY.md) — 所有标记均有合理解释。

> ⚠️ **从 v1.4.x 升级？** 架构已拆分（记忆存取 vs 情绪观察），**数据 100% 保留**。阅读 [MIGRATION.md](./MIGRATION.md) 获取一键迁移脚本和详细步骤。

---

## 架构

```
L0 — 每日对话日志        (memory/YYYY-MM-DD.md)     ← 自动捕获 (agent_end)
L1 — 结构化记忆索引      (.yaoyao.db FTS5 + vec)    ← 混合搜索 (before_prompt_build)
L2 — 场景分组            (scene_blocks/)             ← 关联图谱 + Memory Compactor
L3 — 用户画像            (persona.md / preference slots) ← L1 提取器
L4 — 记忆质量评估        (memory_quality / trends)   ← 纯统计，无需 LLM
```

> 💡 v1.4.x 中的 **心理学模型**（PersonaStateMachine、情绪追踪、L4 反馈学习）已拆分为独立插件 [yaoyao-soul](https://github.com/taobaoaz/yaoyao-soul)。安装后可与本插件协同工作。

---

## 双模式：Lite vs Full

| 模式 | 依赖 | 核心能力 |
|------|------|----------|
| **Lite**（默认） | 零外部依赖 | FTS5 搜索、正则启发式提取、Jaccard 去重、时间衰减 |
| **Full** | 需 LLM API | L1 原子事实提取、Mermaid Canvas 符号化、高质量画像 |

```json5
{
  "brainMode": "lite"  // 或 "full"
}
```

---

## 功能模块

### 一、论文驱动的新能力

#### 🧬 SRMU: 记忆反传播 (Memory Back-Propagation) — v1.7.8

基于 *Self-Reinforcing Memory Units* (SRMU) 的三层记忆守卫系统，从源头上过滤低质记忆、检测主题漂移、发现记忆间交叉关系。

| 模块 | 功能 | 论文来源 |
|------|------|----------|
| **RelevanceGate** | 四维复合评分：信息密度 + 新颖性 + 时间衰减 + 内容复杂度。重复内容自动降权（timeDecay），过度重复直接拦截（repeatBlockThreshold），短噪声零容忍 | SRMU §3.1 |
| **SemanticShiftDetector** | 轻量滑动窗口主题漂移检测。连续漂移自动 flush，空闲超时自动 flush，支持 short-content skip 和 disabled 降级 | SRMU §3.2 |
| **MemoryBackprop** | A-Mem 风格交叉记忆关系：`reinforces` / `supersedes` / `contradicts` / `elaborates`。trigram 相似度 + 否定词检测，O(1) 指纹缓存防循环 | A-Mem §4.1 |

---

#### 🧬 MemGAS: 多粒度记忆关联与选择 — v1.7.4

MemGAS 通过 GMM 聚类和熵路由构建多粒度记忆关联，自适应选择最优搜索粒度。

| 模块 | 功能 | 论文来源 |
|------|------|----------|
| **GMM 聚类引擎** | EM 算法对新记忆进行主题聚类，滑动窗口增量训练 | MemGAS §3.1 |
| **聚类标签** | 每条记忆写入时自动标记 `cluster:<id>:conf:<f>`，支持下游主题感知检索 | MemGAS §3.2 |
| **熵路由** | 分析查询长度/实体数/精确词/宽泛词，计算熵值 [0,1]，自动调整 maxResults 和 minScore | MemGAS §3.3 |
| **多粒度分层** | L0(精确窄搜)/L1(中等)/L2(宽泛+聚类扩展)，按熵值自动切换 | MemGAS §3.4 |
| **聚类扩展** | 高熵查询自动拉取同簇记忆，带分数折扣 + 去重 | MemGAS §3.5 |

#### ⚡ SkVM: 智能缓存与模式固化

SkVM 将工具调用视为代码，通过编译与运行时优化减少冗余计算。

| 模块 | 功能 | 论文来源 |
|------|------|----------|
| **工具调用缓存** | 复合键 (tool+params) 缓存，内存捕获时自动失效；支持 L2 全局缓存 + 每 hook LRU | SkVM §4.1 |
| **分层 TTL** | L0=30秒 / L1=5分钟 / L2=不缓存，按搜索粒度精细化缓存策略 | SkVM §4.2 |
| **短路由** | 预检模式是否已训练，跳过重复刷新，返回 fallback 统计 | SkVM §4.3 |
| **模式检测** | 追踪反复出现的工具调用链，为 JIT 固化做准备 | SkVM §4.2 |
| **召回模式追踪** | FNV-1a 哈希摘要存储查询模式，不存原始文本，记录 4 种事件类型 | 配套工程 |

> 以上模块仅在 `memory-call-search` 通道中激活，需配置 embedding 后完整生效。纯 FTS5 搜索不受影响。

---

### 二、四层记忆引擎（28 项 Brain 设计，全部零依赖）

#### 检索增强（12 项）
| 模块 | 功能 |
|------|------|
| **Adaptive Retrieval** | 智能跳过问候/命令/心跳，节省 API 调用 |
| **Noise Filter** | 过滤 denials、meta-questions、boilerplate |
| **Query Expander** | 口语词 → 技术词映射 |
| **Retrieval Trace** | 完整检索链路追踪，可审计 |
| **Temporal Classifier** | 静态事实 vs 动态事件自动分类 |
| **Retrieval Stats** | 聚合查询指标，性能监控 |
| **Length Normalization** | 短记忆长度归一化，防长文本垄断 |
| **Importance Weighting** | 基于重要性的搜索加权 |
| **Access Tracker** | 访问计数 + 自动 tier 晋升 |
| **Auto-Recall Tier 1** | 最小召回单元，避免信息过载 |
| **Intent Analyzer** | 意图分类 + 类别 boost |
| **Confidence Scorer** | ROUGE-Like F1 计算记忆-查询匹配度 |

#### 存储优化（8 项）
| 模块 | 功能 |
|------|------|
| **Chunker** | 长回复 >4000 字符自动分块索引 |
| **Session Compressor** | 长会话压缩为高信号回合 |
| **Memory Compactor** | 渐进式摘要合并相似记忆 |
| **Memory Categories** | 6 类分类（profile/preferences/entities/events/cases/patterns） |
| **Preference Slots** | 品牌-物品偏好结构化提取 |
| **Tier Manager** | core → working → peripheral 三层晋升/降级 |
| **Batch Dedup** | trigram Jaccard + Levenshtein 批量去重 |
| **Memory Upgrader** | 首句提取 + L0/L1/L2 摘要 |

#### 质量与恢复（8 项）
| 模块 | 功能 |
|------|------|
| **Support Info V2** | 置信度徽章 `[置信度85%]` |
| **Self-Improvement Log** | 错误自动记录供后续分析 |
| **Reflection Ranking** | logistic / weibull 衰减评分 |
| **Reflection Retry** | 智能错误分类重试（transient vs permanent） |
| **Session Recovery** | 跨会话上下文恢复 |
| **Scope Manager** | 多 agent 记忆隔离 |
| **Identity Addressing** | 检测用户称呼偏好 |
| **Auto Capture Cleanup** | 自动清理 conversation info、@mentions |

---

### 三、召回与捕获优化（19 项腾讯方案，全部零依赖）

#### 召回控制（5 项）
| 配置 | 说明 |
|------|------|
| `recall.position` | `prepend` = 召回放用户消息前，prompt cache 更友好 |
| `recall.timeoutMs` | 召回超时自动跳过，不阻塞对话 |
| `recall.minResults` | 结果太少时 fallback 到最近记忆 |
| `recall.maxChars` | 限制注入总长度，防 token 爆炸 |
| `recall.scoreThreshold` | 分数阈值过滤低质量记忆 |

#### 捕获控制（7 项）
| 配置 | 说明 |
|------|------|
| `capture.excludeAgents` | Glob 排除特定 agent（如 `bench-*`） |
| `capture.enableWarmup` | 新 session 指数退避 1→2→4→8 轮捕获 |
| `capture.everyNConversations` | 固定间隔捕获 |
| `capture.excludePatterns` | 正则排除特定内容 |
| `capture.enableDedup` | 写入前批量去重开关 |
| `capture.maxMemoriesPerSession` | 单次 L1 提取上限（默认 20） |
| `capture.sessionActiveWindowHours` | 会话活跃窗口（默认 24h） |

#### 基础设施（7 项）
| 模块 | 说明 |
|------|------|
| **BM25 稀疏向量** | 纯正则分词 + BM25(k1=1.2, b=0.75)，中英文混合 |
| **MMD Block Filter** | 排除 Mermaid Canvas 中间产物，防误存压缩垃圾 |
| **Manifest** | `.metadata/manifest.json` 记录版本/安装/种子历史 |
| **Session Activity** | 追踪会话活跃状态，超窗口标记 stale |
| `embedding.recallTimeoutMs` | 召回侧 embedding 独立超时，降级纯 FTS5 |
| `embedding.captureTimeoutMs` | 捕获侧 embedding 独立超时（预留） |
| `capture.cleanTime` | HH:MM 格式定时清理（如 `"03:00"`） |

---

### 四、31+ Agent 工具

| 类别 | 工具 |
|------|------|
| **搜索** | `memory_search` (FTS5), `memory_search_enhanced` (向量重排序), `memory_search_timeline` (时间轴分组), `memory_graph` (关联图谱) |
| **读写** | `memory_get`, `memory_list`, `memory_save`, `memory_note` (快捷笔记), `memory_tag` (标签管理) |
| **管理** | `memory_backup` (全量/增量), `memory_forget`, `memory_export` (JSONL), `memory_import` (JSONL/md), `memory_import_oc` (OC chunks), `memory_import_workspace` (MEMORY.md/USER.md), `memory_unify` (跨后端去重) |
| **分析** | `memory_stats`, `memory_mood` (Ekman 情绪), `memory_timeline` (热力图), `memory_trends` (话题频率), `memory_quality` (健康度评估), `memory_retain` (反遗忘), `memory_verify` (防幻觉验证) |
| **同步** | `memory_cloud_sync` (WebDAV/S3/SFTP/Samba) |
| **提醒** | `memory_remind` (cron 配置) |
| **推荐** | `memory_recommend` (上下文 + 衰减 + 多样性) |
| **定时任务** | `memory_cron` (列出/检测/禁用冲突的 OpenClaw 定时任务) |

---

### 五、Hook（4 个）

| Hook | 触发时机 | 作用 |
|------|----------|------|
| `agent_end` | 每次对话结束 | 自动捕获 → L0 日志 + FTS5 索引 + 可选 L1 提取 + Mermaid offload + GMM 聚类标记 |
| `before_prompt_build` | 每次对话开始 | 召回相关记忆 → 注入上下文（append/prepend 两种位置），熵路由精度调节 |
| `heartbeat-recall` | 心跳触发 | 后台定期召回，预热缓存 |
| `command-new` | 新对话创建 | 跨会话上下文恢复，Session Recovery |

---

### 六、LLM 增强（Full 模式）

| 模块 | Lite | Full |
|------|------|------|
| **L1 Extractor** | 正则启发式（identity/preference/task/correction） | LLM JSON 提取 + 置信度评分 |
| **Mermaid Canvas** | 正则解析工具调用生成 Mermaid 图 | 未来：LLM 生成更精确流程图 |

---

### 七、系统架构感知 (v1.7.4)

- **自动检测** — 读取 OpenClaw 全局配置，检测 memory/contextEngine 槽位归属
- **共存模式** — 支持与 claw-core/xiaoyiclaw 等其他记忆系统共存，自动选择策略（full / l0-only / supplement / disabled）
- **运行时监控** — UDS 监控，运行时检测架构变化

---

## 安全加固

| 层级 | 措施 |
|------|------|
| 文件权限 | `memory/` 目录 `0o700`，DB/日志文件 `0o600` |
| 路径防护 | `memoryDir` 禁止 `..` 和相对路径 |
| 传输安全 | HTTPS/SFTP/TLS |
| SSRF 防护 | 禁止 localhost/内网地址 |
| 密钥脱敏 | 日志自动掩码 `***` |
| FTS5 安全 | 参数化查询，语法清洗防 crash |

---

## 测试

**698 单元测试 · 全原生运行 · 0 TypeScript 严格模式错误 · 仅 sqlite-vec（外部 npm 依赖）**

覆盖 35+ 测试模块：情感分析、存储读写、session 过滤、FTS5/向量/混合搜索、导入导出、标签、图谱、增强搜索、质量评估、趋势分析、cron 提醒、反遗忘、防幻觉、L1 提取、Mermaid Canvas、glob 匹配、BM25、session 活动、FileDB 回退、备份管理、内存清理、LLM 客户端等。

**v1.7.8 新增测试**：28 个新测试用例覆盖 RelevanceGate (9)、SemanticShiftDetector (11)、MemoryBackprop (8)。

**v1.7.4 新增测试**：44 个新测试用例覆盖熵路由 (12)、GMM 聚类 (13)、多粒度路由 (12)、工具缓存 (19)、短路由 (10)、聚类扩展 (17)、分层 TTL (13)、召回模式 (10)、结构日志等。

**v1.7.0 架构强化**：9 项大文件拆分、TypeScript strict 全面修复、as any 消除、跨层引用固化。详见 [CHANGELOG.md](./CHANGELOG.md)。

运行：`npm test`

#### 论文模块测试

| 测试模块 | 用例数 |
|----------|:------:|
| entropy-router | 12 |
| gmm-cluster | 13 |
| cluster-id-sink | 13 |
| cluster-expander | 17 |
| multi-granularity-router | 12 |
| tool-call-cache | 19 |
| layer-ttl | 13 |
| short-circuit | 10 |
| recall-pattern-sink | 10 |
| pattern-solidifier | 8 |
| structured-log | 5 |

---

## 性能基准（500 条数据）

| 操作 | 延迟 |
|------|------|
| FTS5 单次查询 | **0.06ms** |
| FTS5 多词查询 | **0.03ms** |
| LIKE 降级（CJK） | **~0ms** |
| 插入 + FTS5 索引 | **11.1ms** |
| 混合搜索（FTS5 only） | **0.16ms** |

运行：`npm run benchmark`

---

## 快速开始

### 从旧版本升级（v1.4.x → v1.7.0）

```bash
cd ~/.openclaw/extensions/yaoyao-memory
git pull origin main
# 阅读 [MIGRATION.md](./MIGRATION.md) 完成配置更新
```

**数据完全保留**，只需更新代码 + 调整配置。

### 全新安装：ClawHub（推荐）

```bash
openclaw plugins install yaoyao-memory
```

安装后在 `openclaw.json` 中添加配置：

```json5
{
  "plugins": {
    "allow": ["yaoyao-memory"],  // 必须显式声明！
    "entries": {
      "yaoyao-memory": {
        "enabled": true,
        "config": {
          "capture": { "enabled": true },
          "recall": { "enabled": true, "maxResults": 3 }
        }
      }
    }
  }
}
```

> ⚠️ **从 v1.5.x 升级？** 架构有重大重构（文件拆分、类型修复），git pull 后请运行 `npm test` 确认无回归。

> ⚠️ **必须** 在 `plugins.allow` 中添加 `"yaoyao-memory"`，否则插件不会加载。

### 手动安装

```bash
git clone https://github.com/taobaoaz/yaoyao-plugin.git
cp -r yaoyao-plugin ~/.openclaw/extensions/yaoyao-memory
```

然后在 `openclaw.json` 中添加上述配置。重启 Gateway：

```bash
openclaw gateway restart
```

### 验证安装

启动后应看到：
```
🎲 ══════════════════════════════════════════
🎲    摇摇 · 记忆引擎已启动
🎲    v1.7.8  ·  31+ Tools  ·  4 Hooks
🎲 能力: FTS5✅ Vec✅ LLM⚪ Cloud⚪ MemGAS✅ SkVM✅ SRMU✅
```

---

## 配置示例

```json5
{
  "enabled": true,
  "config": {
    // ===== 核心模式 =====
    "brainMode": "lite",  // "lite" = 纯本地, "full" = 启用 LLM

    // L0 自动捕获
    "capture": {
      "enabled": true,
      "excludeAgents": [],        // Glob 排除 agent
      "enableWarmup": false,      // 指数退避捕获
      "everyNConversations": 0,   // 固定间隔捕获
      "excludePatterns": [],      // 正则排除
      "enableDedup": true,        // 批量去重
      "dedupThreshold": 0.92,
      "dedupLookback": 5,
      "maxMemoriesPerSession": 20,  // 单次提取上限
      "sessionActiveWindowHours": 24,
      "cleanTime": "03:00",        // 定时清理
      // LLM 功能开关
      "enableL1": false,
      "enableContextOffload": false,
      "offloadThreshold": 4000
    },

    // L1 自动召回
    "recall": {
      "enabled": true,
      "maxResults": 3,
      "position": "append",       // "prepend" = cache-friendly
      "timeoutMs": 5000,          // 超时降级
      "minResults": 0,            // 太少时 fallback
      "maxChars": 0,              // 注入长度限制
      "scoreThreshold": 0,        // 分数过滤
      "hintText": "",             // 自定义提示
      "excludeRecentMS": 0,       // 防循环
      "decayMode": "weibull"      // 或 "logistic"
    },

    // 时区
    "tz": "Asia/Shanghai",

    // 向量搜索（可选）
    "embedding": {
      "enabled": false,
      "provider": "openai",
      "baseUrl": "",
      "apiKey": "",
      "model": "",
      "dimensions": 1024,
      "recallTimeoutMs": 5000,
      "captureTimeoutMs": 10000
    },

    // LLM 管线（Full 模式）
    "llm": {
      "enabled": true,
      "apiKey": "",
      "baseUrl": "https://api.deepseek.com",
      "model": "deepseek-chat"
    },

    // 自动清理
    "cleanup": {
      "enabled": true,
      "l0l1RetentionDays": 30,
      "allowAggressiveCleanup": false
    },

    // 排除的 session 标签
    "blockLabels": [],

    // 多模态
    "autoSaveImage": false,

    // 云备份
    "cloud": {
      "enabled": true,
      "autoSync": false,
      "conflictPolicy": "newer",
      "excludePatterns": []
    }
  }
}
```

### 云备份凭证

存储在 `~/.openclaw/credentials/secrets.env`：

| 协议 | 环境变量 |
|------|----------|
| **WebDAV** | `WEBDAV_URL`, `WEBDAV_USERNAME`, `WEBDAV_PASSWORD` |
| **S3** | `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `S3_REGION` |
| **SFTP** | `SFTP_HOST`, `SFTP_PORT`, `SFTP_USERNAME`, `SFTP_PASSWORD` |
| **Samba** | `SAMBA_HOST`, `SAMBA_USER`, `SAMBA_PASSWORD`, `SAMBA_SHARE`, `SAMBA_PORT` |

---

## 数据存储

| 路径 | 格式 | 说明 |
|------|------|------|
| `memory/YYYY-MM-DD.md` | Markdown | 每日对话日志 |
| `memory/.yaoyao.db` | SQLite | FTS5 + sqlite-vec 索引 |
| `memory/scene_blocks/` | Markdown | 场景分组数据 |
| `memory/refs/` | Markdown | Mermaid Canvas 上下文卸载 |
| `memory/.backups/` | 目录 | 时间戳快照（全量/增量） |
| `memory/.archive/` | 目录 | 已清理的旧日志 |
| `memory/.metadata/manifest.json` | JSON | 版本/安装/种子历史 |
| `memory/.write-fallback.jsonl` | JSONL | 写入失败 fallback |

> 💡 `persona.md` / `.feedback.jsonl` / `.pipeline/` 在 v1.5.0+ 已由 [yaoyao-soul](https://github.com/taobaoaz/yaoyao-soul) 插件接管。

---

## 特性亮点

- **🧬 SRMU 记忆反传播 (v1.7.8)** — RelevanceGate 四维评分 + SemanticShiftDetector 主题漂移 + MemoryBackprop 交叉关系发现，三层守卫提升记忆质量
- **🧬 MemGAS 多粒度记忆 (v1.7.4)** — GMM 聚类关联 + 熵路由自适应 + 3 层搜索粒度，检索精度显著提升
- **⚡ SkVM 智能缓存 (v1.7.4)** — 工具调用缓存 + 分层 TTL + 短路由，冗余调用最多降低 40%
- **🔄 系统架构感知 (v1.7.4)** — 自动检测 OpenClaw 环境，支持与 claw-core 等记忆系统共存
- **📊 结构化日志 (v1.7.4)** — requestId + duration + outcome，可聚合、可审计
- **中文友好** — FTS5 无法匹配 CJK 时自动降级 LIKE + bigram
- **双模式运行** — `brainMode: "lite"` 零依赖 / `"full"` LLM 增强
- **环境自适应** — 自动探测 FTS5/向量/LLM/云同步能力，优雅降级
- **记忆接管** — 一键导入 OC 原生记忆、workspace 文件、旧 daily md
- **心情环** — Ekman 6 基本情绪分析，多语言 + emoji 降级
- **安全加固** — 文件权限收紧、路径遍历防护、SSRF 黑名单、API Key 脱敏
- **防御性降级** — DB 层叠 fallback（node:sqlite → better-sqlite3 → file-db）
- **云备份** — WebDAV/S3/SFTP/Samba 多云同步
- **趋势分析** — 话题频率变化趋势洞察
- **反遗忘** — 检测重要记忆遗忘风险，主动提醒
- **防幻觉** — 自动标记推测性 AI 输出与用户纠正，提供 `memory_verify` 工具
- **Mermaid Canvas** — 长工具日志符号化卸载，节省 token
- **极小依赖** — 仅 sqlite-vec（node:sqlite 内置），无 Python 无额外运行时
- **698 测试全绿** — 原生运行，TypeScript 严格模式零错误

> 💡 **心理学模型**（PersonaStateMachine、情绪追踪、L4 反馈学习）在 v1.5.0+ 已拆分为独立插件 [yaoyao-soul](https://github.com/taobaoaz/yaoyao-soul)。

---

## 防幻觉机制

### 1. 自动标记（Auto-Capture 环节）

| 信号 | 检测规则 | 日志标记 |
|------|----------|----------|
| **推测性输出** | 命中 "可能/也许/I think/maybe" 等 30+ 推测词 | `[⚠️ 推测性]` |
| **用户纠正** | 命中 "不对/错了/no/wrong" 等 20+ 纠正词 | `[🚫 用户纠正]` |

### 2. 主动验证（`memory_verify` 工具）

```json
{ "claim": "用户上周提到在用 Next.js" }
```

| 结果 | 含义 |
|------|------|
| **confirmed** ✅ | 记忆中有明确支持 |
| **partial** 🟡 | 部分相关，不完全匹配 |
| **unconfirmed** ❓ | 无相关记录 |
| **contradicted** ⚠️ | 有相反记录 |

### 3. 为什么不做 "幻觉过滤"

1. **上下文价值** — 即使推测是错的，用户后续的纠正本身是高价值记忆
2. **自证价值** — 推测被纠正的过程比结果更重要
3. **标记优于删除** — `[⚠️ 推测性]` 让后续搜索时自然降权

**原则**：yaoyao-memory 是记忆的**档案员**，不是**审查官**。标记风险，但不替用户决定什么值得记住。

---

## 已知限制与路线图

### 1. 跨设备同步（当前：单向云备份 → 目标：双向增量同步）

**现状**：`memory_cloud_sync` 是**云备份**，不是真正的同步。建议**单设备写入，其他设备只读**。

**计划**：P2 — v2.x 可能引入基于操作日志（oplog）的同步层。

### 2. 隐私加密（当前：明文存储 + 权限隔离 → 目标：Gateway 级透明加密）

**现状**：
- 文件权限 `0o700`/`0o600`
- 传输加密 HTTPS/SFTP/TLS
- SSRF 防护 + 密钥脱敏

**建议**：全盘加密（BitLocker/FileVault/LUKS）+ 云备份加密（S3 SSE/SFTP over TLS）

**计划**：P1 — 等待 OpenClaw SDK 暴露 `getMachineKey()` 接口。

### 3. 多进程并发写入

SQLite 有 WAL 模式，单进程写入安全。网络挂载上的并发不可靠。

### 4. MemGAS 聚类增量学习（P2 — v1.8.x）

- GMM 聚类标签集成到所有搜索通道（当前仅 `memory-call-search`）
- 重复度 > 30% → 自动触发 `memory_unify dedup`
- 高 importance 记忆 30 天未召回 → 自动提升索引权重

### 5. SRMU 反传播动作化（P2 — v1.8.x）

- MemoryBackprop 检测到的关系自动触发标签更新（supersedes 标记旧记忆、reinforces 提升置信度）
- SemanticShiftDetector 漂移事件接入定时 flush 管道
- 反传播结果写入检索 trace，支持审计

### 5. SkVM JIT 固化（P2 — v1.8.x）

- 基于模式检测结果自动生成固化执行计划
- 跨会话模式持续学习
- 减少工具调用链的 token 消耗

### 6. 多设备分布式写入 + 集中整理（P3）

各设备只上传 `memory/*.md`，中央节点定期 `rclone sync` + `memory_import` 批量导入。

---

## 系统要求

- **OpenClaw** >= 2026.5.6
- **Node.js** >= 22（原生 `node:sqlite` 支持）
- 可选：embedding API key 用于向量搜索 + MemGAS 多粒度路由
- 可选：LLM API key 用于 Full 模式（未配置时自动复用 embedding 的 key）

### v1.7.8 SRMU 模块激活条件

| 模块 | 激活条件 | 降级行为 |
|------|----------|----------|
| RelevanceGate | 自动激活（零依赖） | — |
| SemanticShiftDetector | 自动激活（零依赖） | — |
| MemoryBackprop | 自动激活（零依赖） | — |

### v1.7.4 论文模块激活条件

| 模块 | 激活条件 | 降级行为 |
|------|----------|----------|
| GMM 聚类标记 | 自动激活（零依赖） | — |
| 熵路由 | embedding 已启用 | 回退默认搜索参数 |
| 多粒度分层 | embedding 已启用 | 回退单层搜索 |
| 聚类扩展 | embedding 已启用 | 回退纯向量搜索 |
| 工具缓存 | 自动激活 | 每 hook LRU 兜底 |
| 分层 TTL | 工具缓存激活 | 统一 TTL |
| 短路由 | 自动激活 | 正常执行 |

### 常见安装问题

| 问题 | 原因 | 解决 |
|------|------|------|
| 启动无横幅 | `plugins.allow` 缺少插件名 | 添加 `"yaoyao-memory"` |
| `Cannot find module` | OpenClaw 版本太低 | 升级 >= 2026.5.6 |
| `node:sqlite` 报错 | Node.js 版本太低 | 升级 >= 22 |
| 向量搜索不可用 | 未配置 embedding | 自动降级为 FTS5 |
| 与 Active Memory 冲突 | 两者都在 `before_prompt_build` 注入 | 禁用 Active Memory |
| 记忆重复注入 | 内置记忆和 yaoyao 都在召回 | 只启用一个记忆系统 |

### 兼容性

| 系统 | 兼容性 | 说明 |
|------|--------|------|
| **Active Memory** | ⚠️ 冲突 | 同时启用会导致重复注入，建议禁用 |
| **Memory Core** | ✅ 兼容 | 独立索引，不干扰 |
| **Memory LanceDB** | ✅ 兼容 | 独立 sqlite-vec，可同时启用 |
