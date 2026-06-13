# Yaoyao Memory Plugin — 完整架构梳理

> 版本: 1.5.0 | 梳理时间: 2026-05-14 | 基于源码逐文件阅读整理

---

## 一、项目总览

**定位**: OpenClaw 插件，为 AI 提供 4 层记忆系统（L0 文件 → L1 FTS5 → L2 场景 → L3 画像），支持全文本搜索、语义向量搜索、情感分析、云备份、话题趋势等。

**技术栈**: Node.js 22+ (ESM), TypeScript, SQLite (FTS5 + 可选 sqlite-vec), 零运行时依赖（仅 sqlite-vec 一个可选 npm 包）。

**数据流核心**: 对话 → auto-capture → 文件(L0) + FTS5(L1) → auto-recall 时搜索注入上下文。

---

## 二、功能头（入口点）

### `index.ts` — 插件生命周期

```
register(api, config)
  ├─ initMemoryStore(config)       → MemoryStore
  ├─ initDBBridge(store, config)   → DBBridge（FTS5 初始化）
  ├─ initEmbedding(config, db)?    → EmbeddingService（可选）
  ├─ registerAllTools(api, store, db, embedding, config)  → 25+ 工具
  ├─ registerCaptureHook(api, store, db, config)         → auto-capture
  ├─ registerRecallHook(api, db, config, embedding)      → auto-recall
  └─ onConfigUpdate(newConfig)     → 热重载
```

**关键决策**:
- `embedding` 仅在配置了 `apiKey` 时初始化 → 无向量搜索时退化为纯 FTS5
- `blockLabels` 从配置读取 → 控制哪些会话不捕获/不回忆
- `cleaner` 在 register 时自动运行一次清理（异步）

---

## 三、核心基础设施（utils 层）

### 3.1 `memory-store.ts` — L0 文件存储层

**职责**: 所有 `.md` 文件的读写、枚举、路径解析。

```typescript
interface MemoryStore {
  baseDir: string                    // memory/ 目录
  appendToDaily(date, entry)          // 追加到 YYYY-MM-DD.md
  readFile(path): string | null       // 读文件
  listFiles(): MemoryFile[]          // 枚举文件（daily/memory/archive）
  getDailyPath(date): string          // 路径计算
  sceneDir(): string                 // scene_blocks/ 目录
}
```

**文件布局**:
```
memory/
├── YYYY-MM-DD.md        # 每日对话日志（L0）
├── scene_blocks/        # L2 场景摘要
│   ├── work.md
│   └── personal.md
├── .yaoyao.db           # SQLite FTS5 (L1)
├── .yaoyao.vec.db       # sqlite-vec 向量库（可选）
├── .backups/            # 快照备份
├── .feedback.jsonl      # L4 反馈记录
├── .sync-meta/          # 云同步标记
└── .cloud-sync-state.json # 同步状态
```

**交叉依赖**:
- 被所有工具调用（save/get/list/forget/export/import/backup/cloud-sync）
- 被 auto-capture 调用（写入对话）
- 被 DBBridge 调用（读取文件重建索引）

---

### 3.2 `db-bridge.ts` — L1 索引层

**职责**: SQLite FTS5 全文本索引 + 元数据表 + 可选 sqlite-vec 向量索引。

**核心表**:
- `memory_meta` — 元数据（date, user_text, asst_text, created_at）
- `memory_fts` — FTS5 虚拟表（user_text + asst_text）
- `memory_vec` — sqlite-vec 向量表（可选，embedding 开启时）

**核心方法**:
```typescript
indexTurn(userText, asstText, date) → number     // 插入+索引
search(query, limit) → SearchResult[]           // FTS5 搜索
hybridSearch(query, vec, limit) → SearchResult[]  // FTS5 + 向量混合
getStats() → Stats                                // 统计
getLatestMemory(limit) → SearchResult[]         // 最近记忆
deleteByDate(date) → number                      // 按日期删
deleteByKeyword(keyword) → number                // 按关键词删
rebuildIndex(store) → void                      // 从文件重建
```

**交叉依赖**:
- 依赖 `MemoryStore`（重建索引时读取文件）
- 被 `auto-capture` 调用（每次对话后索引）
- 被 `auto-recall` 调用（搜索相关记忆）
- 被几乎所有搜索类工具调用（search/search_enhanced/graph/timeline/recommend/quality）
- 被 `memory_export` / `memory_import` 调用

---

