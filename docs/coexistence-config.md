# 小艺 Claw 记忆系统完整配置方案

> 生成时间: 2026-06-28  
> 版本: yaoyao-memory v1.9.1 + memory-celia v2026-06-25-rc8  
> 本文档与 yaoyao-plugin beta 分支 v1.9.1 实际实现逐项核对，描述真实可用行为。

---

## 一、系统概览

### 1.1 当前记忆架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    OpenClaw Gateway                             │
│                                                                 │
│  ┌───────────────────────┐      ┌───────────────────────┐      │
│  │   yaoyao-memory       │      │   memory-celia        │      │
│  │   v1.9.1              │      │   v2026-06-25-rc8     │      │
│  │   (supplement 模式)   │      │   (slot 占用者)       │      │
│  │                       │      │                       │      │
│  │   40 个工具           │      │   16 个工具           │      │
│  │   FTS5 + sqlite-vec   │      │   C/SQLite 引擎       │      │
│  │   知识图谱            │      │   Dream 系统          │      │
│  │   情感分析            │      │   程序记忆            │      │
│  │   云备份              │      │   4 层记忆            │      │
│  └───────────────────────┘      └───────────────────────┘      │
│                                                                 │
│  slots.memory = "memory-celia"                                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 槽位配置

| 槽位 | 当前值 | 可选值 |
|------|--------|--------|
| `slots.memory` | `memory-celia` | `yaoyao-memory`, `memory-celia` |

> **⚠️ 行为说明（v1.9.1 核实）**：只要 `slots.memory` 被**任何非 yaoyao-memory 的插件**占用（不止 memory-celia，也包括 claw-core 等），yaoyao 都会进入 **coexist 模式**——自动关闭会冲突的 hook（详见 §4.3）。检测代码看的是"槽位是否被他人占用"，而非具体是谁。

---

## 二、yaoyao-memory 完整配置

### 2.1 插件清单

```json
{
  "id": "yaoyao-memory",
  "name": "Yaoyao Memory",
  "version": "1.9.1",
  "kind": "memory",
  "extensions": {
    "register": "./dist/index.js",
    "hooks": [
      "./dist/src/hooks/auto-capture.js",
      "./dist/src/hooks/auto-recall.js",
      "./dist/src/hooks/command-new.js",
      "./dist/src/hooks/heartbeat-recall.js"
    ]
  }
}
```

### 2.2 完整配置 Schema

```jsonc
{
  "capture": {
    "enabled": true,            // ⚠️ coexist 模式下会被强制改为 false（见 §4.3）
    "mode": "async",
    "maxContentLen": 500,
    "minContentLen": 3,
    "batchSize": 10,
    "debounceMs": 300,
    "excludeAgents": []
  },
  "recall": {
    "enabled": true,            // ⚠️ coexist 模式下会被强制改为 false
    "strategy": "hybrid",
    "maxResults": 3,
    "topK": 5,
    "minScore": 0.5,
    "cacheTTL": 30000,
    "maxCacheSize": 50,
    "halfLife": 30,
    "jaccardBase": 0.75,
    "jaccardMin": 0.5,
    "maxSessions": 1000,
    "maxContextKeywords": 20
  },
  "memoryDir": "",
  "embedding": {
    "enabled": false,
    "provider": "openai",
    "baseUrl": "",
    "apiKey": "",
    "model": "",
    "dimensions": 1024,
    "vectorBackend": "sqlite-vec",
    "hnswMaxElements": 50000,
    "providerModels": {},
    "timeoutMs": 15000,
    "retries": 1,
    "maxInputChars": 4000,
    "backoffBaseMs": 1000
  },
  "llm": {
    "enabled": true,
    "apiKey": "",
    "baseUrl": "",
    "model": "",
    "providerModels": {}
  },
  "cleanup": {
    "enabled": true,
    "l0l1RetentionDays": 30,
    "allowAggressiveCleanup": false,
    "maxBackups": 10
  },
  "snippetMaxLen": 500,
  "searchMaxLimit": 100,
  "likeFallbackScore": 0.5,
  "blockLabels": [],
  "verify": { "enabled": true },
  "quality": { "enabled": true },
  "retain": { "enabled": true },
  "graph": { "enabled": true },
  "autoSaveImage": false,
  "cloud": {
    "enabled": true,
    "autoSync": false,
    "conflictPolicy": "newer",
    "excludePatterns": [],
    "cmdTimeoutMs": 30000
  },
  "multimodal": {
    "enabled": false,
    "storageDir": "",
    "maxFileSizeMb": 50,
    "supportedTypes": ["image", "audio", "video"],
    "autoExtractText": false
  },
  "celiaBridge": {
    "enabled": false,           // v1.9.1 共存桥，默认关闭
    "mode": "delegate",         // delegate | read-only（见 §4.2）
    "serverBinaryPath": "",     // 留空自动探测
    "dbPath": "~/.openclaw/workspace/memory/celia_memory/celia_memory.db"
  }
}
```

