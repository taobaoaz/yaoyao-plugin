# Yaoyao Memory Plugin v1.5.1-beta1

🎲 搭载摇摇记忆引擎的四层记忆系统 — 让 AI 拥有真正的长时记忆。

**25+ 工具 · 2 个 Hook · FTS5 + sqlite-vec 混合搜索 · 情感分析 · 环境自适应 · 记忆接管 · 趋势分析 · 质量评估 · 云备份 · 反遗忘 · 防幻觉 · 417+ 单元测试**

> 📋 安装时看到 Moderation 标记？请阅读 [SECURITY.md](./SECURITY.md) — 所有标记均有合理解释。

> ⚠️ **从 v1.4.x 升级？** 架构已拆分（记忆存取 vs 情绪观察），**数据 100% 保留**。阅读 [MIGRATION.md](./MIGRATION.md) 获取一键迁移脚本和详细步骤。

---

## 架构

```
L0 — 每日对话日志        (memory/YYYY-MM-DD.md)     ← 自动捕获 (agent_end)
L1 — 结构化记忆索引      (.yaoyao.db FTS5 + vec)      ← 混合搜索 (before_prompt_build)
L2 — 场景分组            (scene_blocks/)              ← 关联图谱 + Memory Compactor
L3 — 用户画像            (persona.md / preference slots) ← L1 提取器
L4 — 记忆质量评估        (memory_quality / trends)    ← 纯统计，无需 LLM
```

