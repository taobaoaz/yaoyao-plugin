# 迁移指南：从集合版到拆分版

> 适用场景：你之前安装了 `yaoyao-plugin` v1.4.0 或更早版本（含心理学模型、情绪分析、反馈学习等全部功能），现在想升级到拆分后的架构。

---

## 架构变化

| 版本 | 仓库 | 功能 |
|------|------|------|
| **v1.4.0 及之前** | `yaoyao-plugin` 单仓库 | 记忆 + 情绪 + 画像 + 反馈，全部混在一起 |
| **v1.5.0+** | `yaoyao-plugin` + `yaoyao-soul` | plugin 管记忆存取，soul 管观察沉淀 |

---

## 迁移前必读

### ⚠️ 数据保护声明

**`git pull` 只更新代码文件，不会删除或覆盖你的数据。**

用户数据默认存储在 `memory/` 目录和 `.yaoyao.db` 文件中，这些路径**不在 plugin 仓库内部**，因此更新代码时完全不受影响。

但以防万一，建议迁移前手动确认以下数据文件存在：

| 数据文件 | 默认位置 | 说明 |
|----------|----------|------|
| 每日对话日志 | `memory/*.md` | 核心数据，**绝不会被删除** |
| SQLite 数据库 | `memory/.yaoyao.db` 或 `~/.openclaw/...` | 搜索索引，**不会被删除** |
| 隐式标注 | `memory/.implicit-tags.jsonl` | soul 接管，**不会被删除** |
| 反馈记录 | `memory/.feedback.jsonl` | soul 接管，**不会被删除** |
| 用户画像 | `memory/persona.md` | soul 追加笔记，**不覆盖旧内容** |

> 如果你曾手动修改过 `memoryDir` 配置，请确认你的数据实际存储位置。

### 数据兼容性 ✅

| 数据文件 | 迁移后归属 | 是否保留 |
|----------|-----------|----------|
| `memory/*.md` | plugin | ✅ 无缝继承 |
| `.yaoyao.db` | plugin | ✅ 无缝继承 |
| `.implicit-tags.jsonl` | soul | ✅ 自动读取 |
| `persona.md` | soul | ✅ 追加新笔记，不覆盖旧内容 |
| `.persona-state.json` | **废弃** | ⚠️ 可删除，不影响 |
| `.feedback.jsonl` | soul | ✅ 自动读取 |

### 配置变化

```yaml
# ❌ 旧配置（v1.4.0）
yaoyao-plugin:
  psychology: true          # 已废弃
  intervention: true      # 已废弃
  moodTracking: true       # 已废弃

# ✅ 新配置（v1.5.0+）
yaoyao-plugin:
  capture: { enabled: true }
  recall:  { enabled: true }
  # 心理学相关全部移除，交给 yaoyao-soul

yaoyao-soul:
  memoryDir: "./memory"    # 默认，通常不用改
```

---

## 方案一：一键脚本（推荐）

复制粘贴执行：

```bash
#!/bin/bash
set -e

PLUGIN_DIR="${OPENCLAW_PLUGINS_DIR:-$HOME/.openclaw/plugins}"
WORKSPACE_DIR="${OPENCLAW_WORKSPACE:-$HOME/.openclaw/workspace}"
BACKUP_DIR="$HOME/.openclaw/backups/yaoyao-$(date +%Y%m%d-%H%M%S)"

echo "📦 备份数据到 $BACKUP_DIR"
mkdir -p "$BACKUP_DIR"

# 备份 plugin 代码
cp -r "$PLUGIN_DIR/yaoyao-plugin" "$BACKUP_DIR/plugin-code" 2>/dev/null || true

# 备份用户数据（memory 目录）
if [ -d "$WORKSPACE_DIR/memory" ]; then
  cp -r "$WORKSPACE_DIR/memory" "$BACKUP_DIR/memory-data"
  echo "   ✓ 已备份 memory/ 目录"
fi

# 备份数据库（如果在 workspace 根目录）
for db in "$WORKSPACE_DIR"/.yaoyao.db "$WORKSPACE_DIR"/.yaoyao.*.db; do
  [ -f "$db" ] && cp "$db" "$BACKUP_DIR/" && echo "   ✓ 已备份 $(basename "$db")"
done

echo "🔄 更新 yaoyao-plugin 到 v1.5.0+"
cd "$PLUGIN_DIR/yaoyao-plugin"
git fetch origin
git checkout main
git pull origin main

echo "🖤 安装 yaoyao-soul"
cd "$PLUGIN_DIR"
if [ ! -d "yaoyao-soul" ]; then
  git clone https://github.com/taobaoaz/yaoyao-soul.git
else
  echo "yaoyao-soul 已存在，跳过"
fi

echo ""
echo "✅ 迁移完成！"
echo ""
echo "数据安全确认："
echo "  - memory/*.md          → 未变动 ✅"
echo "  - .yaoyao.db           → 未变动 ✅"
echo "  - persona.md           → 追加新内容，不覆盖旧内容 ✅"
echo ""
echo "请重启 OpenClaw Gateway 生效。"
echo ""
echo "回滚命令（万一出问题）："
echo "  rm -rf '$PLUGIN_DIR/yaoyao-plugin'"
echo "  cp -r '$BACKUP_DIR/plugin-code' '$PLUGIN_DIR/yaoyao-plugin'"
```