### 2.3 工具列表

**主表（始终注册，38 个核心 + 可选）**：

| 类别 | 工具 |
|------|------|
| **核心记忆** | `memory_save`, `memory_get`, `memory_search`, `memory_forget`, `memory_list` |
| **增强搜索** | `memory_search_enhanced`, `memory_search_multi`, `memory_search_timeline`, `memory_adaptive_search` |
| **分析** | `memory_analyze`, `memory_quality`, `memory_trends`, `memory_recommend`, `memory_stats` |
| **图谱** | `memory_graph`, `memory_graph_relation` |
| **时间线** | `memory_timeline` |
| **导入导出** | `memory_export`, `memory_import`, `memory_import_oc`, `memory_import_workspace` |
| **云同步** | `memory_backup`, `memory_cloud_sync` |
| **验证** | `memory_verify`, `memory_judge`, `memory_conflicts`, `memory_auto_resolve` |
| **其他** | `memory_atomic_fact`, `memory_call`, `memory_cron`, `memory_healthcheck`, `memory_note`, `memory_remind`, `memory_retain`, `memory_skill_analytics`, `memory_tag`, `memory_telemetry`, `memory_unify`, `memory_workspace`, `memory_benchmark` |
| **Hidden** | `memory_multimodal`（需 `multimodal.enabled=true`） |

**共存桥激活时附加（见 §4.2，仅 coexist + celiaBridge.enabled=true）**：

| 模式 | 附加工具 |
|------|----------|
| `delegate` | `memory_dream_status`, `memory_dream_trigger`, `memory_dream_summary`, `memory_scene_load`, `memory_scene_list`, `memory_global_summary`, `memory_flush_celia`（共 7 个，标注 `[via celia]`） |
| `read-only` | `memory_celia_browse`（1 个，只读查询 celia 库，标注 `[via celia · read-only]`） |

### 2.4 依赖

```json
{
  "dependencies": {
    "sqlite-vec": "^0.1.9"
  },
  "optionalDependencies": {
    "hnswlib-node": "^3.0.0"
  }
}
```

---

## 三、memory-celia 完整配置

### 3.1 插件清单

```json
{
  "id": "memory-celia",
  "kind": "memory",
  "providerAuthEnvVars": {
    "memory-celia": ["OPENAI_EMBED_API_KEY", "OPENAI_CHAT_API_KEY"]
  }
}
```

### 3.2 完整配置 Schema

```json
{
  "serverBinaryPath": "/home/sandbox/.openclaw/extensions/celia_memory/install/current/bin/celia_memory_mcp_server",
  "dbPath": "/home/sandbox/.openclaw/workspace/memory/celia_memory/celia_memory.db",
  "userId": "openclaw-user",
  "vectorDim": 128,
  "embed": {
    "baseUrl": "https://api.openai.com",
    "apiKey": "${OPENAI_EMBED_API_KEY}",
    "model": "text-embedding-3-small"
  },
  "chat": {
    "baseUrl": "https://api.openai.com",
    "apiKey": "${OPENAI_CHAT_API_KEY}",
    "model": "gpt-4o-mini"
  },
  "rerank": {
    "baseUrl": "https://api.fireworks.ai/inference",
    "apiKey": "${OPENAI_RERANK_API_KEY}",
    "model": "accounts/fireworks/models/qwen3-reranker-8b"
  },
  "proceduralDir": "~/.openclaw/workspace/memory/procedural",
  "proceduralLearnDebug": false,
  "dreamingEnabled": false
}
```