### 3.3 `embedding.ts` — 向量嵌入服务

**职责**: 通过 OpenAI-compatible API 生成文本向量，用于语义搜索。

**关键特性**:
- 自动检测 provider → 默认模型映射（openai/deepseek/siliconflow/ollama 等）
- `fetchWithRetry` — 网络错误 + HTTP 5xx 退避重试（刚修复）
- `embedBatch` — 批量嵌入，自动分块
- `/v1` URL 前缀自动处理

**交叉依赖**:
- 被 `auto-recall` 调用（hybridSearch 前 embed 用户消息）
- 被 `memory_search_enhanced` 调用（向量重排序）
- 被 `memory_graph` 调用（语义关联边）
- 被 `DBBridge.hybridSearch` 调用（传入向量参数）

---

### 3.4 `llm-client.ts` — LLM 客户端

**职责**: 轻量级 OpenAI API 调用器，用于可选的 LLM 增强流程。

**配置优先级**:
1. 显式 `llm.apiKey` → 独立 LLM 配置
2. `embedding.apiKey` 回退 → 复用 embedding 的 key 和 baseUrl
3. 无 → 返回 null（LLM 功能禁用）

**交叉依赖**:
- 被 L2/L3 提取器使用（如果存在的话，v1.5.0 已移出核心）
- 目前核心代码中直接引用较少，但 `llm-parse.ts` 提供 JSON 解析工具

---

### 3.5 `sentiment.ts` — 情感分析器

**职责**: 中英双语情感检测，基于 Ekman 6 基本情绪（joy/sadness/anger/fear/surprise/disgust）。

**实现**: 纯词表匹配，无外部依赖。
- 中文：2-3 字窗口匹配情绪词库
- 英文：单词级匹配
- Emoji：Intl.Segmenter 分词检测
- 否定前缀处理（"不开心" → sadness）

**输出**: `SentimentResult` — 正负分数、标签、emoji、情绪分数、主导情绪。

**交叉依赖**:
- 被 `auto-recall` 调用（formatRecallText 加 emoji）
- 被 `memory_search` 调用（结果加情绪 emoji）
- 被 `memory_search_enhanced` 调用
- 被 `memory_search_timeline` 调用

---

### 3.6 `session-filter.ts` — 会话过滤器

**职责**: 决定哪些 session 应该被 capture/recall 处理。

**默认阻断**:
- 内部标签: system, admin, cron, heartbeat, healthcheck, internal, plugin, test, debug, monitor
- 可配置 `blockLabels` 扩展
- `allowLabels` 白名单模式

**交叉依赖**:
- 被 `auto-capture` 调用（agent_end 时过滤）
- 被 `auto-recall` 调用（before_prompt_build 时过滤）

---

### 3.7 `cloud-adapter.ts` — 云适配器架构

**职责**: 零外部依赖的云存储支持（WebDAV/S3/SFTP/Samba）。

**实现**:
- WebDAV/S3: 纯 `node:http/https` 实现（S3 用 AWS SigV4）
- SFTP: 系统 `sftp` 命令
- Samba: Windows `net use` / Linux `smbclient`

**安全**:
- `escShellArg` — 剥离 shell 元字符，双引号加倍
- 密码通过环境变量 `PASSWD` 传递

**交叉依赖**:
- 仅被 `memory_cloud_sync` 工具调用
- 从 `secrets-loader.ts` 加载凭证

---

### 3.8 `backup.ts` — 备份管理器

**职责**: 创建/恢复/清理时间戳快照。

**模式**:
- Full: 全量备份（.md 文件 + .yaoyao.db + .feedback.jsonl）
- Incremental: 基于 mtime 的增量备份

**交叉依赖**:
- 被 `memory_backup` 工具调用
- 读取 `MemoryStore.baseDir` 下的文件

---

### 3.9 `memory-cleaner.ts` — 清理器

**职责**: 定时清理旧数据。

**策略**:
- 删除超过 retentionDays 的 daily 文件
- 清理对应的 FTS5 记录
- 可选归档（复制到 archive/）

**交叉依赖**:
- 被 `index.ts` 在 register 时调用一次
- 依赖 `MemoryStore` + `DBBridge`

---

### 3.10 `secrets-loader.ts` — 凭证加载器

**职责**: 从 `~/.openclaw/credentials/secrets.env` 加载 KV 配置。

**格式**: `# 注释`, `KEY=VALUE`, `KEY="quoted"`, `KEY='quoted'`

