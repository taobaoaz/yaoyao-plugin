# Yaoyao Memory Plugin v1.5.1

🎲 搭载摇摇记忆引擎的四层记忆系统 — 让 AI 拥有真正的长时记忆。

**25 个工具 · 2 个 Hook · FTS5 + sqlite-vec 混合搜索 · 情感分析 · 环境自适应 · 记忆接管 · 趋势分析 · 质量评估 · 云备份 · 反遗忘 · 防幻觉 · 187+ 单元测试**

> 📋 安装时看到 Moderation 标记？请阅读 [SECURITY.md](./SECURITY.md) — 所有标记均有合理解释。

> ⚠️ **从 v1.4.x 升级？** 架构已拆分（记忆存取 vs 情绪观察），**数据 100% 保留**。阅读 [MIGRATION.md](./MIGRATION.md) 获取一键迁移脚本和详细步骤。

---

## 架构

```
L0 — 每日对话日志        (memory/YYYY-MM-DD.md)     ← 自动捕获 (agent_end)
L1 — 结构化记忆索引      (.yaoyao.db FTS5 + vec)    ← 混合搜索 (before_prompt_build)
L2 — 场景分组            (scene_blocks/)             ← 关联图谱
L3 — 记忆质量评估        (memory_quality / trends)   ← 纯统计，无需 LLM
```