### 3.3 环境变量

```bash
# MCP 服务配置
CELIA_LOG_LEVEL=INFO
CELIA_LOG_FILE=/home/sandbox/.openclaw/logs/celia_memory/celia_memory.log
CELIA_LOG_MAX_BYTES=10485760
CELIA_LOG_BACKUPS=5
CELIA_VECTOR_DIM=128
CELIA_CHAT_UID=<sandbox_uid>
CELIA_EMBED_UID=<sandbox_uid>
CELIA_PROCEDURAL_DIR=/home/sandbox/.openclaw/workspace/memory/procedural
CELIA_TENANT_ID=default
CELIA_AGG_CHECK_INTERVAL=300000
CELIA_DREAMING_ENABLED=false

# GSPD 兼容别名
GSPD_LOG_LEVEL=${CELIA_LOG_LEVEL}
GSPD_LOG_FILE=${CELIA_LOG_FILE}
GSPD_VECTOR_DIM=${CELIA_VECTOR_DIM}
GSPD_CHAT_UID=${CELIA_CHAT_UID}
GSPD_EMBED_UID=${CELIA_EMBED_UID}
GSPD_PROCEDURAL_DIR=${CELIA_PROCEDURAL_DIR}
GSPD_TENANT_ID=${CELIA_TENANT_ID}

# OpenAI 兼容配置
OPENAI_EMBED_API_KEY=<api_key>
OPENAI_EMBED_BASE_URL=https://api.openai.com
OPENAI_EMBED_MODEL=text-embedding-3-small
OPENAI_CHAT_API_KEY=<api_key>
OPENAI_CHAT_BASE_URL=https://api.openai.com
OPENAI_CHAT_MODEL=gpt-4o-mini

# Rerank 配置 (可选)
OPENAI_RERANK_API_KEY=<api_key>
OPENAI_RERANK_BASE_URL=https://api.fireworks.ai/inference
OPENAI_RERANK_MODEL=accounts/fireworks/models/qwen3-reranker-8b
```

### 3.4 工具列表 (16 个)

| 类别 | 工具 |
|------|------|
| **核心记忆** | `memory_store`, `memory_forget`, `memory_list` |
| **场景记忆** | `memory_scene_load`, `memory_scene_list_load` |
| **原子事实** | `memory_record_search` |
| **原始会话** | `memory_chat_history_search` |
| **全局概览** | `memory_get_global_summary` |
| **管理** | `memory_flush`, `memory_dump` |
| **Dream** | `dream_status`, `dream_run_summary`, `dream_recent_runs`, `dream_trigger_now`, `dream_enable` |

---

## 四、双环境共存配置 (v1.9.1)

### 4.1 celiaBridge 配置

```jsonc
{
  "celiaBridge": {
    "enabled": false,           // 默认关闭；仅在 coexist 模式下生效
    "mode": "delegate",         // delegate | read-only
    "serverBinaryPath": "",     // delegate 模式用；留空自动探测
    "dbPath": "~/.openclaw/workspace/memory/celia_memory/celia_memory.db"
  }
}
```

### 4.2 模式说明（已实现，真实可用）

| 模式 | 行为 | 附加工具 | 适用场景 |
|------|------|----------|----------|
| `enabled: false` | yaoyao 使用独立存储，不与 celia 交互；40 个主表工具正常工作 | 无 | 空环境，或占槽时只想用 yaoyao 独立工具 |
| `mode: "delegate"` | spawn celia MCP server，重叠工具（save/search/forget/list）**委托 celia 执行**（单一数据源，失败自动 fallback 回 yaoyao）；额外暴露 celia 独有能力 | 7 个 `[via celia]` proxy 工具 | memory-celia 占槽，想统一数据源 + 用 dream/scene |
| `mode: "read-only"` | **不 spawn 服务**，以 `readOnly=true` 打开 celia 库，只读查询；零进程开销、最安全 | 1 个 `memory_celia_browse` 工具 | 只想分析 celia 数据、不想启动服务；或二进制不可得 |

**自动降级**：`delegate` 模式下若 celia 二进制找不到，自动降级为 `read-only`，保证桥仍有价值。

