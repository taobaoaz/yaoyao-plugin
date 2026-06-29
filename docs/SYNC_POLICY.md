# 多平台同步策略

> 📌 **项目规则**：yaoyao-plugin 同时维护在 **GitHub** 和 **CNB（云原生构建）** 两个平台，任何代码或文档的**优化和更改**必须在两个仓库**同步更新**。

**Date:** 2026-06-29
**Status:** ✅ Active
**Author:** TIAMO

---

## 1. 仓库地址

| 平台 | 用途 | URL |
|------|------|-----|
| **GitHub** | 主仓库，国际访问 | https://github.com/taobaoaz/yaoyao-plugin |
| **CNB** | 国内镜像，CI/CD 集成 | https://cnb.cool/TIAMO.xianyao/yaoyao-plugin |

两个仓库**完全等价**——任何 push 到一个仓库后，**必须**立即同步到另一个。

---

## 2. 同步范围

✅ **必须同步：**
- 所有源代码（`src/`、`utils/`、`index.ts`、`dist/` 等）
- 文档（`README.md`、`CHANGELOG.md`、`docs/*`、`*.md`）
- 配置文件（`package.json`、`openclaw.plugin.json`、`tsconfig.json`、`.gitignore`、GitHub Actions 等）
- 测试用例（`test/`）
- Tag 和 Release
- 分支（main、beta）

❌ **不需要同步：**
- 平台特有的 CI/CD 配置（`.github/workflows/*` 不需要复制到 CNB）
- 平台特有的 issue / PR 模板
- 平台特有的 settings（merge 策略、保护规则等）

---

## 3. 同步流程

### 3.1 标准流程（本地修改后）

```bash
# 1. 提交到 GitHub（主仓库）
git checkout main
git pull origin main
# ... 修改代码 ...
git add .
git commit -m "feat: 新功能描述"
git push origin main

# 2. 立即同步到 CNB
git push cnb main
git push cnb --tags    # 如果有 tag 更新
```

### 3.2 一键脚本（推荐）

```bash
# 从 GitHub 同步到 CNB（反向同步）
./scripts/sync-to-cnb.sh

# 从 CNB 同步到 GitHub（少见，仅在 CNB 上做实验时）
./scripts/sync-to-cnb.sh --reverse
```

### 3.3 GitHub Actions 自动化（可选，未来）

可以添加 `.github/workflows/sync-to-cnb.yml`，在 push 到 GitHub 后自动推送到 CNB。CNB 的 git 协议对 owner 推送不要求 token（实测验证）。

---

## 4. 协作场景

### 4.1 优化和更改（最常见）

**场景**：本地修改代码 → 想提交到 GitHub

**操作**：
1. 提交并 push 到 GitHub（`git push origin main`）
2. **立即** push 到 CNB（`git push cnb main`）
3. 在 commit message 中说明两个仓库都会更新

### 4.2 发布新版本（v1.9.3 → v1.10.0）

```bash
# 1. 在 main 上完成所有改动
git push origin main
git push cnb main

# 2. 打 tag
git tag -a v1.10.0 -m "Release v1.10.0"
git push origin v1.10.0
git push cnb v1.10.0

# 3. 在 GitHub 上创建 Release（draft → publish）
# 4. （可选）在 CNB 上同步 Release 说明
```

### 4.3 紧急 hotfix

```bash
# 在 main 上修复
git push origin main
git push cnb main    # 必须同步

# 打 hotfix tag
git tag v1.9.3-hotfix
git push origin v1.9.3-hotfix
git push cnb v1.9.3-hotfix
```

### 4.4 在 CNB 上做实验（少见）

如果需要在 CNB 平台做独立实验（如 CI 测试），先 push 到 CNB，**确认后再反向同步到 GitHub**：

```bash
# 在 CNB 上实验
git push cnb main
# 实验 OK 后同步回 GitHub
git pull cnb main
git push origin main
```

---

## 5. 验证清单

每次同步后，在两个仓库验证：

- [ ] `git log -1` 在两个 remote 上 commit hash 一致
- [ ] `git ls-remote origin main` 和 `git ls-remote cnb main` 返回相同 hash
- [ ] 两个仓库的 tag 列表一致
- [ ] 重要文件（README、CHANGELOG、package.json）字节级一致

### 验证命令

```bash
# 比较 commit hash
git rev-parse origin/main
git rev-parse cnb/main
# 两者应相同

# 比较 tag 列表
git ls-remote --tags origin | awk '{print $2}' | sort
git ls-remote --tags cnb | awk '{print $2}' | sort
# diff 应为空
```

---

## 6. 故障排查

### 6.1 Push 失败：仓库不存在

```
Error: repository 'TIAMO.xianyao/yaoyao-plugin' not found
```

**原因**：CNB 仓库被删除或路径错误。
**解决**：登录 https://cnb.cool 检查仓库是否还在。

### 6.2 Push 失败：权限被拒

```
Error: 403 User has no permission
```

**原因**：您的 CNB 账号不是该仓库的 owner。
**解决**：在仓库 Settings → Members 添加您为 Owner/Master。

### 6.3 Push 失败：非快进

```
Error: non-fast-forward updates were rejected
```

**原因**：本地分支落后于远端。
**解决**：
```bash
git pull cnb main --rebase
git push cnb main
```

### 6.4 CNB 端显示有代码但本地显示空

**原因**：本地 `.git` 损坏或 remote URL 错误。
**解决**：
```bash
git remote -v                       # 确认 cnb remote URL
git fetch cnb                       # 重新同步
git diff cnb/main                   # 查看差异
```

---

## 7. 自动化方案（未来）

### 方案 A：GitHub Actions 自动同步

创建 `.github/workflows/sync-to-cnb.yml`：

```yaml
name: Sync to CNB
on:
  push:
    branches: [main, beta]
    tags: ['v*']
jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - name: Push to CNB
        run: |
          git remote add cnb https://cnb.cool/TIAMO.xianyao/yaoyao-plugin.git
          git push cnb --all --follow-tags
        env:
          # CNB 的 git 协议对 owner 推送不要求 token
          # 如果将来需要，添加 GIT_TOKEN secret
          GIT_TOKEN: ${{ secrets.CNB_TOKEN }}
```

### 方案 B：本地 git hook

在 `.git/hooks/post-push` 中添加同步逻辑（仅当 push 到 origin 时触发）：

```bash
#!/bin/sh
# post-push hook: 推送到 origin 后自动推送到 cnb
remote="$1"
if [ "$remote" = "origin" ]; then
  echo "🔄 Auto-syncing to CNB..."
  git push cnb --all --follow-tags || echo "⚠️ CNB sync failed (manual push needed)"
fi
```

### 方案 C：cron 定时同步（最稳妥）

```bash
# 每 5 分钟检查一次 GitHub 有新 commit，自动同步到 CNB
*/5 * * * * cd /path/to/yaoyao-plugin && ./scripts/sync-to-cnb.sh
```

---

## 8. 相关文档

- [README.md](../README.md) — 顶部"📦 安装"章节提到 GitHub 仓库
- [CHANGELOG.md](../CHANGELOG.md) — 每次同步策略变更应记录
- [install-guide.md](./install-guide.md) — 用户安装时只引用 GitHub URL（CNB 作为镜像）

---

## 9. 变更日志

| 日期 | 变更 | 原因 |
|------|------|------|
| 2026-06-29 | 初始建立规则 | 首次在 CNB 镜像 yaoyao-plugin（v1.9.2 + 79 commits + 6 tags），确立"同步更新"原则 |