> 💡 v1.4.x 中的 **心理学模型**（PersonaStateMachine、情绪追踪、L4 反馈学习）已拆分为独立插件 [yaoyao-soul](https://github.com/taobaoaz/yaoyao-soul)。安装后可与本插件协同工作。

## 工具 (25 个)

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
| `memory_verify` | 🔍✅ 防幻觉验证 — 核实 AI 说法是否与记忆一致，返回 confirmed/partial/unconfirmed/contradicted |

## Hook (2 个)

| Hook | 触发时机 | 作用 |
|------|----------|------|
| `agent_end` | 每次对话结束 | 自动捕获对话内容写入 L0 每日日志 + FTS5 索引 |
| `before_prompt_build` | 每次对话开始 | 自动从 L1 索引召回相关记忆注入上下文 |

---

## 🆕 v1.5.1 修复亮点

### 安全加固（P0/P1）
- **文件权限收紧** — memory 目录 `0o700`（仅 owner 可访问），DB/日志文件 `0o600`
- **路径遍历防护** — `memoryDir` 配置禁止 `..` 和相对路径，防止文件系统越界
- **API Key 脱敏** — 日志中所有 `apiKey`/`token`/`password` 自动掩码（`***` 格式），防止凭证泄露
- **SSRF 防护** — embedding/LLM 请求禁止访问 localhost/127.0.0.1/192.168/10.x/172.x 等内网地址
- **供应链攻击面归零** — v1.4.x 迁移检测不再自动 `git clone` 远程代码，改为仅提示手动安装
- **FTS5 安全边界** — 明确 `sanitizeFTSQuery` 为语法清洗（防 FTS5 语法错误），非 SQL 注入防御；所有 SQL 均使用参数化查询

### 防御性编程加固（Phase 11）
- **DB 层叠降级** — `node:sqlite` 崩溃 → `better-sqlite3` 顶 → 也崩溃 → `file-db` 纯文件兜底
- **网络故障隔离** — embedding/LLM fetch 失败不阻断主流程，自动降级到纯 FTS5 搜索
- **类型系统 100% 严格** — 消灭全部 114+ 处 `any`，`catch (e: any)` → `catch (e: unknown)`

### 数据一致性
- **向量残留清理** — `deleteByDate`/`deleteByKeyword` 自动清理孤儿向量
- **余弦公式修正** — `1 - distance/2` 正确映射 L2 → cosine
- **时间衰减修复** — 使用 `r.date` 字段而非失效的 filename 解析
- **向量状态真实** — `getStats()` 不再硬编码 `vecEnabled: true`

### 连接与资源
- **DB 连接复用** — 所有工具共享 DBBridge 连接，不再各自 `new DatabaseSync()`
- **Session LRU** — auto-recall 的 sessionContext 和 resultCache 带上限和自动清理
- **LLM 超时** — 所有 fetch 调用添加 30s AbortController 超时

### 稳定性


### 环境自适应能力

插件会自动探测当前运行环境的能力边界，在 banner 中展示能力矩阵：

```
🎲 能力: FTS5✅ Vec✅ LLM✅ Cloud⚪
```

- **能力矩阵 banner** — 启动时探测 FTS5/向量/LLM/云同步可用性
- **工具描述动态调整** — 无向量时 `search_enhanced` 自动切换为"关键词高亮"，不误导用户
- **Pipeline 条件注册** — 无 LLM 时跳过 L1/L2/L3 管线，输出明确日志
- **API 兼容层** — 检测 hooks 是否可用，不支持时降级为 tool-only 模式

### 原始记忆环境接管

安装 yaoyao-memory 后，可以一键接管已有的记忆数据源：

- **`memory_import_oc`** — 从 OpenClaw 原生 `main.sqlite` 增量导入 chunks（只读源 DB，内容哈希去重，支持 dryRun 预览）
- **`memory_import_workspace`** — 扫描 MEMORY.md/USER.md/SOUL.md 等 workspace 文件，按 `##` 标题分段导入索引
- **旧 daily md 兼容** — 自动检测非 yaoyao 格式文件，插入迁移分隔符，保留原有内容不被破坏
- **首次启动检测** — 自动扫描可接管数据源（OC chunks / workspace / 未索引 daily md），输出提示
- **`memory_unify status` 接管面板** — 一目了然哪些数据源已导入

### 搜索质量提升

- **CJK bigram 搜索** — FTS5 miss 后增加 bigram 拆分搜索，中文短语召回率显著改善
- **importance 加成** — `[important]` 标记的记忆搜索得分 ×1.3
- **双路搜索合并** — 关键词搜索 + 原文补充搜索，合并去重后返回
- **向量重排序优化** — 从 N+1 次 embed 改为 1 次 vectorSearch + 加权合并（FTS5 0.6 + Vec 0.4）
- **搜索策略自适应** — <50 条数据放宽搜索，>5000 条收紧精准度

### 质量与趋势

- **`memory_quality`** — 多维记忆健康度评估（FTS5 覆盖率、重复度、DB 完整性）
- **`memory_trends`** — 纯统计话题频率趋势分析，无需 LLM 即可洞察变化
- **`memory_cloud_sync`** — 多云备份同步，支持 WebDAV/S3/SFTP/Samba，凭证安全分离

### 稳定性增强

- **Embedding 熔断器** — 连续 3 次失败开启，60 秒冷却，避免 API 故障拖累响应
- **工具执行超时** — 10s Promise.race 保护，单个工具卡住不影响整体
- **Embedding 超时降低** — 15s → 8s
- **auto-capture 写入节流** — 2 秒缓冲窗口，多条消息合并写入
- **FTS5 完整性检查** — 启动时 meta/fts 行数差异 >10% 自动 rebuild
- **DB 连接泄漏防护** — 引用计数 + WAL checkpoint 刷盘
- **文件写入安全** — 原子写（tmp+rename），失败自动 fallback 到 `.write-fallback.jsonl`
- **WAL 清理增强** — 启动检测 WAL >10MB 主动 checkpoint
- **Embedding 维度自适应** — 启动时 probe 实际维度，不匹配时自动重建 vec0 表

### 多场景泛用性

- **多语言情感分析** — 无词汇匹配时基于 emoji + 标点符号降级判断
- **日语/韩语停用词** — 扩展关键词提取覆盖范围
- **多用户场景隔离** — 记忆来源按 session 用户 ID 区分存储
- **群聊消息过滤** — 短回复、纯系统消息、纯 emoji 自动跳过
- **记忆重要性自适应** — 根据对话长度和决策关键词自动计算 importance 权重
- **工具参数国际化** — quality/tag/unify/retain 的 action 参数同时支持中英文值
- **时区感知** — `tz` 配置项控制日期计算，默认 `Asia/Shanghai`

### 反遗忘机制

- **`memory_retain`** — 检测重要但长期未召回的遗忘记忆
- **重要性评分** — 基于时间衰减 + 召回频率综合评估
- **手动热度刷新** — 支持手动刷新关键记忆热度，对抗遗忘曲线

### 旧版 skill 自动迁移与清理

- 安装本插件后，旧版 `yaoyao-memory`、`yaoyao-memory-v2`、`yaoyao-cloud-backup` skill 目录会在启动时**自动迁移并清理**
- **递归扫描**所有 `.json` 配置文件，迁移到 `extensions/yaoyao-memory/.skill-migrations/` 存档（扁平化 + skill 名前缀避免冲突）
- **整体删除**旧 skill 目录（Python 脚本、文档、HTML 面板等可恢复文件），不留残留
- **自定义配置**从 `~/.openclaw/workspace/skills/` 迁移到 `extensions/yaoyao-memory/.skill-migrations/`——用户可随时手动引用
- 数据文件（`.yaoyao.db`, `memory/*.md`, `persona.md`）与插件共享路径，不会被触及
- 幂等：首次迁移后二次启动不会重复拷贝
- 完全静默，失败不影响插件主流程

---

## 测试

**175+ 单元测试 · 全原生运行 · 仅 sqlite-vec（外部 npm 依赖）**

覆盖 17 个测试模块：情感分析、存储读写、session 过滤、FTS5/向量/混合搜索、导入导出、标签、图谱、增强搜索、质量评估、趋势分析、cron 提醒、反遗忘、推荐系统等。

运行：`npm test`

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

## 🚀 快速开始

### 从旧版本升级（v1.4.x → v1.5.1）

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
🎲    v1.5.1  ·  25 Tools  ·  2 Hooks
🎲 能力: FTS5✅ Vec✅ LLM✅ Cloud⚪
```

如果看不到横幅，检查 `plugins.allow` 是否包含 `"yaoyao-memory"`。

## 配置

```json5
{
  "enabled": true,
  "config": {
    // L0 自动捕获
    "capture": { "enabled": true },

    // L1 自动召回
    "recall": { "enabled": true, "maxResults": 3 },

    // 时区配置（影响日期计算和 daily md 归档）
    "tz": "Asia/Shanghai",

    // 向量搜索（可选，开启后支持混合搜索）
    "embedding": {
      "enabled": false,
      "provider": "openai",
      "baseUrl": "",
      "apiKey": "",
      "model": "",
      "dimensions": 1024
    },

    // LLM 管线（可选，L1→L2→L3）
    // 💡 如果已配置 embedding，LLM 会自动复用 embedding 的 apiKey/baseUrl
    //    无需额外配置！插件启动时会自动检测并输出提示。
    //    如需关闭，设置 llm: { enabled: false }
    //    如需自定义，设置下方的 apiKey / baseUrl / model
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

    // 多模态记忆：AI 自动保存图片描述到记忆（默认关闭）
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

## 数据存储

| 路径 | 格式 |
|------|------|
| `memory/YYYY-MM-DD.md` | 每日对话日志 |
| `memory/.yaoyao.db` | FTS5 + sqlite-vec 索引 |
| `memory/.backups/` | 时间戳快照备份（全量/增量） |
| `memory/.backups/.last-backup.json` | 增量备份时间戳标记 |
| `memory/scene_blocks/` | 场景分组数据 |
| `memory/.archive/` | 已清理的旧日志 |
| `memory/.sync-source` | 云同步来源标记 |
| `memory/.write-fallback.jsonl` | 写入失败 fallback 记录（自动恢复） |

> 💡 `persona.md` / `.feedback.jsonl` / `.pipeline/` 在 v1.5.0+ 已由 [yaoyao-soul](https://github.com/taobaoaz/yaoyao-soul) 插件接管，本插件保留这些文件作为只读/兼容用途。

## 特性

- **中文友好** — FTS5 无法匹配 CJK 时自动降级 LIKE + bigram 搜索
- **环境自适应** — 自动探测 FTS5/向量/LLM/云同步能力，优雅降级
- **记忆接管** — 一键导入 OC 原生记忆、workspace 文件、旧 daily md
- **心情环** — 情感分析引擎，多语言支持（中/英/日/韩 + emoji 降级）
- **安全加固** — 文件权限收紧、路径遍历防护、SSRF 黑名单、API Key 脱敏、供应链归零
- **防御性降级** — DB 层叠 fallback（node:sqlite → better-sqlite3 → file-db），网络故障隔离
- **云备份** — WebDAV/S3/SFTP/Samba 多云同步
- **趋势分析** — 话题频率变化趋势洞察
- **反遗忘** — 检测重要记忆遗忘风险，主动提醒
- **防幻觉** — 自动标记推测性 AI 输出与用户纠正，提供 `memory_verify` 工具核实任意说法与记忆的匹配度（confirmed/partial/unconfirmed/contradicted）
- **极小依赖** — 仅 sqlite-vec（node:sqlite 内置），无 Python 无额外运行时
- **187+ 测试全绿** — 原生运行

> 💡 **心理学模型**（PersonaStateMachine、情绪追踪、L4 反馈学习）在 v1.5.0+ 已拆分为独立插件 [yaoyao-soul](https://github.com/taobaoaz/yaoyao-soul)。安装后可与本插件协同工作。

## 🔍 防幻觉机制

yaoyao-memory 在存储和验证两个环节提供防幻觉能力，**无需 LLM 调用，纯本地规则实现**。

### 1. 自动标记（Auto-Capture 环节）

每次 `agent_end` 写入 L0 日志时，自动检测两类信号：

| 信号 | 检测规则 | 日志标记 |
|------|----------|----------|
| **推测性输出** | 命中 "可能/也许/我觉得/I think/maybe" 等 30+ 个中英文推测词 | `[⚠️ 推测性: 可能, 也许]` |
| **用户纠正** | 命中 "不对/错了/不是/no/wrong" 等 20+ 个纠正词 | `[🚫 用户纠正]` |

**作用**：
- 让 AI 回忆时能看到 "这条记忆是 AI 自己推测的，不是用户确认的事实"
- 用户纠正的记录成为 "争议标记"，后续 `memory_verify` 会优先检查

### 2. 主动验证（`memory_verify` 工具）

当 AI 想声称 "我记得你说过..." 时，应该先调用 `memory_verify` 核实：

```json
{ "claim": "用户上周提到在用 Next.js" }
```

返回四种 verdict：

| 结果 | 含义 | AI 应该怎么回应 |
|------|------|-----------------|
| **confirmed** ✅ | 记忆中有明确支持，关键词重叠 >50% | "是的，你确实说过..." |
| **partial** 🟡 | 记忆中有部分相关内容，但不完全匹配 | "我记得你提到过类似的事，但细节可能是..." |
| **unconfirmed** ❓ | 记忆中无相关记录 | "我不太确定你是否说过这个，可能是我记混了" |
| **contradicted** ⚠️ | 记忆中有相反记录（肯定/否定方向矛盾） | "等等，我记得你说过的是相反的情况..." |

**技术实现**：
- 中文按字符重叠 + 英文按单词 Jaccard，混合评分
- 否定词检测（"不/没/no/not"），自动识别矛盾方向
- 纯本地计算，0.1ms 级延迟

### 3. 为什么不做 "幻觉过滤"（即自动丢弃 AI 输出）

常见建议是 "检测到推测内容就不存入记忆"，但 yaoyao-memory **不这样做**，原因：

1. **上下文价值** — 即使 AI 的推测是错的，用户后续的纠正本身是高价值记忆（"纠正了 AI 的错误" = 用户对某话题的真实立场）
2. **自证价值** — AI 的推测被纠正的过程，比结果更重要。丢弃 = 丢失 "AI 曾经这样理解过" 的历史
3. **标记优于删除** — `[⚠️ 推测性]` 标记让后续搜索时自然降低权重，而不是粗暴删除

**原则**：yaoyao-memory 是记忆的**档案员**，不是**审查官**。标记风险，但不替用户决定什么值得记住。

## 已知限制与路线图

> 以下问题已被识别并诚实记录。区分"plugin 自己能解决的"与"需要上游 SDK 支持的"。

### 1. 跨设备同步（当前：单向云备份 → 目标：双向增量同步）

**现状**：`memory_cloud_sync` 是**云备份（backup）**，不是真正的同步（sync）。它把 `.yaoyao.db` 和 `memory/*.md` 打包推送到 WebDAV/S3/SFTP/Samba，或从云端拉取覆盖本地。本质是单向 push/pull。

**核心差距**：
- **无双向增量** — 设备 A 新增一条记忆，设备 B 不会自动感知；必须手动 pull 整个数据库文件
- **无冲突合并** — 两台设备同时写入了记忆，后写入者覆盖前者，先写的数据丢失
- **无离线 reconcile** — 离线期间写的记忆，联网后无法自动合并，只能全盘覆盖

**建议用法**：
- **单设备写入，其他设备只读** — 用一台机器作为"主节点"运行 yaoyao-memory，其他设备通过 `memory_cloud_sync` 只拉取备份做查询
- **避免并发写** — 不要同时在两台活跃设备上让 AI 写入记忆，否则数据互相覆盖

**计划**：P2 — v2.x 可能引入基于**操作日志（oplog）**的同步层：每条写入生成一条 append-only log，多设备通过 oplog 做事件回放 + 冲突标记（非自动合并）。这是 SQLite → Syncthing/CloudKit 级别的差距，plugin 自身无法在短期内弥合。

### 2. 隐私加密（当前：明文存储，已做权限隔离 → 目标：Gateway 级透明加密）

**现状（已做的）**：
- 文件权限已收紧：`memory/` 目录 `0o700`（仅 owner 可读写执行），`.yaoyao.db` / `memory/*.md` 写入后强制 `0o600`
- 传输加密：`memory_cloud_sync` 通过 HTTPS/SFTP/TLS 传输，不落明文到传输链路
- SSRF 防护：embedding/LLM 请求禁止访问内网地址，防止本地服务被利用泄露数据
- 配置脱敏：`apiKey` / `token` / `password` 等敏感字段在日志中自动掩码（`***`），防止凭证泄露

**为什么不自己做磁盘加密**：

plugin 层自行加密的方案（如 AES-256-GCM 加密 `.md` + `.db`）存在三个不可接受的矛盾：

1. **搜索与加密互斥** — yaoyao-memory 依赖 FTS5 全文索引实现 0.06ms 级查询。如果 `.yaoyao.db` 加密，FTS5 每次查询前必须解密整个数据库（或维护一份明文内存副本），延迟从毫秒级变成数百毫秒，且内存中仍有一份明文，抵消加密意义。`memory/*.md` 同理，实时解密会让 `memory_get` / `memory_search` 的 API 响应爆炸。

2. **密钥管理地狱** — 如果由 plugin 自行保管密钥（用户 passphrase），passphrase 丢失 = 全部记忆永久不可恢复（无后门）。而 plugin 作为无状态进程，没有安全的密钥存储位置（不可能每次启动都让用户输入密码）。

3. **安全幻觉** — 即使加密了 `memory/*.md`，`.yaoyao.db` 的 FTS5 索引仍必须是明文才能查询。敌人直接从索引就能重建出"你聊过猫、工作、某个项目"等关键词画像，加密原始文本的意义被严重削弱。

**建议（现在就能做的）**：
- **全盘加密** — BitLocker（Windows）、FileVault（macOS）、LUKS（Linux）。这是最有效、最标准的保护，覆盖所有应用数据而非只覆盖 plugin
- **加密文件系统挂载** — 把 `memory/` 目录放在加密卷/ VeraCrypt 容器 / APFS 加密分区上
- **云备份加密** — S3 SSE（服务端加密）、SFTP over TLS、WebDAV HTTPS
- **共享主机** — `0o700/0o600` 权限已防止同机其他普通用户读取；如需更强隔离，使用独立用户账户运行 OpenClaw Gateway

**计划**：P1 — 等待 **OpenClaw SDK 暴露 `getMachineKey()` 接口**（类似系统 Keychain / Android Keystore）。届时 plugin 可调用 Gateway 托管的 machine key 做透明加解密，密钥由 OS 安全飞地保管，plugin 不触碰密钥管理。在那之前，任何 plugin 自行实现的加密都是**安全幻觉，不做**。

### 3. 多进程并发写入（当前：单进程安全 → 多进程未验证）

**现状**：SQLite 有 WAL 模式和事务锁，**同一台机器上的单个进程写入是安全的**。"两个 agent 同时写同一 DB"属于多进程/多设备边缘场景。

**限制**：网络挂载（NFS/Samba）上的 SQLite 并发行为不可靠。plugin 不提供分布式锁。

**计划**：P3 — 在文档中明确声明"不建议多进程并发写同一 DB"。若需多设备协作，使用 `memory_cloud_sync` 的 pull → 本地写 → push 工作流。

### 4. 增量学习闭环（当前：诊断有，自动调整无 → 目标：自优化）

**现状**：`memory_quality` 能计算重复度/覆盖率/健康度，`memory_retain` 能检测遗忘风险，但**诊断后没有自动动作**。

**计划**：P2 — v1.6.x 引入轻量闭环（纯统计，无需 LLM）：
- 重复度 > 30% → 自动触发 `memory_unify dedup`
- 某记忆 30 天未召回且 importance 高 → 自动提升索引权重
- `memory_trends` 检测到话题激增 → 自动给相关记忆打 `[trending]` 标签
- `memory_quality` 健康度下降 → 在 `auto-capture` 中提高写入阈值，减少噪音

这属于 plugin 自身能力范围内，下一版本优先实现。

### 5. 多设备分布式写入 + 集中整理（当前：不直接支持 → 需要外部编排）

**需求**：多台设备各自运行 AI，分别产生记忆；由一台"中央节点"定期拉取所有设备的记忆，统一去重、索引、整理。

**为什么当前架构不支持**：
- `.yaoyao.db` 是 SQLite 二进制文件，两台设备的 DB 文件**无法合并**（没有 diff/merge 语义）
- `memory/*.md` 文件名按日期生成（如 `2026-05-14.md`），多设备同一天写入会**互相覆盖**
- `memory_cloud_sync` 是镜像备份，不是按设备分区的增量投递

**最小可行方案（需外部工具配合）**：

```
设备 A                    云端                     中央整理节点
  │  push md only         │                        │
  ▼                       ▼                        ▼
memory/2026-05-14.md  →  device-a/2026-05-14.md    │  rclone pull all
                         device-b/2026-05-14.md    │  → memory_import
                         device-c/2026-05-14.md    │  → 统一 .yaoyao.db
```

1. **各设备**：只通过 `memory_cloud_sync` 上传 `memory/*.md` 文本文件（排除 `.yaoyao.db`）
2. **云端**：按设备分区存储（`device-a/`、`device-b/`、`device-c/`）
3. **中央节点**：定期 `rclone sync` 拉取所有分区，用 `memory_import` 批量导入并按内容哈希去重
4. **中央节点**：维护统一的 `.yaoyao.db`，作为"完整历史"的唯一真相源

**当前能做到的**：

| 场景 | 可行性 | 方案 |
|------|--------|------|
| 各设备只写自己的，彼此不共享 | ✅ | 每台设备独立运行 yaoyao-memory |
| 各设备写自己的，中央节点统一整理后只在一台查 | ⚠️ 勉强 | 手动 rclone + `memory_import`，无自动化工具 |
| 各设备写自己的，所有设备都能查全部 | ❌ | 需要把统一索引反向同步回各设备，回到"怎么合并 SQLite"的原点 |

**计划**：P3 — 这不是 plugin 单点能优雅解决的。如果需求强烈，后续可能提供：
- `memory_sync --mode=md-only` — 只同步 markdown，不上传 `.yaoyao.db`
- `memory_import --device-prefix=device-a` — 导入时自动给来源打标签
- 但"分布式索引合并"仍是 SQLite 生态的天花板， honest 承认 limitation。

---

- **OpenClaw** >= 2026.5.5（`openclaw --version` 查看）
- **Node.js** >= 22（原生 `node:sqlite` 支持，`node --version` 查看）
- 可选：embedding API key 用于向量搜索
- 可选：LLM API key 用于记忆提取管线（未配置时自动复用 embedding 的 key）

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
