# yaoyao-memory 安装向导

> 版本: v1.9.2  
> 适用: OpenClaw 标准环境 / 小艺 Claw（含 memory-celia 共存）  
> 本文与 beta 分支实际代码逐项核对，每一步均可执行。

---

## 目录

1. [环境要求](#一环境要求)
2. [快速开始（5 分钟）](#二快速开始5-分钟)
3. [三种部署场景](#三三种部署场景)
4. [安装后的验证](#四安装后的验证)
5. [配置详解](#五配置详解)
6. [memory-celia 共存配置](#六memory-celia-共存配置)
7. [升级](#七升级)
8. [排错](#八排错)
9. [文件与数据位置](#九文件与数据位置)

---

## 一、环境要求

| 项目 | 要求 | 验证命令 |
|------|------|----------|
| **Node.js** | ≥ 18.0.0（推荐 20+，向量搜索用 22+ 的 `node:sqlite`） | `node -v` |
| **OpenClaw** | pluginApi ≥ 2026.4.2 | `openclaw --version` |
| **操作系统** | Linux / macOS / Windows | — |
| **磁盘** | ≥ 50 MB（含依赖） | — |

**可选依赖**（按需）：

| 依赖 | 用途 | 何时需要 |
|------|------|----------|
| `sqlite-vec` | 默认向量后端 | 启用 `embedding.enabled` 时（已随包安装） |
| `hnswlib-node` | 高性能 ANN | 记忆量大（>1万条）且需要更快向量搜索 |
| OpenAI API Key | 向量嵌入 + LLM 管线（L1/L2/L3） | 启用 embedding 或 llm 时 |
| 云存储凭证 | 云备份 | 启用 `cloud.autoSync` 时 |

> yaoyao 默认零外部网络依赖（本地优先）。上述 API Key 只在对应功能启用时才使用。

---

## 二、快速开始（5 分钟）

### 步骤 1：安装插件

**方式 A：OpenClaw 官方安装（推荐）**

```bash
openclaw plugin install git+https://github.com/taobaoaz/yaoyao-plugin.git
```

> ⚠️ 当前 v1.9.2 在 `beta` 分支。若官方 registry 还在 1.9.0，用方式 B 指定 beta。

**方式 B：从 beta 分支安装（获取 v1.9.2 共存能力）**

```bash
openclaw plugin install git+https://github.com/taobaoaz/yaoyao-plugin.git#beta
```

**方式 C：本地开发 / 手动安装**

```bash
git clone -b beta https://github.com/taobaoaz/yaoyao-plugin.git
cd yaoyao-plugin
npm install
npm run build          # 必须构建，dist/ 才是运行时入口
npm run dist-check     # 确认 dist/ 与 src/ 同步（应输出全部 ✅）
# 然后把本目录软链/复制到 OpenClaw extensions 目录
```

### 步骤 2：确认安装成功

```bash
openclaw plugin list | grep yaoyao
# 应输出：yaoyao-memory  1.9.2  enabled
```

### 步骤 3：重启 Gateway

```bash
python3 -m supervisor.supervisorctl restart openclaw-gateway
# 或
openclaw restart
```

### 步骤 4：查看启动日志

启动成功会看到：

```
🎲 ══════════════════════════════════════════
🎲    摇摇 · 记忆引擎已启动
🎲    v1.9.2  ·  40 Tools  ·  4 Hooks
🎲    FTS5 + sqlite-vec + 时间线 + 云备份
🎲    记忆目录: ~/.openclaw/workspace/memory/
🎲    环境检测: 全部通过
🎲 ══════════════════════════════════════════
```

看到这个 banner = 安装成功。接下来按 [§三](#三三种部署场景) 选择你的部署场景。

---

## 三、三种部署场景

### 场景 A：纯 yaoyao（yaoyao 作为唯一记忆引擎）

**适用**：空环境，或不需要 memory-celia 的能力。

编辑 `~/.openclaw/openclaw.json`：

```jsonc
{
  "plugins": {
    "slots": {
      "memory": "yaoyao-memory"          // ← yaoyao 占槽
    },
    "entries": {
      "yaoyao-memory": {
        "enabled": true,
        "hooks": { "allowConversationAccess": true },
        "config": {
          "capture": { "enabled": true, "mode": "async" },
          "recall": { "enabled": true, "strategy": "hybrid" }
          // 可选：开启向量搜索
          // "embedding": {
          //   "enabled": true,
          //   "provider": "openai",
          //   "apiKey": "${OPENAI_EMBED_API_KEY}",
          //   "model": "text-embedding-3-small"
          // }
        }
      }
    }
  }
}
```

重启后验证：banner 显示 `4 Hooks`，且日志**不**出现 `COEXIST mode`。

### 场景 B：纯 memory-celia（celia 主导，不装 yaoyao 或禁用）

```jsonc
{
  "plugins": {
    "slots": {
      "memory": "memory-celia"
    },
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
          }
        }
      },
      "yaoyao-memory": {
        "enabled": true,
        "hooks": { "allowConversationAccess": true }
        // 不配 celiaBridge → yaoyao 用自己独立的库，40 工具照常可用
      }
    }
  }
}
```

> 此场景下 yaoyao 自动进入 coexist 模式，关闭 capture/recall/heartbeat（避免和 celia 双写/双注入），但 40 个工具仍可按需调用。

### 场景 C：双环境共存（推荐 · celia 主导 + yaoyao 增强）

在场景 B 基础上，给 yaoyao 开启 `celiaBridge`：

```jsonc
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
            "mode": "delegate"            // delegate | read-only（"readonly" 为别名等价）
            // "serverBinaryPath": "",     // delegate 模式用，留空自动探测
            // "dbPath": "~/.openclaw/workspace/memory/celia_memory/celia_memory.db"
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

**共存模式下 yaoyao 的行为**：

| 组件 | 行为 |
|------|------|
| auto-capture（L0 写入） | ❌ 自动关闭（celia 负责 L0，避免双写） |
| auto-recall（prompt 注入） | ❌ 自动关闭（避免双注入） |
| heartbeat-recall | ❌ 自动关闭 |
| command-new（会话清理） | ✅ 保留（无副作用） |
| 40 个主表工具 | ✅ 全部保留 |

---

## 四、安装后的验证

### 4.0 首次对话自动引导（v1.9.1 新增）

yaoyao 装上后会**自主发现**配置状态，并在**第一次对话**主动给 agent 注入一条引导提示。agent 收到后会向用户说明当前状态和下一步。这是零配置的——你不需要手动触发。

**何时会出现引导**（满足任一即提示一次）：
- 共存模式下 `celiaBridge` 未开启
- 记忆库为空（首次使用）
- 向量搜索未启用（可优化召回质量）
- 环境能力有警告（如 Node 版本低）

**何时不会打扰你**：
- 配置完全就绪（无任何优化项）
- 同一配置状态已经提示过（状态文件记录，不重复打扰）
- 配置发生实质变化后（如你开了 celiaBridge），会**再提示一次**

**想随时复查配置状态**：

```bash
openclaw tool call memory_setup
# 返回结构化自检报告：运行模式 / 共存桥 / 向量 / 数据量 / 优化建议 + 本向导路径
```

引导提示示例（首次对话时 agent 会看到）：

```
🎲 [yaoyao-memory 首次使用提示]
当前模式：共存（槽位被 memory-celia 占用）

• 检测到 memory-celia 占用记忆槽位
  → 在 openclaw.json 的 yaoyao-memory.config 中添加："celiaBridge": ...

完整安装向导：docs/install-guide.md
（如需复查配置状态，可调用 memory_setup 工具）
```

### 4.1 基础验证（所有场景）

```bash
# 1. 确认插件加载
openclaw plugin list | grep yaoyao

# 2. 健康检查
openclaw tool call memory_healthcheck
# 期望输出：数据库 OK / 配置 OK / 缓存 OK
```

### 4.2 共存模式验证（场景 B/C）

查看启动日志，应出现：

```
[yaoyao-memory] COEXIST mode — memory slot owned by "memory-celia".
                auto-capture / auto-recall / heartbeat hooks DISABLED to avoid conflict.
                40 tools remain active as on-demand layer.
```

**如果没看到这行**：说明 slot 没配对，或 yaoyao 在加载前就被 Gateway 因 kind 冲突禁用。见 [§八 排错](#八排错)。

### 4.3 桥接模式验证（场景 C）

```bash
# delegate 模式：应看到 7 个 proxy 工具
openclaw tool list | grep "via celia"
# 期望：memory_dream_status, memory_dream_trigger, memory_dream_summary,
#       memory_scene_load, memory_scene_list, memory_global_summary, memory_flush_celia

# read-only 模式：应看到 1 个 browse 工具
openclaw tool call memory_celia_browse '{"source":"scene"}'
# 期望：返回 celia L1 场景索引
```

日志会明确提示当前模式：

```
[yaoyao-memory] celia bridge DELEGATE — 7 proxy tools added, overlapping tools delegate to celia
# 或
[yaoyao-memory] celia bridge READ-ONLY — memory_celia_browse registered (db: ...)
```

### 4.4 数据验证

```bash
# 存一条记忆
openclaw tool call memory_save '{"content":"测试记忆：用户喜欢咖啡"}'

# 搜回来
openclaw tool call memory_search '{"query":"咖啡"}'
# 期望：返回刚存的记忆
```

---

## 五、配置详解

### 5.1 celiaBridge 模式选择

| 你的需求 | 推荐配置 |
|----------|----------|
| 不需要 celia，纯用 yaoyao | `celiaBridge.enabled = false`（或不配） |
| 想统一数据源 + 用 dream/scene/global | `enabled: true, mode: "delegate"` |
| 只想分析 celia 数据，不启动服务 | `enabled: true, mode: "read-only"` |
| delegate 模式但 celia 二进制找不到 | 自动降级为 read-only（无需手动改） |

> **mode 容错**：`read-only` / `readonly` / `read_only`（任意大小写、连字符/下划线）都会被识别为只读模式，照任何配置文档填写都不会出错。

### 5.2 启用向量搜索（可选，提升召回质量）

```jsonc
"embedding": {
  "enabled": true,
  "provider": "openai",
  "apiKey": "${OPENAI_EMBED_API_KEY}",
  "model": "text-embedding-3-small",
  "dimensions": 1024,
  "vectorBackend": "sqlite-vec"        // 默认零依赖；记忆量大可换 "hnswlib"
}
```

### 5.3 启用 LLM 管线（可选，L1 原子事实抽取 / L2 语义合并）

```jsonc
"llm": {
  "enabled": true,
  "apiKey": "${OPENAI_CHAT_API_KEY}",
  "model": "gpt-4o-mini"
}
```

> 未配置 llm 时会自动复用 embedding 的 apiKey/baseUrl。

### 5.4 环境变量

| 变量 | 作用 |
|------|------|
| `OPENAI_EMBED_API_KEY` | 向量嵌入 API Key |
| `OPENAI_CHAT_API_KEY` | LLM API Key |
| `OPENCLAW_HOME` | OpenClaw 安装根（影响 celia 二进制探测） |
| `OPENCLAW_CONFIG_PATH` | openclaw.json 路径 |
| `YAOYAO_TELEMETRY=0` | 关闭本地遥测心跳 |

---

## 六、memory-celia 共存配置

完整共存机制说明见 [docs/coexistence-config.md](./coexistence-config.md)。这里只列关键点：

### 6.1 共存自动检测（零配置）

yaoyao 启动时读取 `~/.openclaw/openclaw.json` 的 `slots.memory`：

- 若被**任何非 yaoyao-memory 的插件**占用 → 进入 **coexist 模式**，自动关闭冲突 hook
- 若是 `yaoyao-memory` 或为空 → **standalone 模式**，全功率运行

**这一步不需要任何配置**，装上就行。

### 6.2 桥接模式对比

| 模式 | spawn celia | 附加工具 | 写 celia 库 | 适用 |
|------|------------|----------|------------|------|
| `enabled: false` | 否 | 无 | 否 | 不需要 celia 交互 |
| `delegate` | 是 | 7 个 `[via celia]` | 通过 celia 工具（单一数据源） | 统一数据源 + 用 celia 能力 |
| `read-only` | 否 | 1 个 `memory_celia_browse` | 否（`readOnly=true`） | 只分析 celia 数据 |

### 6.3 安全保证

- 委托失败自动 fallback 回 yaoyao 自实现（celia 故障不中断 yaoyao）
- yaoyao **绝不直接写入** celia 数据库
- read-only 模式以 `readOnly=true` 打开 celia 库

---

## 七、升级

### 7.1 从 1.9.0 升级到 1.9.2

```bash
# 1. 备份现有数据（保险）
cp -r ~/.openclaw/memory ~/.openclaw/memory.bak.$(date +%Y%m%d)

# 2. 更新插件
openclaw plugin install git+https://github.com/taobaoaz/yaoyao-plugin.git#beta

# 3. 重启
python3 -m supervisor.supervisorctl restart openclaw-gateway
```

**1.9.2 向后兼容**：升级后空环境行为零变化。若你之前在 celia 环境被关闭，现在会自动 coexist 降级（不需要改配置）。首次对话会收到一条配置引导提示（仅一次）。

### 7.2 从源码升级（开发）

```bash
cd yaoyao-plugin
git fetch origin
git checkout beta
git pull
npm install
npm run build
npm run dist-check     # 确认同步
npm test               # 应全绿（815 测试）
```

---

## 八、排错

### 8.1 安装类

| 症状 | 原因 | 解决 |
|------|------|------|
| `plugin not found` | beta 分支未发布到 registry | 用 `git+...#beta` 方式安装 |
| `dist-check` 报错 | 忘了 `npm run build` | 跑 `npm run build` 再 `dist-check` |
| 启动报 `Cannot find module` | dist/ 不完整 | 重新 `npm install && npm run build` |
| `sqlite-vec` 加载失败 | Node 版本过低或平台不支持 | 升级 Node ≥18；或关闭 embedding（FTS5 仍可用） |

### 8.2 共存类

| 症状 | 原因 | 解决 |
|------|------|------|
| yaoyao 完全不加载（无 banner） | Gateway 因 `kind:memory` 冲突在加载前禁用 | 确认 `slots.memory` 已设为 `memory-celia` 且 yaoyao 在 entries 里 `enabled:true`；若仍不行，见下方"kind 冲突" |
| 没有 `COEXIST mode` 日志 | slot 没配对，或 yaoyao 被禁用 | 检查 `openclaw.json` 的 `slots.memory` 和 `entries.yaoyao-memory.enabled` |
| capture/recall 不工作 | coexist 模式预期行为 | 这是对的；celia 负责捕获，yaoyao 退守为工具层 |
| celia 委托失败 | celia 服务未运行 / 二进制缺失 | 委托会自动 fallback；检查日志 `[yaoyao:celia]` |

**kind 冲突（极端情况）**：

若目标环境的 Gateway 在 `kind:memory` 层级就硬杀 yaoyao（加载前就禁用），coexist 检测来不及执行。表现为：banner 完全不出现。

排查命令：

```bash
openclaw plugin list --verbose 2>&1 | grep -A3 yaoyao
# 若显示 "disabled (slot conflict)" 即为 kind 级硬杀
```

此时需联系环境管理员，或参考仓库文档把 yaoyao 的 `kind` 改为 `extension`（但这会改变空环境定位，是最后手段）。

### 8.3 数据类

| 症状 | 原因 | 解决 |
|------|------|------|
| 搜索无结果 | embedding 未启用 / 数据为空 | 开 `embedding.enabled`；先用 `memory_save` 存几条 |
| 向量搜索慢 | sqlite-vec brute-force | 装 `hnswlib-node`，设 `vectorBackend: "hnswlib"` |
| 记忆丢失 | cleanup 太激进 | 调大 `cleanup.l0l1RetentionDays`（默认 30） |

### 8.4 celiaBridge 类

| 症状 | 原因 | 解决 |
|------|------|------|
| `memory_celia_browse` 返回空 | celia 库路径不对 / 库为空 | 检查 `celiaBridge.dbPath`；确认 celia 已写入数据 |
| delegate 模式没生效 | mode 拼错 / enabled 没开 | 确认 `enabled:true`；mode 容错但建议写标准 `delegate` 或 `read-only` |
| `celia binary not found` | 二进制路径探测失败 | 显式配 `serverBinaryPath`，或接受自动降级到 read-only |

### 8.5 获取帮助

```bash
# 完整诊断信息
openclaw tool call memory_healthcheck
openclaw tool call memory_telemetry

# 查看日志
tail -f ~/.openclaw/logs/yaoyao-memory/*.log
```

提交 issue 时附上：healthcheck 输出 + 启动日志（含 banner）+ `openclaw.json` 中 plugins 段（隐去 apiKey）。

---

## 九、文件与数据位置

### 9.1 安装位置

| 内容 | 路径 |
|------|------|
| yaoyao 插件 | `~/.openclaw/extensions/yaoyao-memory/` |
| memory-celia 插件 | `~/.openclaw/extensions/celia_memory/` |
| 配置文件 | `~/.openclaw/openclaw.json` |

### 9.2 数据位置

| 系统 | 数据库 |
|------|--------|
| yaoyao-memory | `~/.openclaw/memory/main.sqlite` |
| memory-celia | `~/.openclaw/workspace/memory/celia_memory/celia_memory.db` |

### 9.3 日志位置

| 系统 | 路径 |
|------|------|
| yaoyao-memory | `~/.openclaw/logs/yaoyao-memory/` |
| memory-celia | `~/.openclaw/logs/celia_memory/celia_memory.log` |
| Guardian | `~/.openclaw/logs/guardian.log` |
| Supervisor | `~/.openclaw/logs/supervisord.log` |

### 9.4 备份

```bash
# 完整备份（yaoyao 数据 + 配置）
tar -czf yaoyao-backup-$(date +%Y%m%d).tar.gz \
  ~/.openclaw/memory/ \
  ~/.openclaw/openclaw.json

# 或用内置工具
openclaw tool call memory_backup
```

---

## 附录：决策树

```
你需要记忆系统吗？
│
├─ 否 → 不用装
│
└─ 是 → 你的环境有 memory-celia 吗？
        │
        ├─ 否（空环境） → 场景 A：slots.memory = "yaoyao-memory"，全功率
        │
        └─ 是 → 你需要 celia 的 dream/scene/程序记忆吗？
                │
                ├─ 否 → 场景 B：celia 占槽，yaoyao 用独立库（不开 bridge）
                │
                └─ 是 → 你能启动 celia MCP 服务吗？
                        │
                        ├─ 能 → 场景 C：celiaBridge.mode = "delegate"
                        │
                        └─ 不能 → 场景 C 变体：celiaBridge.mode = "read-only"
```

---

*文档版本: v1.9.2 · 与 beta 分支实现核对一致 · 2026-06-28*