**执行：**

```bash
curl -fsSL https://raw.githubusercontent.com/taobaoaz/yaoyao-plugin/main/scripts/migrate-to-split.sh | bash
```

---

## 方案二：手动分步

### Step 1：确认数据安全（重要）

先确认你的数据文件位置：

```bash
ls ~/.openclaw/workspace/memory/*.md        # 每日对话日志
ls ~/.openclaw/workspace/.yaoyao.db         # 数据库（文件名可能不同）
ls ~/.openclaw/workspace/memory/persona.md  # 用户画像
ls ~/.openclaw/workspace/memory/.implicit-tags.jsonl  # 隐式标注
```

这些文件**在 workspace 目录下**，不在 plugin 仓库内部，`git pull` 不会碰它们。

如需备份：

```bash
BACKUP_DIR="$HOME/.openclaw/backups/yaoyao-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
cp -r ~/.openclaw/workspace/memory "$BACKUP_DIR/"
cp ~/.openclaw/workspace/.yaoyao.db* "$BACKUP_DIR/" 2>/dev/null || true
echo "数据已备份到 $BACKUP_DIR"
```

### Step 2：更新 plugin

```bash
cd ~/.openclaw/plugins/yaoyao-plugin
git pull origin main
```

验证版本：

```bash
git log --oneline -1
# 应显示 v1.5.0 或更高
```

### Step 3：安装 soul

```bash
cd ~/.openclaw/plugins
git clone https://github.com/taobaoaz/yaoyao-soul.git
```

### Step 4：更新配置

编辑 `~/.openclaw/openclaw.yaml`：

```yaml
plugins:
  yaoyao-plugin:
    capture: { enabled: true }
    recall:  { enabled: true }
    # 删除旧配置：psychology, intervention, moodTracking 等

  yaoyao-soul:
    # 默认配置即可，通常不用改
```

### Step 5：重启 Gateway

```bash
openclaw gateway restart
```

### Step 6：验证

查看日志应出现两个横幅：

```
🎲 摇摇 · 记忆引擎已启动        ← plugin (v1.5.0+)
🖤 摇摇 · 灵魂观察层已启动       ← soul (v1.0.0+)
```

---

## 方案三：仅更新 plugin，暂不装 soul

如果你只想更新 plugin，暂时不需要观察层：

```bash
cd ~/.openclaw/plugins/yaoyao-plugin
git pull origin main
# 重启 Gateway 即可
```

plugin v1.5.0 **独立可用**，只是不再有情绪分析、反馈学习等功能。相当于一个高级日记本 + 搜索引擎。

以后想加 soul 时，随时执行方案一的 Step 3。

---

## 常见问题

### Q1：启动后 soul 的 persona.md 是空的？

正常。soul 刚装上，还没运行过 `memory_distill`。

**解决方案：**
- 等一周，自动沉淀
- 或手动触发：`/call memory_distill`（扫描最近 7 天标签，生成初始观察笔记）

### Q2：之前配置了 LLM pipeline，现在怎么办？

拆分后：
- plugin 的 `llm` 配置仅用于 embedding（向量搜索），不再做 L1/L2/L3 提取
- 如果你想保留 LLM 驱动的画像生成，需要额外配置 soul（见 soul 的 README）
- 如果只是用 FTS5 搜索，可以关掉 LLM：

```yaml
yaoyao-plugin:
  llm: { enabled: false }
```

### Q3：soul 和 plugin 会冲突吗？

不会。设计时已经隔离：
- plugin 的 `before_prompt_build` 注入相关记忆
- soul 的 `before_prompt_build` 注入观察笔记
- 两者都是 **append**（追加），不会覆盖对方

### Q4：如何回滚？

```bash
# 1. 停止 Gateway
openclaw gateway stop

# 2. 恢复备份
rm -rf ~/.openclaw/plugins/yaoyao-plugin
cp -r ~/.openclaw/backups/yaoyao-YYYYMMDD-HHMMSS/yaoyao-plugin \
     ~/.openclaw/plugins/

# 3. 可选：删除 soul
rm -rf ~/.openclaw/plugins/yaoyao-soul

# 4. 重启 Gateway
openclaw gateway start
```

---

## 最低版本要求

| 组件 | 最低版本 |
|------|----------|
| OpenClaw | >= 2026.5.5 |
| Node.js | ^22.0.0 |
| yaoyao-plugin | >= v1.5.0 |
| yaoyao-soul | >= v1.0.0 |

---

## 迁移检查清单

- [ ] 备份了 `yaoyao-plugin` 目录
- [ ] 更新了 plugin 到 v1.5.0+
- [ ] 安装了 `yaoyao-soul`
- [ ] 更新了 `openclaw.yaml`（删除旧配置）
- [ ] 重启了 Gateway
- [ ] 日志中出现了两个启动横幅
- [ ] 测试了 `memory_search` 仍能正常工作
- [ ] 可选：运行了 `memory_distill` 生成初始观察笔记

---

## 需要帮助？

- plugin 问题 → [yaoyao-plugin Issues](https://github.com/taobaoaz/yaoyao-plugin/issues)
- soul 问题 → [yaoyao-soul Issues](https://github.com/taobaoaz/yaoyao-soul/issues)
- 通用讨论 → 任一仓库的 Discussions