**交叉依赖**:
- 被 `cloud-adapter.ts` 调用（获取云凭证）
- 被 `memory_cloud_sync` 调用（configure 操作展示模板）

---

### 3.11 `config.ts` — 配置辅助

**职责**: 类型安全的属性提取（`getProp`, `getObj`, `getBool`）。

**交叉依赖**:
- 被几乎所有模块调用（从 plugin config 读取参数）

---

### 3.12 `clamp.ts` — 数值钳制

**职责**: `clampNum(val, default, min, max)` — 防御性数值处理。

**交叉依赖**:
- 被几乎所有工具和 utils 调用（参数边界检查）

---

### 3.13 `llm-parse.ts` — LLM 响应解析

**职责**: 剥离 markdown code fence + JSON.parse + 正则回退。

**交叉依赖**:
- 被需要 LLM JSON 输出的模块使用（如 L2/L3 提取器，如果存在）

---

## 四、Hooks（自动流程）

### 4.1 `auto-capture.ts` — 自动捕获

**触发**: `api.on("agent_end", ...)`

**流程**:
```
agent_end 事件
  ├─ 过滤: sessionFilter.shouldProcess(sessionKey)
  ├─ 提取最后 user_msg + asst_msg
  ├─ extractContent(msg, maxLen) — 处理 string/array/object 格式
  ├─ 跳过: 内容 < minContentLen 或 失败
  ├─ store.appendToDaily(date, entry) — 写 L0 文件
  ├─ db.indexTurn(user, asst, date) — 写 L1 FTS5
  └─ (v1.5.0 已移除) 不再做隐式情绪标签
```

**关键函数**:
- `extractContent()` — 安全提取消息内容，处理多模态数组
- `safeStringify()` — 深度限制 + 循环引用检测的 JSON 序列化

**交叉依赖**:
- → `MemoryStore.appendToDaily`
- → `DBBridge.indexTurn`
- → `SessionFilter.shouldProcess`
- → `config.ts` / `clamp.ts`

---

### 4.2 `auto-recall.ts` — 自动回忆

**触发**: `api.on("before_prompt_build", ...)`

**流程**:
```
before_prompt_build 事件
  ├─ 过滤: sessionFilter.shouldProcess(sessionKey)
  ├─ 提取用户消息关键词 (extractKeywords)
  ├─ 合并 sessionContext 跨轮关键词
  ├─ 检查缓存 (TTL + size limit)
  ├─ 混合搜索 (FTS5 + optional vector)
  ├─ 时间衰减评分 (exponential decay by halfLife)
  ├─ 多样化采样 (Jaccard dedup + date interleaving)
  ├─ 情感 emoji 标记
  ├─ 更新 sessionContext
  └─ 返回: { prependSystemContext?, appendSystemContext }
```

**增强特性**:
- **时间衰减**: 旧记忆分数 × exp(-daysAgo / halfLife)
- **多样化采样**: Jaccard 阈值自适应（结果越多越严格）+ 日期交错
- **会话上下文**: 跨轮关键词累积，LRU 驱逐
- **缓存**: TTL + 大小限制 + 定期清理

**交叉依赖**:
- → `DBBridge.search` / `DBBridge.hybridSearch`
- → `EmbeddingService.embed`（可选）
- → `Sentiment.detectSentiment`
- → `SessionFilter`
- → `config.ts` / `clamp.ts`

---

## 五、Tools（用户/AI 可调用的工具）

### 5.1 基础 CRUD

| 工具 | 依赖 | 功能 |
|------|------|------|
| `memory_save` | MemoryStore, DBBridge | 手动保存记忆 |
| `memory_search` | DBBridge, Sentiment | FTS5 搜索 + 情绪标记 |
| `memory_get` | MemoryStore | 按文件名/日期读取 |
| `memory_list` | MemoryStore | 枚举文件列表 |
| `memory_forget` | MemoryStore, DBBridge | 按关键词/日期删除 |
| `memory_note` | MemoryStore, DBBridge | 快速笔记 |

### 5.2 搜索增强

| 工具 | 依赖 | 功能 |
|------|------|------|
| `memory_search_enhanced` | DBBridge, Embedding?, Sentiment | 语义重排序 + 关键词高亮 |
| `memory_search_timeline` | DBBridge, Sentiment | 按日期分组搜索结果 |
| `memory_graph` | DBBridge, Embedding?, MemoryStore | 记忆关联图谱（5维关联） |
| `memory_recommend` | DBBridge, MemoryStore | 多样化推荐 |

