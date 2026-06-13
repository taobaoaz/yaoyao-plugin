# yaoyao-memory vs 小艺 Claw 架构冲突分析报告

## 发现的关键信息

小艺 Claw 已有完整的 yaoyao 集成方案（`memory-unification-plan.md`）：

### 小艺 Claw 的记忆架构

```
XiaoYiClawLLM.remember()
  ├── 向量库（FAISS/Qdrant）— 主存储
  ├── XiaoyiMemoryV2 — 增强检索
  ├── DAG 上下文管理器 — 会话摘要
  └── Yaoyao .yaoyao.db — FTS5 + vec（第三路）

XiaoYiClawLLM.recall()
  1. 向量 FAISS 检索（主路）
  2. XiaoyiMemoryV2 增强检索（辅路）
  3. Yaoyao 混合搜索（新）
     ├── FTS5 全文检索
     ├── Vector 初筛
     ├── RRF 融合候选池（limit × 3）
     └── bge-reranker-v2-m3 重排序 → top_k
  └── 三路 RRF 融合输出
```

## 冲突点分析

### 1. Hook 系统冲突 ⚠️ HIGH

| 系统 | Hook 机制 | 冲突描述 |
|------|----------|----------|
| **OpenClaw** | `agent_end`, `before_prompt_build`, `gateway_stop` | 标准事件驱动 |
| **小艺 Claw** | `onAgentEnd`, `onBeforePrompt`, `onGatewayStop` | 回调函数注册 |
| **小艺 Claw** | 人格注入 Hook（`HOOK.md`） | 自动注入 IDENTITY.md/SOUL.md |

**风险**：
- yaoyao 的 `before_prompt_build` 注入记忆 vs 小艺的 `onBeforePrompt` 注入人格 → 可能重复注入或覆盖
- yaoyao 的 `agent_end` 捕获对话 vs 小艺的 DAG 上下文管理 → 双重捕获，数据冗余

### 2. 记忆存储冲突 ⚠️ HIGH

| 后端 | 角色 | 冲突描述 |
|------|------|----------|
| **Yaoyao .yaoyao.db** | FTS5 + sqlite-vec | 本地索引 |
| **腾讯云 memory-tencentdb** | FAISS 高维向量 | 云端/本地备份 |
| **本地 memory/*.md** | 人类可读日志 | yaoyao 的 L0 |

**风险**：
- 小艺 Claw 的 `remember()` 同时写入三处，yaoyao 的 `agent_end` 也写入 → **同一对话重复存储**
- 小艺的 FAISS 向量空间 vs yaoyao 的 sqlite-vec 向量空间 → **向量维度/模型可能不同**
- 三路 RRF 融合时，yaoyao 的搜索结果可能被小艺的 reranker 重新排序 → **结果不一致**

### 3. 配置系统冲突 ⚠️ MEDIUM

| 系统 | 配置方式 | 冲突描述 |
|------|----------|----------|
| **OpenClaw** | `openclaw.json` + `pluginConfig` | 标准插件配置 |
| **小艺 Claw** | `config/system_config.json` | 系统级配置 |
| **小艺 Claw** | `supervisor/supervisord.conf` | 进程管理配置 |

**风险**：
- yaoyao 的配置项（`capture.enabled`, `recall.maxResults`）可能与小艺的配置冲突
- 小艺的 `performance_config.json` 可能限制 yaoyao 的资源使用

### 4. 工具注册冲突 ⚠️ MEDIUM

| 系统 | 工具数量 | 冲突描述 |
|------|----------|----------|
| **yaoyao** | 34+ 工具 | `memory_search`, `memory_save` 等 |
| **小艺 Claw** | 未知数量 | 可能也有记忆相关工具 |

**风险**：
- 工具 ID 冲突（如果小艺也有 `memory_search`）
- 工具描述冲突（用户困惑）

### 5. 人格/心理学模型冲突 ⚠️ MEDIUM

| 系统 | 人格管理 | 冲突描述 |
|------|----------|----------|
| **yaoyao** | `persona.md` + PersonaStateMachine | mood/energy/trust 计算 |
| **小艺 Claw** | `IDENTITY.md` + `SOUL.md` | Core Truths 注入 |

**风险**：
- yaoyao 的 PersonaStateMachine 调整语气 vs 小艺的人格注入 → **语气不一致**
- yaoyao 的 L3 用户画像 vs 小艺的 IDENTITY.md → **用户画像分裂**

## 建议的适配策略

### 方案 A：检测到小艺 Claw 时，yaoyao 降级为"纯搜索层"

```typescript
if (isXiaoYiClaw()) {
  // 禁用 yaoyao 的 capture/recall hooks
  // 只保留 memory_search 工具作为第三路搜索
  // 让小艺的 remember()/recall() 主导
}
```

**优点**：避免重复存储，利用小艺的三路融合
**缺点**：yaoyao 失去自动捕获能力

### 方案 B：检测到小艺 Claw 时，接管小艺的记忆写入

```typescript
if (isXiaoYiClaw()) {
  // 拦截小艺的 remember()，统一写入 yaoyao
  // yaoyao 成为唯一记忆后端
}
```

**优点**：统一存储，避免冗余
**缺点**：改动大，可能破坏小艺的其他功能

### 方案 C：双轨并行，数据同步

```typescript
if (isXiaoYiClaw()) {
  // yaoyao 正常捕获，同时同步到小艺的 FAISS
  // 搜索时优先使用 yaoyao，小艺作为备份
}
```

**优点**：保持 yaoyao 完整性，兼容小艺
**缺点**：数据冗余，同步复杂

## 当前适配代码状态

- ✅ 环境检测：`utils/environment-detector.ts`
- ✅ API 适配：`entry/xiaoyi-adapter.ts`
- ⚠️ Hook 适配：基础映射，未处理冲突
- ⚠️ 存储适配：未实现
- ⚠️ 配置适配：未实现

## 下一步建议

1. **测试环境搭建**：在小艺 Claw 中安装 yaoyao，观察实际冲突
2. **Hook 冲突解决**：确定 yaoyao 在小艺中的角色（主导/辅助/禁用）
3. **存储同步**：如果选择双轨，需要写同步桥接代码
4. **配置合并**：统一配置格式，或明确优先级

## 相关文件

- 小艺桥接：`workspace-scripts/yaoyao_bridge.py`
- 统一方案：`workspace-scripts/memory-unification-plan.md`
- 小艺 Hook：`hooks/HOO.md`（人格注入）
- 小艺配置：`config/system_config.json`