> 💡 v1.4.x 中的 **心理学模型**（PersonaStateMachine、情绪追踪、L4 反馈学习）已拆分为独立插件 [yaoyao-soul](https://github.com/taobaoaz/yaoyao-soul)。安装后可与本插件协同工作。

---

## 双模式：Lite vs Full

yaoyao-memory 支持两种运行模式，**用户通过 `brainMode` 配置自行选择**：

| 模式 | 依赖 | 功能 |
|------|------|------|
| **Lite**（默认） | 零外部依赖 | 纯本地：FTS5 搜索、正则启发式提取、Jaccard 去重、时间衰减 |
| **Full** | 需要 LLM API | LLM 增强：L1 原子事实提取、Mermaid Canvas 符号化、高质量用户画像 |

```json5
{
  "brainMode": "lite"  // 或 "full"
}
```

---

## 工具 (25+ 个)

| 工具 | 用途 |
|------|------|
| `memory_search` | 🔍 FTS5 全文搜索 + CJK 模糊降级，支持中文、英文、混合查询 |
| `memory_get` | 📖 读取指定记忆文件 |
| `memory_list` | 📋 列出所有记忆文件（含类型、日期、大小信息） |
| `memory_save` | 💾 手动记录一条记忆（tags 参数支持分类标记） |
| `memory_stats` | 📊 记忆统计（支持 text/json 格式，basic/full 详细程度） |
| `memory_mood` | 🎨 分析情绪趋势 — Ekman 6 基本情绪分析 + 心情环可视化 |
| `memory_timeline` | 📅 时间线热力图 |
| `memory_search_timeline` | 🔍📅 搜索 + 时间轴分组 |
| `memory_backup` | 📦 创建快照备份（全量 / 增量） |
| `memory_forget` | 🗑️ 按关键词或日期删除（⚠️ 不可恢复） |
| `memory_note` | 📌 快捷笔记 — 轻量存储，适合临时想法 |
| `memory_graph` | 🕸️ 记忆关联图谱 — 多维度关联（标签/场景/时间/语义） |
| `memory_search_enhanced` | 🔍📈 语义搜索增强 — 向量重排序 + 关键词高亮 + 混合加权 |
| `memory_export` | 📤 记忆导出 — JSONL 格式，支持跨设备迁移 |
| `memory_import` | 📥 记忆导入 — JSONL 格式 + 目录批量导入 md 文件 |
| `memory_tag` | 🏷️ 记忆标签 — 打标签、按标签搜索、热门标签 |
| `memory_remind` | ⏰ 记忆定时提醒 — 生成完整 cron 配置 JSON |
| `memory_recommend` | 🎯 记忆推荐 — 基于上下文 + 日期多样性 + 时间衰减 |
| `memory_trends` | 📈 趋势分析 — 话题频率变化趋势（无需 LLM，纯统计） |
| `memory_quality` | ✅ 质量评估 — 记忆健康度、重复度、覆盖率多维评估 |
| `memory_cloud_sync` | ☁️ 云备份同步 — WebDAV/S3/SFTP/Samba 多协议 |
| `memory_unify` | 🔗 统一记忆管理 — 跨后端搜索/去重/统计 |
| `memory_import_oc` | 📦 OC chunks 导入 — 从 OpenClaw 原生记忆增量导入 |
| `memory_import_workspace` | 📂 Workspace 导入 — 导入 MEMORY.md/USER.md 等文件 |
| `memory_retain` | 🧠 记忆反遗忘 — 检测重要但长期未召回的活跃记忆 |
| `memory_verify` | 🔍✅ 防幻觉验证 — 核实 AI 说法是否与记忆一致 |

---

## Hook (2 个)

| Hook | 触发时机 | 作用 |
|------|----------|------|
| `agent_end` | 每次对话结束 | 自动捕获 → L0 日志 + FTS5 索引 + L1 提取（可选） |
| `before_prompt_build` | 每次对话开始 | 召回相关记忆 → 注入上下文（支持 append/prepend 两种位置） |

---

## 🆕 v1.5.1-beta1 新增亮点

### Brain v1.1.0 全量移植（28 项零依赖设计）

从 CortexReach/memory-lancedb-pro v1.1.0-beta.10 完整移植：

| 模块 | 功能 |
|------|------|
| **Adaptive Retrieval** | 智能跳过问候/命令/心跳，节省 API 调用 |
| **Noise Filter** | 过滤 denials、meta-questions、boilerplate |
| **Query Expander** | 口语词 → 技术词映射（如 "npm" → "package manager"） |
| **Retrieval Trace** | 完整检索链路追踪，可审计 |
| **Temporal Classifier** | 静态事实 vs 动态事件自动分类 |
| **Retrieval Stats** | 聚合查询指标，性能监控 |
| **Length Normalization** | 短记忆长度归一化，防长文本垄断 |
| **Importance Weighting** | 基于重要性的搜索加权 |
| **Access Tracker** | 访问计数 + 自动 tier 晋升 |
| **Auto-Recall Tier 1** | 最小召回单元，避免信息过载 |
| **Support Info V2** | 置信度徽章 `[置信度85%]` |
| **Confidence Scorer** | ROUGE-Like F1 计算记忆-查询匹配度 |
| **Chunker** | 长回复 >4000 字符自动分块索引 |
| **Session Compressor** | 长会话压缩为高信号回合 |
| **Intent Analyzer** | 意图分类 + 类别 boost |
| **Memory Compactor** | 渐进式摘要合并相似记忆 |
| **Self-Improvement Log** | 错误自动记录供后续分析 |
| **Memory Categories** | 6 类分类（profile/preferences/entities/events/cases/patterns） |
| **Preference Slots** | 品牌-物品偏好结构化提取 |
| **Tier Manager** | 三层晋升/降级：core → working → peripheral |
| **Batch Dedup** | 批量去重（trigram Jaccard + Levenshtein） |
| **Auto Capture Cleanup** | 自动清理 conversation info、@mentions |
| **Reflection Ranking** | logistic / weibull 衰减评分 |
| **Reflection Retry** | 智能错误分类重试（transient vs permanent） |
| **Session Recovery** | 跨会话上下文恢复 |
| **Scope Manager** | 多 agent 记忆隔离 |
| **Identity Addressing** | 检测用户称呼偏好 |
| **Memory Upgrader** | 首句提取 + L0/L1/L2 摘要 |

### 腾讯方案设计移植（10 项）

从 TencentDB-Agent-Memory 提取的零依赖设计：

| 配置 | 说明 |
|------|------|
| `recall.position` | `prepend` = 召回放用户消息前，prompt cache 更友好 |
| `recall.timeoutMs` | 召回超时自动跳过，不阻塞对话 |
| `capture.excludeAgents` | Glob 排除特定 agent（如 `bench-*`） |
| `capture.enableWarmup` | 新 session 指数退避 1→2→4→8 轮捕获 |
| `capture.everyNConversations` | 固定间隔捕获 |
| `capture.excludePatterns` | 正则排除特定内容 |
| `capture.enableDedup` | 写入前批量去重开关 + 可调阈值 |
| `recall.hintText` | 召回提示文案可配置 |
| `recall.minResults` | 召回结果太少时 fallback 到最近记忆 |
| `recall.maxChars` | 限制注入总长度，防 token 爆炸 |

### LLM 增强功能（Full 模式）

| 模块 | Lite | Full |
|------|------|------|
| **L1 Extractor** | 正则启发式（identity/preference/task/correction） | LLM JSON 提取 + 置信度评分 |
| **Mermaid Canvas** | 正则解析工具调用生成 Mermaid 图 | 未来：LLM 生成更精确的流程图 |

---

## 安全加固（P0/P1）

- **文件权限收紧** — memory 目录 `0o700`，DB/日志文件 `0o600`
- **路径遍历防护** — `memoryDir` 禁止 `..` 和相对路径
- **API Key 脱敏** — 日志中自动掩码 `***`
- **SSRF 防护** — 禁止访问 localhost/内网地址
- **FTS5 安全边界** — 参数化查询，语法清洗防 crash

---

## 测试

**417+ 单元测试 · 全原生运行 · 仅 sqlite-vec（外部 npm 依赖）**

覆盖 30+ 测试模块：情感分析、存储读写、session 过滤、FTS5/向量/混合搜索、导入导出、标签、图谱、增强搜索、质量评估、趋势分析、cron 提醒、反遗忘、防幻觉、L1 提取、Mermaid Canvas、glob 匹配等。

运行：`npm test`

---

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

---

## 🚀 快速开始

### 从旧版本升级（v1.4.x → v1.5.1-beta1）

```bash
cd ~/.openclaw/extensions/yaoyao-memory
git pull origin main
# 然后阅读 [MIGRATION.md](./MIGRATION.md) 完成配置更新
```

**数据完全保留**，只需更新代码 + 调整配置。

---

### 全新安装：ClawHub（推荐）

```bash
openclaw plugins install yaoyao-memory
```

安装后，在 `openclaw.json` 中添加插件配置：

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

> ⚠️ **必须** 在 `plugins.allow` 中添加 `"yaoyao-memory"`，否则插件不会加载。

### 方式二：从 GitHub 手动安装

```bash
git clone https://github.com/taobaoaz/yaoyao-plugin.git
cp -r yaoyao-plugin ~/.openclaw/extensions/yaoyao-memory
```

然后在 `openclaw.json` 中添加上述配置。重启 Gateway 生效：

```bash
openclaw gateway restart
```

### 验证安装

启动后查看终端输出，应看到：
```
🎲 ══════════════════════════════════════════
🎲    摇摇 · 记忆引擎已启动
🎲    v1.5.1-beta1  ·  25+ Tools  ·  2 Hooks
🎲 能力: FTS5✅ Vec✅ LLM⚪ Cloud⚪
```

如果看不到横幅，检查 `plugins.allow` 是否包含 `"yaoyao-memory"`。

---

## 配置

```json5
{
  "enabled": true,
  "config": {
    // ===== 核心模式 =====
    "brainMode": "lite",  // "lite" = 纯本地, "full" = 启用 LLM

    // L0 自动捕获
    "capture": {
      "enabled": true,
      // 腾讯方案：排除特定 agent
      "excludeAgents": [],
      // 腾讯方案：warmup 模式（指数退避捕获）
      "enableWarmup": false,
      // 腾讯方案：固定间隔捕获
      "everyNConversations": 0,
      // 腾讯方案：正则排除模式
      "excludePatterns": [],
      // 批量去重开关
      "enableDedup": true,
      "dedupThreshold": 0.92,
      "dedupLookback": 5,
      // LLM 功能开关
      "enableL1": false,
      "enableContextOffload": false,
      "offloadThreshold": 4000
    },

    // L1 自动召回
    "recall": {
      "enabled": true,
      "maxResults": 3,
      // 腾讯方案：召回位置
      "position": "append",  // "prepend" = 用户消息前（cache-friendly）
      // 腾讯方案：超时降级
      "timeoutMs": 5000,
      // 腾讯方案：最少结果数
      "minResults": 0,
      // 腾讯方案：最大注入长度
      "maxChars": 0,
      // 腾讯方案：自定义提示文案
      "hintText": "",
      // 排除最近写入的记忆（防循环）
      "excludeRecentMS": 0,
      // 衰减模式
      "decayMode": "weibull"  // 或 "logistic"
    },

    // 时区配置
    "tz": "Asia/Shanghai",

    // 向量搜索（可选）
    "embedding": {
      "enabled": false,
      "provider": "openai",
      "baseUrl": "",
      "apiKey": "",
      "model": "",
      "dimensions": 1024
    },

    // LLM 管线（Full 模式需要）
    // 💡 如已配置 embedding，LLM 会自动复用 embedding 的 apiKey/baseUrl
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

    // 多模态记忆
    "autoSaveImage": false,

    // 云备份同步
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

存储在 `~/.openclaw/credentials/secrets.env`，支持以下协议：

| 协议 | 环境变量 |
|------|----------|
| **WebDAV** (坚果云/Nextcloud) | `WEBDAV_URL`, `WEBDAV_USERNAME`, `WEBDAV_PASSWORD` |
| **S3** (AWS/OSS) | `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `S3_REGION` |
| **SFTP** | `SFTP_HOST`, `SFTP_PORT`, `SFTP_USERNAME`, `SFTP_PASSWORD` |
| **Samba/NAS** | `SAMBA_HOST`, `SAMBA_USER`, `SAMBA_PASSWORD`, `SAMBA_SHARE`, `SAMBA_PORT` |

---

## 数据存储

| 路径 | 格式 |
|------|------|
| `memory/YYYY-MM-DD.md` | 每日对话日志 |
| `memory/.yaoyao.db` | FTS5 + sqlite-vec 索引 |
| `memory/.backups/` | 时间戳快照备份（全量/增量） |
| `memory/.backups/.last-backup.json` | 增量备份时间戳标记 |
| `memory/scene_blocks/` | 场景分组数据 |
| `memory/refs/` | Mermaid Canvas 上下文卸载文件 |
| `memory/.archive/` | 已清理的旧日志 |
| `memory/.sync-source` | 云同步来源标记 |
| `memory/.write-fallback.jsonl` | 写入失败 fallback 记录（自动恢复） |

> 💡 `persona.md` / `.feedback.jsonl` / `.pipeline/` 在 v1.5.0+ 已由 [yaoyao-soul](https://github.com/taobaoaz/yaoyao-soul) 插件接管，本插件保留这些文件作为只读/兼容用途。

---

## 特性

- **中文友好** — FTS5 无法匹配 CJK 时自动降级 LIKE + bigram 搜索
- **双模式运行** — `brainMode: "lite"` 零依赖 / `"full"` LLM 增强
- **环境自适应** — 自动探测 FTS5/向量/LLM/云同步能力，优雅降级
- **记忆接管** — 一键导入 OC 原生记忆、workspace 文件、旧 daily md
- **心情环** — 情感分析引擎，多语言支持（中/英/日/韩 + emoji 降级）
- **安全加固** — 文件权限收紧、路径遍历防护、SSRF 黑名单、API Key 脱敏
- **防御性降级** — DB 层叠 fallback（node:sqlite → better-sqlite3 → file-db）
- **云备份** — WebDAV/S3/SFTP/Samba 多云同步
- **趋势分析** — 话题频率变化趋势洞察
- **反遗忘** — 检测重要记忆遗忘风险，主动提醒
- **防幻觉** — 自动标记推测性 AI 输出与用户纠正，提供 `memory_verify` 工具
- **Mermaid Canvas** — 长工具日志符号化卸载，节省 token
- **极小依赖** — 仅 sqlite-vec（node:sqlite 内置），无 Python 无额外运行时
- **417+ 测试全绿** — 原生运行

> 💡 **心理学模型**（PersonaStateMachine、情绪追踪、L4 反馈学习）在 v1.5.0+ 已拆分为独立插件 [yaoyao-soul](https://github.com/taobaoaz/yaoyao-soul)。安装后可与本插件协同工作。

---

## 🔍 防幻觉机制

yaoyao-memory 在存储和验证两个环节提供防幻觉能力，**无需 LLM 调用，纯本地规则实现**。

### 1. 自动标记（Auto-Capture 环节）

每次 `agent_end` 写入 L0 日志时，自动检测两类信号：

| 信号 | 检测规则 | 日志标记 |
|------|----------|----------|
| **推测性输出** | 命中 "可能/也许/我觉得/I think/maybe" 等 30+ 个中英文推测词 | `[⚠️ 推测性: 可能, 也许]` |
| **用户纠正** | 命中 "不对/错了/不是/no/wrong" 等 20+ 个纠正词 | `[🚫 用户纠正]` |

### 2. 主动验证（`memory_verify` 工具）

当 AI 想声称 "我记得你说过..." 时，应该先调用 `memory_verify` 核实：

```json
{ "claim": "用户上周提到在用 Next.js" }
```

返回四种 verdict：

| 结果 | 含义 |
|------|------|
| **confirmed** ✅ | 记忆中有明确支持 |
| **partial** 🟡 | 记忆中有部分相关，但不完全匹配 |
| **unconfirmed** ❓ | 记忆中无相关记录 |
| **contradicted** ⚠️ | 记忆中有相反记录 |

### 3. 为什么不做 "幻觉过滤"

常见建议是 "检测到推测内容就不存入记忆"，但 yaoyao-memory **不这样做**：

1. **上下文价值** — 即使 AI 的推测是错的，用户后续的纠正本身是高价值记忆
2. **自证价值** — AI 的推测被纠正的过程，比结果更重要
3. **标记优于删除** — `[⚠️ 推测性]` 标记让后续搜索时自然降低权重

**原则**：yaoyao-memory 是记忆的**档案员**，不是**审查官**。标记风险，但不替用户决定什么值得记住。

---

## 已知限制与路线图

### 1. 跨设备同步（当前：单向云备份 → 目标：双向增量同步）

**现状**：`memory_cloud_sync` 是**云备份**，不是真正的同步。本质是单向 push/pull。

**建议用法**：
- **单设备写入，其他设备只读** — 用一台机器作为"主节点"
- **避免并发写** — 不要同时在两台活跃设备上让 AI 写入记忆

**计划**：P2 — v2.x 可能引入基于**操作日志（oplog）**的同步层。

### 2. 隐私加密（当前：明文存储 + 权限隔离 → 目标：Gateway 级透明加密）

**现状（已做的）**：
- 文件权限：`memory/` 目录 `0o700`，文件 `0o600`
- 传输加密：HTTPS/SFTP/TLS
- SSRF 防护：禁止内网地址
- 配置脱敏：日志中 `apiKey` 自动掩码

**为什么不自己做磁盘加密**：

1. **搜索与加密互斥** — FTS5 查询前必须解密整个数据库，延迟从毫秒变数百毫秒
2. **密钥管理地狱** — passphrase 丢失 = 全部记忆永久不可恢复
3. **安全幻觉** — 即使加密原始文本，FTS5 索引仍是明文，敌人从索引就能重建关键词画像

**建议（现在就能做的）**：
- **全盘加密** — BitLocker/FileVault/LUKS
- **加密文件系统挂载** — VeraCrypt/APFS 加密分区
- **云备份加密** — S3 SSE/SFTP over TLS

**计划**：P1 — 等待 OpenClaw SDK 暴露 `getMachineKey()` 接口。

### 3. 多进程并发写入（当前：单进程安全 → 多进程未验证）

SQLite 有 WAL 模式，单进程写入安全。网络挂载（NFS/Samba）上的并发不可靠。

**计划**：P3 — 文档中明确声明"不建议多进程并发写同一 DB"。

### 4. 增量学习闭环（当前：诊断有，自动调整无 → 目标：自优化）

**计划**：P2 — v1.6.x 引入轻量闭环：
- 重复度 > 30% → 自动触发 `memory_unify dedup`
- 某记忆 30 天未召回且 importance 高 → 自动提升索引权重
- `memory_trends` 检测到话题激增 → 自动打 `[trending]` 标签

### 5. 多设备分布式写入 + 集中整理

**需求**：多台设备各自产生记忆，由一台"中央节点"统一整理。

**最小可行方案**：
1. 各设备只上传 `memory/*.md`（排除 `.yaoyao.db`）
2. 云端按设备分区存储
3. 中央节点定期 `rclone sync` + `memory_import` 批量导入
4. 中央节点维护统一的 `.yaoyao.db`

**计划**：P3 — 可能提供 `memory_sync --mode=md-only` 和 `memory_import --device-prefix=xxx`。

---

## 系统要求

- **OpenClaw** >= 2026.5.5（`openclaw --version` 查看）
- **Node.js** >= 22（原生 `node:sqlite` 支持，`node --version` 查看）
- 可选：embedding API key 用于向量搜索
- 可选：LLM API key 用于 Full 模式（未配置时自动复用 embedding 的 key）

### 常见安装问题

| 问题 | 原因 | 解决 |
|------|------|------|
| 启动无横幅 | `plugins.allow` 缺少插件名 | 在 `openclaw.json` 的 `plugins.allow` 中添加 `"yaoyao-memory"` |
| `Cannot find module` | OpenClaw 版本太低 | 升级到 >= 2026.5.5 |
| `node:sqlite` 报错 | Node.js 版本太低 | 升级到 Node.js >= 22 |
| 向量搜索不可用 | 未配置 embedding | 插件自动降级为 FTS5，不影响基本功能 |
| 与 Active Memory 冲突 | 两者都在 `before_prompt_build` 注入记忆 | 禁用内置 Active Memory：`openclaw plugins disable active-memory` |
| 记忆重复注入 | 内置记忆和 yaoyao 都在召回 | 确保只启用一个记忆召回系统 |

### 兼容性

| OpenClaw 内置系统 | 兼容性 | 说明 |
|-------------------|--------|------|
| **Active Memory** | ⚠️ 冲突 | 两者都在 `before_prompt_build` 注入 context，同时启用会导致重复/冲突。**建议禁用 Active Memory** |
| **Memory Core** (文件记忆) | ✅ 兼容 | yaoyao 使用独立的 `.yaoyao.db` 索引，不干扰文件记忆 |
| **Memory LanceDB** (向量记忆) | ✅ 兼容 | yaoyao 使用独立的 sqlite-vec，可同时启用 |