### 4.3 自动检测机制（实际代码逻辑）

```
启动时（app.ts bootstrap）:
  1. 读取 ~/.openclaw/openclaw.json 的 slots.memory
  2. 若 slot 被任何非 yaoyao-memory 的插件占用（→ coexist 模式）:
       强制 config.capture.enabled = false       （避免与持槽者双写 L0）
       强制 config.recall.enabled = false         （避免双注入 prompt）
       强制 config.hooks.heartbeat.enabled = false
       保留 command-new hook（仅会话边界清理，无副作用）
       ⚠️ 即使你在配置里写了 capture.enabled=true，coexist 下也会被覆盖为 false
  3. 若 slot = yaoyao-memory 或无 slot（→ standalone 模式）:
       所有 hook 正常启用，零行为变化
  4. 工具注册阶段（tools/index.ts）:
       若 coexist 且 celiaBridge.enabled=true:
         按 mode (delegate/read-only) 注入对应附加工具（见 §4.2）
       否则: 只注册主表工具
```

> **关键**：hook 降级在 `app.ts`，工具附加在 `tools/index.ts`，两段独立。即使不开 celiaBridge，coexist 模式下 hook 也会自动降级（避免冲突），只是不附加 celia 工具。

---

## 五、切换策略

### 5.1 切换到 yaoyao-memory（yaoyao 主导）

```json
{
  "plugins": {
    "slots": {
      "memory": "yaoyao-memory"
    },
    "entries": {
      "yaoyao-memory": {
        "enabled": true,
        "hooks": { "allowConversationAccess": true }
      },
      "memory-celia": { "enabled": true }
    }
  }
}
```

此配置下 yaoyao 进入 standalone，capture/recall/heartbeat 全开。

### 5.2 切换到 memory-celia（celia 主导，yaoyao 退守）

```json
{
  "plugins": {
    "slots": {
      "memory": "memory-celia"
    },
    "entries": {
      "yaoyao-memory": {
        "enabled": true,
        "hooks": { "allowConversationAccess": true }
      },
      "memory-celia": {
        "enabled": true,
        "hooks": { "allowConversationAccess": true },
        "config": {
          "serverBinaryPath": "/home/sandbox/.openclaw/extensions/celia_memory/install/current/bin/celia_memory_mcp_server",
          "dbPath": "/home/sandbox/.openclaw/workspace/memory/celia_memory/celia_memory.db"
        }
      }
    }
  }
}
```

此配置下 yaoyao 自动 coexist，hook 降级；若要附加 celia 工具，在 yaoyao-memory 的 config 里加 `celiaBridge`（见 §6.3）。

### 5.3 重启命令

```bash
# 重启 Gateway
python3 -m supervisor.supervisorctl restart openclaw-gateway

# 检查状态
openclaw status
```

---

## 六、推荐配置

### 6.1 纯 yaoyao-memory 配置（standalone）

```json
{
  "plugins": {
    "slots": { "memory": "yaoyao-memory" },
    "entries": {
      "yaoyao-memory": {
        "enabled": true,
        "hooks": { "allowConversationAccess": true },
        "config": {
          "capture": { "enabled": true, "mode": "async" },
          "recall": { "enabled": true, "strategy": "hybrid" },
          "embedding": {
            "enabled": true,
            "provider": "openai",
            "baseUrl": "https://api.openai.com",
            "apiKey": "${OPENAI_EMBED_API_KEY}",
            "model": "text-embedding-3-small"
          },
          "cloud": { "enabled": true, "autoSync": true }
        }
      }
    }
  }
}
```

### 6.2 纯 memory-celia 配置

```json
{
  "plugins": {
    "slots": { "memory": "memory-celia" },
    "entries": {
      "memory-celia": {
        "enabled": true,
        "hooks": { "allowConversationAccess": true },
        "config": {
          "serverBinaryPath": "/home/sandbox/.openclaw/extensions/celia_memory/install/current/bin/celia_memory_mcp_server",
          "dbPath": "/home/sandbox/.openclaw/workspace/memory/celia_memory/celia_memory.db",
          "embed": {
            "baseUrl": "https://api.openai.com",
            "apiKey": "${OPENAI_EMBED_API_KEY}",
            "model": "text-embedding-3-small"
          },
          "dreamingEnabled": false
        }
      }
    }
  }
}
```

