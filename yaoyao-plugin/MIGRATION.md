# 迁移指南：从 yaoyao 集合版到拆分版

> 适用场景：你之前安装了 `yaoyao-plugin` **v1.4.x 或更早**（单体版，含记忆+情绪+画像+反馈全部功能），现在升级到 **v1.5.1+** 拆分架构。

---

## ⚠️ 一句话总结

**更新代码 ≠ 丢失数据。** 你的 `memory/*.md` 日志、`.yaoyao.db` 索引、甚至 `persona.md` 画像文件，**全部保留在原位**，不会被覆盖或删除。

拆分后：
- **yaoyao-plugin** (v1.5.1+) = 记忆存储 + 搜索 + 索引 + 数据管理（**必装**）
- **yaoyao-soul** (v1.0.0+) = 情绪观察 + 用户画像 + 反馈学习（**可选**，不装也能正常使用）

---

## 架构变化

| 版本 | 仓库 | 功能 |
|------|------|------|
| **v1.4.x 及之前** | `yaoyao-plugin` 单仓库 | 记忆 + 情绪 + 画像 + 反馈，全部混在一起 |
| **v1.5.1+** | `yaoyao-plugin` + `yaoyao-soul` | plugin 管记忆存取，soul 管观察沉淀 |

---

## 数据保护声明（请先读）

**用户数据与插件代码完全分离。**

你的数据默认存储在 `memory/` 目录和 `.yaoyao.db` 文件中，这些路径**不在 plugin 仓库内部**。更新插件代码时，以下文件**绝对不会被触碰**：

| 数据文件 | 默认位置 | 迁移后归属 | 是否保留 |
|----------|----------|-----------|----------|
| 每日对话日志 | `memory/*.md` | plugin | ✅ **完全保留，无缝继承** |
| SQLite 数据库 | `memory/.yaoyao.db` | plugin | ✅ **完全保留，索引继续可用** |
| 场景分组 | `memory/scene_blocks/` | plugin | ✅ 保留 |
| 备份快照 | `memory/.backups/` | plugin | ✅ 保留 |
| 用户画像 | `memory/persona.md` | soul | ✅ **追加新笔记，不覆盖旧内容** |
| 隐式标注 | `memory/.implicit-tags.jsonl` | soul | ✅ 自动读取 |
| 反馈记录 | `memory/.feedback.jsonl` | soul | ✅ 自动读取 |
| 旧状态文件 | `.persona-state.json` | **废弃** | ⚠️ 可删除，不影响 |

> 如果你曾手动修改过 `memoryDir` 配置，请确认你的数据实际存储位置。

---

## 迁移方案

### 方案 A：一键脚本（推荐）

复制粘贴执行：

```bash
#!/bin/bash
set -e

EXT_DIR="${OPENCLAW_EXTENSIONS_DIR:-$HOME/.openclaw/extensions}"
WORKSPACE_DIR="${OPENCLAW_WORKSPACE:-$HOME/.openclaw/workspace}"
BACKUP_DIR="$HOME/.openclaw/backups/yaoyao-$(date +%Y%m%d-%H%M%S)"

echo "📦 备份数据到 $BACKUP_DIR"
mkdir -p "$BACKUP_DIR"

# 备份 plugin 代码（以防回滚）
cp -r "$EXT_DIR/yaoyao-memory" "$BACKUP_DIR/plugin-code" 2>/dev/null || true

# 备份用户数据（memory 目录）
if [ -d "$WORKSPACE_DIR/memory" ]; then
  cp -r "$WORKSPACE_DIR/memory" "$BACKUP_DIR/memory-data"
  echo "   ✓ 已备份 memory/ 目录"
fi

# 备份数据库（如果在 workspace 根目录）
for db in "$WORKSPACE_DIR"/.yaoyao.db "$WORKSPACE_DIR"/.yaoyao.*.db; do
  [ -f "$db" ] && cp "$db" "$BACKUP_DIR/" && echo "   ✓ 已备份 $(basename "$db")"
done

echo ""
echo "🔄 更新 yaoyao-plugin 到 v1.5.1+"
cd "$EXT_DIR/yaoyao-memory"
git fetch origin
git checkout main
git pull origin main

echo ""
echo "🖤 安装 yaoyao-soul（可选，不装也能正常使用）"
cd "$EXT_DIR"
if [ ! -d "yaoyao-soul" ]; then
  git clone https://github.com/taobaoaz/yaoyao-soul.git
  echo "   ✓ yaoyao-soul 已安装"
else
  echo "   yaoyao-soul 已存在，跳过"
fi

echo ""
echo "✅ 迁移完成！"
echo ""
echo "数据安全确认："
echo "  - memory/*.md          → 未变动 ✅"
echo "  - .yaoyao.db           → 未变动 ✅"
echo "  - persona.md           → 追加新内容，不覆盖旧内容 ✅"
echo ""
echo "下一步：修改 ~/.openclaw/openclaw.json，添加 'yaoyao-memory' 到 plugins.allow"
echo "然后重启 Gateway：openclaw gateway restart"
echo ""
echo "回滚命令（万一出问题）："
echo "  rm -rf '$EXT_DIR/yaoyao-memory'"
echo "  cp -r '$BACKUP_DIR/plugin-code' '$EXT_DIR/yaoyao-memory'"
```

