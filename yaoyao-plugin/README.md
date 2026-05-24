# Yaoyao Memory Plugin

自适应记忆引擎：FTS5 + 向量搜索 + 时间线 + 云备份 + 知识图谱

## 版本

**v1.7.2** — 代码质量优化版

## 核心特性

- **23 个记忆工具**：搜索、管理、导入、分析、系统全覆盖
- **4 层记忆架构**：L0 Markdown → L1 FTS5 → L2 向量 → L3 图谱
- **双环境兼容**：标准 OpenClaw / 扩展架构兼容
- **零外部依赖**：核心零 npm 依赖，仅可选 sqlite-vec
- **智能召回**：意图感知评分 + 多信号融合 + 时间衰减
- **防幻觉验证**：LLM 辅助的事实核查
- **自动分层**：Core / Working / Peripheral 三层晋升机制

## 系统要求

- **Node.js >= 16.0.0**（核心功能）；**>= 18.0.0**（网络功能：遥测、LLM、云同步）
- 平台层自动选择后端：
  - `node:sqlite`（Node 22+ 原生）
  - `better-sqlite3`（Node 18/20）
  - `file-db`（纯文件回退，任意版本）

## 快速开始

### 安装

```bash
npm install yaoyao-memory-plugin
```

### 配置

```json
{
  "capture": { "enabled": true, "mode": "async" },
  "recall": { "enabled": true, "strategy": "hybrid", "topK": 5 },
  "embedding": { "enabled": false }
}
```

### 使用

```typescript
import { bootstrapYaoyao } from 'yaoyao-memory-plugin';

const plugin = bootstrapYaoyao(api, config);
```

## 功能详解

### 搜索类（5 个工具）

| 工具 | 说明 |
|---|---|
| `memory_search` | FTS5 全文搜索，按相关性排序 |
| `memory_search_enhanced` | 向量重排序 + 关键词高亮 |
| `memory_search_timeline` | 按时间范围搜索 |
| `memory_multi_signal` | 多信号融合搜索 |
| `memory_call` | 结构化 MemoryCall 查询 |

### 管理类（8 个工具）

| 工具 | 说明 |
|---|---|
| `memory_save` | 保存对话到记忆 |
| `memory_note` | 添加笔记 |
| `memory_forget` | 删除记忆 |
| `memory_tag` | 标签管理 |
| `memory_backup` | 备份数据 |
| `memory_export` | 导出 JSONL |
| `memory_import` / `memory_import_oc` / `memory_import_workspace` | 多源导入 |
| `memory_cloud_sync` | WebDAV / S3 / SFTP / Samba 云同步 |

### 分析类（5 个工具）

| 工具 | 说明 |
|---|---|
| `memory_stats` | 存储统计 |
| `memory_timeline` | 时间线查看 |
| `memory_trends` | 话题趋势分析 |
| `memory_quality` | 质量评估 + 去重检测 |
| `memory_retain` | 遗忘风险检测 + 强化 |

### 系统类（5 个工具）

| 工具 | 说明 |
|---|---|
| `memory_recommend` | 记忆推荐（随机/稀疏/趋势） |
| `memory_remind` | 定时提醒（自然语言 → cron） |
| `memory_healthcheck` | 健康检查 |
| `memory_graph` | 关联图谱构建 |
| `memory_unify` | 跨后端统一状态 |

## 架构设计

```
┌─────────────────────────────────────────┐
│  features/          工具实现层            │
├─────────────────────────────────────────┤
│  core/              纯算法层（零依赖）    │
├─────────────────────────────────────────┤
│  utils/             工具函数              │
├─────────────────────────────────────────┤
│  storage/           存储层               │
│    ├── FTS5 全文索引                      │
│    ├── sqlite-vec 向量搜索（可选）        │
│    └── Hybrid 混合搜索（RRF/加权）        │
├─────────────────────────────────────────┤
│  platform/          平台抽象             │
│    ├── node:sqlite（Node 22+ 原生）    │
│    ├── better-sqlite3（Node 18/20 兼容）│
│    └── file-db（纯文件回退）             │
├─────────────────────────────────────────┤
│  hooks/             OpenClaw 钩子        │
│    ├── auto-capture   自动捕获           │
│    ├── auto-recall    自动召回           │
│    ├── command-new    会话边界清理       │
│    └── heartbeat      心跳记忆注入       │
└─────────────────────────────────────────┘
```

## 开发规范

- **200 行红线**：单个文件不超过 200 行
- **kebab-case**：文件名全小写连字符分隔
- **工厂函数**：禁止闭包依赖，所有依赖通过参数传入
- **错误处理**：`e instanceof Error ? e.message : String(e)`
- **日志前缀**：`[yaoyao-memory:组件名]` 格式

详见 [开发指南](DEVELOPER_GUIDE.md)

## 文档

- [功能列表](features/README.md)
- [开发指南](DEVELOPER_GUIDE.md)
- [安全说明](SECURITY.md)

## 许可证

MIT