### 5.3 分析统计

| 工具 | 依赖 | 功能 |
|------|------|------|
| `memory_stats` | MemoryStore, DBBridge | 综合统计（文件/DB/标签/场景/备份） |
| `memory_timeline` | DBBridge | 时间线热力图 |
| `memory_trends` | MemoryStore | 话题趋势（词频统计，无LLM） |
| `memory_quality` | MemoryStore, DBBridge | 质量评估 + 去重检测 |

### 5.4 导入导出

| 工具 | 依赖 | 功能 |
|------|------|------|
| `memory_export` | MemoryStore, DBBridge | JSONL 导出 |
| `memory_import` | MemoryStore, DBBridge | JSONL 导入 |
| `memory_import_workspace` | MemoryStore | 从 workspace memory/ 导入 |
| `memory_import_oc` | MemoryStore | 从 OpenClaw memory/ 导入 |

### 5.5 标签与组织

| 工具 | 依赖 | 功能 |
|------|------|------|
| `memory_tag` | MemoryStore, DBBridge | 标签增删查搜 |
| `memory_unify` | MemoryStore | 合并/去重/整理 |
| `memory_retain` | MemoryStore | 保留策略管理 |

### 5.6 备份与同步

| 工具 | 依赖 | 功能 |
|------|------|------|
| `memory_backup` | BackupManager | 快照备份（全量/增量） |
| `memory_cloud_sync` | CloudAdapter, MemoryStore, SecretsLoader | 云同步（WebDAV/S3/SFTP/Samba） |

### 5.7 提醒

| 工具 | 依赖 | 功能 |
|------|------|------|
| `memory_remind` | — | 生成 cron 配置文本（不直接操作数据） |

---

## 六、功能交叉关系图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              OpenClaw 运行时                                   │
│  ┌──────────────┐   ┌──────────────────┐   ┌──────────────────┐               │
│  │ agent_end    │   │ before_prompt_build│   │ 用户调用工具     │               │
│  └──────┬───────┘   └────────┬─────────┘   └────────┬─────────┘               │
└─────────┼────────────────────┼──────────────────────┼───────────────────────────┘
          │                    │                      │
          ▼                    ▼                      ▼
   ┌──────────────┐     ┌──────────────┐      ┌──────────────┐
   │ auto-capture │     │ auto-recall  │      │ 25+ tools    │
   └──────┬───────┘     └──────┬───────┘      └──────┬───────┘
          │                    │                      │
          ▼                    ▼                      ▼
   ┌──────────────┐     ┌──────────────┐      ┌──────────────┐
   │ MemoryStore  │     │ DBBridge     │      │ DBBridge     │
   │  (L0 文件)   │     │  (L1 FTS5)   │      │  (L1 FTS5)   │
   └──────────────┘     └──────┬───────┘      └──────────────┘
          │                    │                      │
          │              ┌─────┴─────┐                │
          │              ▼           ▼                │
          │        ┌────────┐   ┌──────────┐        │
          │        │Search  │   │Embedding │        │
          │        │(FTS5)  │   │(sqlite-vec│        │
          │        └────────┘   │ / API)   │        │
          │                     └──────────┘        │
          │                                           │
          │         ┌──────────────────┐             │
          └────────►│ sentiment.ts     │◄────────────┘
                    │ (情感 emoji 标记) │
                    └──────────────────┘
```

**更细粒度的依赖矩阵**:

```
                    MemoryStore  DBBridge  Embedding  Sentiment  SessionFilter  CloudAdapter  BackupManager
auto-capture             ✓          ✓                                          
auto-recall                          ✓          ✓          ✓          ✓          
memory_save              ✓          ✓                                          
memory_search                        ✓                     ✓                   
memory_search_enhanced               ✓          ✓          ✓                   
memory_graph                         ✓          ✓                               
memory_get               ✓                                                    
memory_list              ✓                                                    
memory_forget            ✓          ✓                                          
memory_stats             ✓          ✓                                          
memory_timeline                      ✓                                          
memory_search_timeline               ✓                     ✓                   
memory_export            ✓          ✓                                          
memory_import            ✓          ✓                                          
memory_tag               ✓          ✓                                          
memory_backup                                              BackupManager ✓
memory_cloud_sync        ✓                              CloudAdapter ✓          
memory_trends            ✓                                                    
memory_quality           ✓          ✓                                          
memory_recommend                     ✓          ✓          ✓                   
memory_note              ✓          ✓                                          
memory_remind            — (纯文本生成，不操作数据)
```

---

## 七、数据流全景

### 7.1 写入流（Capture）

```
用户对话 → agent_end 事件
  ├─→ extractContent() 提取文本
  ├─→ sessionFilter 检查（非内部会话？）
  ├─→ MemoryStore.appendToDaily(date, markdown_entry)
  │     └─→ fs.appendFileSync(memory/YYYY-MM-DD.md)
  └─→ DBBridge.indexTurn(user, asst, date)
        ├─→ INSERT INTO memory_meta
        └─→ INSERT INTO memory_fts (FTS5 自动索引)
              └─→ 可选: INSERT INTO memory_vec (sqlite-vec)