**或者直接用 curl：**

```bash
curl -fsSL https://raw.githubusercontent.com/taobaoaz/yaoyao-plugin/main/scripts/migrate-to-split.sh | bash
```

---

### 方案 B：手动分步（适合想理解每一步的用户）

#### Step 1：确认数据安全（重要）

先确认你的数据文件位置：

```bash
ls ~/.openclaw/workspace/memory/*.md        # 每日对话日志
ls ~/.openclaw/workspace/memory/.yaoyao.db    # 数据库
ls ~/.openclaw/workspace/memory/persona.md  # 用户画像
ls ~/.openclaw/workspace/memory/.implicit-tags.jsonl  # 隐式标注
```

如需备份：

```bash
BACKUP_DIR="$HOME/.openclaw/backups/yaoyao-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
cp -r ~/.openclaw/workspace/memory "$BACKUP_DIR/"
cp ~/.openclaw/workspace/.yaoyao.db* "$BACKUP_DIR/" 2>/dev/null || true
echo "数据已备份到 $BACKUP_DIR"
```

#### Step 2：更新 plugin

```bash
cd ~/.openclaw/extensions/yaoyao-memory
git pull origin main
```

验证版本：

```bash
git log --oneline -1
# 应显示 v1.5.1 或更高
```

#### Step 3：（可选）安装 yaoyao-soul

```bash
cd ~/.openclaw/extensions
git clone https://github.com/taobaoaz/yaoyao-soul.git
```

> 💡 **yaoyao-soul 是可选的**。不装它，plugin 仍然是一个完整的记忆存储 + 搜索系统。装了之后，AI 会额外获得情绪观察和用户画像能力。

#### Step 4：修改 openclaw.json

编辑 `~/.openclaw/openclaw.json`：

1. **在 `plugins.allow` 中添加 `"yaoyao-memory"`**（必须！否则插件不会加载）