### 6.3 双环境共存配置（推荐 · delegate 模式）

```json
{
  "plugins": {
    "slots": { "memory": "memory-celia" },
    "entries": {
      "yaoyao-memory": {
        "enabled": true,
        "hooks": { "allowConversationAccess": true },
        "config": {
          "celiaBridge": {
            "enabled": true,
            "mode": "delegate"
          }
        }
      },
      "memory-celia": {
        "enabled": true,
        "hooks": { "allowConversationAccess": true },
        "config": {
          "serverBinaryPath": "/home/sandbox/.openclaw/extensions/celia_memory/install/current/bin/celia_memory_mcp_server",
          "dbPath": "/home/sandbox/.openclaw/workspace/memory/celia_memory/celia_memory.db",
          "embed": {
            "baseUrl": "https://api.openai.com",
            "apiKey": "${OPENAI_EMBED_API_KEY}",
            "model": "text-embedding-3-small"
          }
        }
      }
    }
  }
}
```

### 6.4 双环境共存 · read-only 模式（最轻量）

当不需要启动 celia MCP 服务、只想读 celia 库做分析时：

```json
{
  "plugins": {
    "slots": { "memory": "memory-celia" },
    "entries": {
      "yaoyao-memory": {
        "enabled": true,
        "hooks": { "allowConversationAccess": true },
        "config": {
          "celiaBridge": {
            "enabled": true,
            "mode": "read-only"
          }
        }
      }
    }
  }
}
```

此模式注册 `memory_celia_browse` 工具，支持 `source` 参数查询 `atomic`/`conversation`/`global`/`scene` 四类 celia 数据，全程只读。

---

## 七、数据库位置

| 系统 | 路径 |
|------|------|
| **yaoyao-memory** | `~/.openclaw/memory/main.sqlite` |
| **memory-celia** | `~/.openclaw/workspace/memory/celia_memory/celia_memory.db` |

---

## 八、日志位置

| 系统 | 路径 |
|------|------|
| **yaoyao-memory** | `~/.openclaw/logs/yaoyao-memory/` |
| **memory-celia** | `~/.openclaw/logs/celia_memory/celia_memory.log` |
| **Guardian** | `~/.openclaw/logs/guardian.log` |
| **Supervisor** | `~/.openclaw/logs/supervisord.log` |

---

## 九、故障排查

### 9.1 yaoyao-memory 常见问题

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| coexist 下 capture 不工作 | `slots.memory` 被他人占用，app.ts 强制关 hook | 预期行为；若要 yaoyao 主导捕获，把 `slots.memory` 设为 `yaoyao-memory` |
| 搜索无结果 | embedding 未启用 | 配置 `embedding.enabled = true` |
| 向量搜索慢 | sqlite-vec 性能限制 | 安装 hnswlib-node |
| celia 委托失败 | celia 服务未运行或二进制缺失 | 委托会自动 fallback 回 yaoyao；检查日志 `[yaoyao:celia]` |

### 9.2 memory-celia 常见问题

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| MCP 连接失败 | 二进制不可执行 | `chmod +x celia_memory_mcp_server` |
| 搜索无结果 | API Key 未配置 | 检查 `OPENAI_EMBED_API_KEY` |
| 写入失败 | 数据库路径不存在 | 创建 `~/.openclaw/workspace/memory/` |

### 9.3 celiaBridge 模式选择

| 现象 | 推荐模式 |
|------|----------|
| 想用 dream/scene/global + 统一数据源 | `delegate` |
| 只想分析 celia 数据，不启动服务 | `read-only` |
| 完全不需要 celia | `enabled: false` |

---

## 十、版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| **yaoyao-memory v1.9.1** | 2026-06-28 | 双环境共存 (celiaBridge delegate + read-only 两模式) |
| **yaoyao-memory v1.9.0** | 2026-06-14 | 稳定版 |
| **memory-celia v2026-06-25-rc8** | 2026-06-25 | 候选版本 |

---

*文档生成时间: 2026-06-28 · 与 beta 分支 v1.9.1 实现核对一致*