```

### 7.2 读取流（Recall）

```
用户新消息 → before_prompt_build 事件
  ├─→ sessionFilter 检查
  ├─→ extractKeywords() 提取关键词
  ├─→ getSessionContext() 合并历史关键词
  ├─→ checkCache() 命中则直接返回
  ├─→ hybridSearch?(query, embedding_vector)
  │     ├─→ FTS5 粗召回
  │     └─→ 向量精排（cosine similarity）
  ├─→ 或 fallback: DBBridge.search() (纯 FTS5)
  ├─→ applyTimeDecay() 时间衰减
  ├─→ applyDiversitySampling() 多样化
  ├─→ detectSentiment() 加 emoji
  ├─→ updateSessionContext() 更新上下文
  └─→ 返回: appendSystemContext / prependSystemContext
```

### 7.3 工具调用流

```
用户/AI 调用 memory_XXX
  ├─→ withErrorHandling 包装（统一错误格式）
  ├─→ 参数 clampNum 边界检查
  ├─→ 操作 MemoryStore / DBBridge / BackupManager / CloudAdapter
  └─→ 返回 MCP 格式: { content: [{ type: "text", text: ... }] }
```

---

## 八、测试覆盖

**测试文件**（16 个，147 测试，0 失败）:

| 测试文件 | 覆盖模块 | 测试数 |
|---------|---------|--------|
| `clamp.test.ts` | clamp.ts | 4 |
| `cloud-adapter.test.ts` | cloud-adapter.ts (escShellArg) | 5 |
| `config.test.ts` | config.ts | 15 |
| `db-bridge.test.ts` | db-bridge.ts | ~20 |
| `db-bridge-extra.test.ts` | db-bridge.ts 边缘 | ~10 |
| `embedding.test.ts` | embedding.ts | 12 |
| `sentiment.test.ts` | sentiment.ts | ~10 |
| `session-filter.test.ts` | session-filter.ts | ~8 |
| `memory-store.test.ts` | memory-store.ts | ~15 |
| `auto-capture.test.ts` | auto-capture.ts | 15 |
| `memory-export.test.ts` | memory-export.ts | ~8 |
| `memory-import.test.ts` | memory-import.ts | ~8 |
| `memory-graph.test.ts` | memory-graph.ts | ~10 |
| `memory-search-enhanced.test.ts` | memory-search-enhanced.ts | ~8 |
| `memory-tag.test.ts` | memory-tag.ts | ~8 |
| `llm-parse.test.ts` | llm-parse.ts | ~5 |

---

## 九、安全与隐私设计

| 层面 | 措施 |
|------|------|
| 数据存储 | 100% 本地（SQLite + 文件系统），无远程传输 |
| 云同步 | 仅在用户显式配置凭证后启用，凭证存于本地 secrets.env |
| LLM 调用 | 仅在配置了 apiKey 时启用，opt-in |
| 命令注入 | `escShellArg` 剥离危险字符；密码通过环境变量传递 |
| 路径遍历 | `memory_get` 用 `realpathSync` 校验路径在 baseDir 内 |
| 测试 | 147 测试覆盖核心工具函数 |

---

## 十、版本演进标记

- **v1.5.0**: 心理学模型移出核心（→ yaoyao-soul 插件），核心只做捕获+索引+搜索
- **近期修复**:
  - `fetchWithRetry` 修复：HTTP 5xx 现在会重试
  - `extractContent` 修复：过滤空数组项，避免尾随空格
  - `escShellArg` 安全加固 + 测试
  - 新增 embedding/auto-capture/cloud-adapter 测试

---

*梳理完毕。如需深入某个模块的具体实现细节，继续追问。*
