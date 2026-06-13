# Features — 23 个记忆工具

每个工具一个目录，目录名即工具类别。

## Search（搜索类）

| 工具 | 文件 | 说明 |
|---|---|---|
| `memory_search` | `search/tool.ts` | FTS5 全文搜索，按相关性排序 |
| `memory_get` | `get/tool.ts` | 读取单条记忆文件内容 |
| `memory_list` | `list/tool.ts` | 列出记忆文件列表（分页） |
| `memory_search_timeline` | `search-timeline/tool.ts` | 按时间范围搜索 |
| `memory_search_enhanced` | `enhanced-search/tool.ts` | 向量重排序 + 关键词高亮 |

## Management（管理类）

| 工具 | 文件 | 说明 |
|---|---|---|
| `memory_save` | `save/tool.ts` | 保存单轮对话到记忆 |
| `memory_note` | `note/tool.ts` | 添加笔记到记忆 |
| `memory_forget` | `forget/tool.ts` | 删除指定记忆 |
| `memory_tag` | `tag/tool.ts` | 标签管理（增删查） |
| `memory_backup` | `backup/tool.ts` | 备份记忆数据 |
| `memory_export` | `export/tool.ts` | 导出为 JSONL |
| `memory_cloud_sync` | `cloud-sync/tool.ts` | 云同步（WebDAV/S3/SFTP/Samba） |
| `memory_unify` | `unify/tool.ts` | 跨后端统一状态查看 |

## Import（导入类）

| 工具 | 文件 | 说明 |
|---|---|---|
| `memory_import` | `import/tool.ts` | 从 JSONL 导入 |
| `memory_import_oc` | `import-oc/tool.ts` | 导入 OpenClaw 原生 chunks |
| `memory_import_workspace` | `import-workspace/tool.ts` | 导入 workspace Markdown |

## Analysis（分析类）

| 工具 | 文件 | 说明 |
|---|---|---|
| `memory_stats` | `stats/tool.ts` | 存储统计 |
| `memory_timeline` | `timeline/tool.ts` | 时间线查看 |
| `memory_trends` | `trends/tool.ts` | 话题趋势分析 |
| `memory_quality` | `quality/tool.ts` | 质量评估 + 去重检测 |
| `memory_retain` | `retain/tool.ts` | 遗忘风险检测 + 强化 |
| `memory_graph` | `graph/tool.ts` | 关联图谱构建 |

## System（系统类）

| 工具 | 文件 | 说明 |
|---|---|---|
| `memory_recommend` | `recommend/tool.ts` | 记忆推荐（随机/稀疏/趋势） |
| `memory_remind` | `remind/tool.ts` | 定时提醒（自然语言 → cron） |
| `memory_healthcheck` | `healthcheck/tool.ts` | 健康检查 |

---

## 设计原则

- **零重复**：每个工具一个目录，目录名即工具名。
- **依赖方向**：`features/ → core/` 和 `features/ → utils/`、`features/ → platform/`。
- **core/ 层**：纯算法，零平台依赖（无 `fs`/`path`/SQLite）。
- **错误处理**：所有 `execute` 均包裹 `withErrorHandling`。