```json5
{
  "plugins": {
    "allow": [
      // ... 其他插件
      "yaoyao-memory"   // ← 添加这一行
    ],
    "entries": {
      // ... 其他配置
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

2. **删除旧配置**（如果你之前有）：

```json5
// ❌ 删除这些旧配置项
{
  "psychology": true,      // 已废弃
  "intervention": true,    // 已废弃
  "moodTracking": true     // 已废弃
}
```

3. **（可选）添加 yaoyao-soul**：

```json5
{
  "plugins": {
    "allow": [
      "yaoyao-memory",
      "yaoyao-soul"    // ← 如需情绪观察，添加这一行
    ],
    "entries": {
      "yaoyao-soul": {
        "enabled": true
      }
    }
  }
}
```

#### Step 5：重启 Gateway

```bash
openclaw gateway restart
```

#### Step 6：验证

查看日志应出现启动横幅：

```
🎲 ══════════════════════════════════════════
🎲    摇摇 · 记忆引擎已启动
🎲    v1.5.1  ·  24 Tools  ·  2 Hooks
🎲 能力: FTS5✅ Vec✅ LLM✅ Cloud⚪
```

如果装了 yaoyao-soul，还会额外出现：

```
🖤 摇摇 · 灵魂观察层已启动
```

---

### 方案 C：只更新 plugin，暂不装 soul

如果你只想获得安全加固和 bug 修复，暂时不需要情绪分析：

```bash
cd ~/.openclaw/extensions/yaoyao-memory
git pull origin main
# 修改 openclaw.json 添加 "yaoyao-memory" 到 allow 列表
# 重启 Gateway 即可
```

plugin v1.5.1 **独立可用**，24 个工具 + 2 个 Hook 全部正常工作。相当于一个高级日记本 + 搜索引擎 + 云备份系统。

以后想加 soul 时，随时执行方案 A/B 的 soul 安装步骤。

---

## 常见问题

### Q1：我的数据真的会保留吗？

**是的，100% 保留。**

plugin 代码和数据是分离的：
- 代码在 `~/.openclaw/extensions/yaoyao-memory/`（git 仓库）
- 数据在 `~/.openclaw/workspace/memory/`（你的文件）

`git pull` 只更新代码文件，不会触碰 `workspace/` 下的任何内容。这是 OpenClaw 的设计原则。

### Q2：启动后找不到 `yaoyao-memory`？

最常见原因：**`plugins.allow` 列表缺少 `"yaoyao-memory"`**。

检查 `~/.openclaw/openclaw.json`：

```json5
{
  "plugins": {
    "allow": [
      // ... 确保这里有 "yaoyao-memory"
    ]
  }
}
```

修改后必须重启 Gateway 才能生效。

### Q3：soul 的 persona.md 是空的？

正常。soul 刚装上，还没积累足够的对话来生成观察笔记。

**解决方案：**
- 等几天，soul 会自动从对话中沉淀观察
- 或手动触发：`/call memory_distill`（扫描最近 7 天标签，生成初始观察笔记）

### Q4：之前配置了 LLM pipeline，现在怎么办？

拆分后：
- plugin 的 `llm` 配置仅用于 embedding（向量搜索），不再做 L1/L2/L3 提取
- 如果你需要 LLM 驱动的画像生成，需要额外配置 yaoyao-soul（见 soul 的 README）
- 如果只是用 FTS5 搜索，可以关掉 LLM 节省 API 调用：

```json5
{
  "yaoyao-memory": {
    "llm": { "enabled": false }
  }
}
```

### Q5：soul 和 plugin 会冲突吗？

不会。设计时已隔离：
- plugin 的 `before_prompt_build` 注入相关记忆
- soul 的 `before_prompt_build` 注入观察笔记
- 两者都是 **append**（追加），不会覆盖对方

### Q6：如何回滚到旧版本？

```bash
# 1. 停止 Gateway
openclaw gateway stop

# 2. 恢复备份
rm -rf ~/.openclaw/extensions/yaoyao-memory
cp -r ~/.openclaw/backups/yaoyao-YYYYMMDD-HHMMSS/plugin-code \
     ~/.openclaw/extensions/yaoyao-memory

# 3. 可选：删除 soul
rm -rf ~/.openclaw/extensions/yaoyao-soul

# 4. 从 plugins.allow 中移除 "yaoyao-soul"（如果有）
# 5. 重启 Gateway
openclaw gateway start
```

---

## 最低版本要求

| 组件 | 最低版本 |
|------|----------|
| OpenClaw | >= 2026.5.5 |
| Node.js | ^22.0.0 |
| yaoyao-plugin | >= v1.5.1 |
| yaoyao-soul | >= v1.0.0（可选） |

---

## 迁移检查清单

- [ ] 确认了 `memory/*.md` 和 `.yaoyao.db` 存在且完好
- [ ] 更新了 plugin 到 v1.5.1+（`git pull`）
- [ ] 在 `~/.openclaw/openclaw.json` 的 `plugins.allow` 中添加了 `"yaoyao-memory"`
- [ ] 删除了旧配置（`psychology` / `intervention` / `moodTracking`）
- [ ] （可选）安装了 `yaoyao-soul`
- [ ] （可选）在 `plugins.allow` 中添加了 `"yaoyao-soul"`
- [ ] 重启了 Gateway
- [ ] 日志中出现了 `摇摇 · 记忆引擎已启动` 横幅
- [ ] 测试了 `memory_search` 仍能正常搜索旧记忆
- [ ] （可选）测试了 `memory_list` 能看到历史 daily md 文件

---

## 需要帮助？

- plugin 问题 → [yaoyao-plugin Issues](https://github.com/taobaoaz/yaoyao-plugin/issues)
- soul 问题 → [yaoyao-soul Issues](https://github.com/taobaoaz/yaoyao-soul/issues)
- 通用讨论 → 任一仓库的 Discussions
