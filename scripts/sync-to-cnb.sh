#!/usr/bin/env bash
# sync-to-cnb.sh - 同步 yaoyao-plugin 到 CNB（云原生构建）镜像
#
# 用法：
#   ./scripts/sync-to-cnb.sh                  # 推送所有分支和标签到 CNB
#   ./scripts/sync-to-cnb.sh --reverse        # 从 CNB 拉取到本地并推送到 GitHub
#   ./scripts/sync-to-cnb.sh --dry-run        # 仅显示将要执行的操作
#   ./scripts/sync-to-cnb.sh --help           # 显示帮助
#
# 文档：docs/SYNC_POLICY.md

set -euo pipefail

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 默认配置
CNB_REMOTE_NAME="cnb"
CNB_URL="https://cnb.cool/TIAMO.xianyao/yaoyao-plugin.git"
GITHUB_REMOTE_NAME="origin"
DIRECTION="to-cnb"   # to-cnb | to-github
DRY_RUN=false

# 帮助信息
usage() {
    cat <<EOF
用法: $0 [选项]

选项:
  --reverse        反向同步（CNB → GitHub）
  --dry-run        只显示要做的操作，不实际执行
  --help, -h       显示此帮助

示例:
  $0                          # 推送到 CNB
  $0 --reverse                # 从 CNB 拉取并推送到 GitHub
  $0 --dry-run                # 预览推送操作
EOF
}

# 参数解析
while [[ $# -gt 0 ]]; do
    case "$1" in
        --reverse)
            DIRECTION="to-github"
            shift
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --help|-h)
            usage
            exit 0
            ;;
        *)
            echo -e "${RED}未知参数: $1${NC}"
            usage
            exit 1
            ;;
    esac
done

# 检查 git
if ! command -v git >/dev/null 2>&1; then
    echo -e "${RED}❌ git 未安装${NC}"
    exit 1
fi

# 检查是否在 git 仓库
if ! git rev-parse --git-dir >/dev/null 2>&1; then
    echo -e "${RED}❌ 当前目录不是 git 仓库${NC}"
    exit 1
fi

# 打印标题
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  yaoyao-plugin 多平台同步脚本${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
echo ""

# 显示当前状态
echo -e "${YELLOW}📍 当前状态：${NC}"
echo "  仓库根目录: $(git rev-parse --show-toplevel)"
echo "  当前分支:   $(git rev-parse --abbrev-ref HEAD)"
echo "  Git 用户:   $(git config user.name) <$(git config user.email)>"
echo ""

# 检查 remote 配置
if [ "$DIRECTION" = "to-cnb" ]; then
    SOURCE_REMOTE="$GITHUB_REMOTE_NAME"
    TARGET_REMOTE="$CNB_REMOTE_NAME"
    TARGET_URL="$CNB_URL"
else
    SOURCE_REMOTE="$CNB_REMOTE_NAME"
    TARGET_REMOTE="$GITHUB_REMOTE_NAME"
fi

# 检查 source remote
if ! git remote get-url "$SOURCE_REMOTE" >/dev/null 2>&1; then
    echo -e "${RED}❌ 源 remote '$SOURCE_REMOTE' 不存在${NC}"
    echo "  请先添加 GitHub 源: git remote add origin <github-url>"
    exit 1
fi

# 检查 target remote（如果不存在则自动添加）
if ! git remote get-url "$TARGET_REMOTE" >/dev/null 2>&1; then
    if [ "$DIRECTION" = "to-cnb" ]; then
        echo -e "${YELLOW}⚠️ 目标 remote '$TARGET_REMOTE' 不存在，正在添加...${NC}"
        if [ "$DRY_RUN" = true ]; then
            echo "  [DRY-RUN] git remote add $TARGET_REMOTE $TARGET_URL"
        else
            git remote add "$TARGET_REMOTE" "$TARGET_URL"
            echo -e "${GREEN}  ✅ 已添加 $TARGET_REMOTE${NC}"
        fi
    else
        echo -e "${RED}❌ 目标 remote '$TARGET_REMOTE' 不存在${NC}"
        echo "  请先添加 GitHub remote: git remote add origin <github-url>"
        exit 1
    fi
fi

SOURCE_URL=$(git remote get-url "$SOURCE_REMOTE")
TARGET_URL=$(git remote get-url "$TARGET_REMOTE")
echo -e "${YELLOW}🔗 Remote 配置：${NC}"
echo "  源（$SOURCE_REMOTE）: $SOURCE_URL"
echo "  目标（$TARGET_REMOTE）: $TARGET_URL"
echo ""

# 同步方向说明
if [ "$DIRECTION" = "to-cnb" ]; then
    echo -e "${GREEN}🚀 同步方向: GitHub → CNB${NC}"
else
    echo -e "${GREEN}🚀 同步方向: CNB → GitHub${NC}"
fi
echo ""

# 检查工作区干净
if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
    echo -e "${YELLOW}⚠️ 工作区有未提交的修改：${NC}"
    git status --short
    echo ""
    read -rp "是否继续？[y/N] " -n 1
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${YELLOW}已取消${NC}"
        exit 0
    fi
fi

# 获取要同步的分支
echo -e "${YELLOW}📋 收集分支和标签...${NC}"
BRANCHES=$(git for-each-ref --format='%(refname:short)' refs/heads/)
TAGS=$(git tag -l)

# 过滤掉不需要同步的分支（可选）
# 当前同步所有分支

echo "  分支: $(echo "$BRANCHES" | tr '\n' ' ')"
echo "  标签: $(echo "$TAGS" | tr '\n' ' ' | head -c 100)..."
echo ""

# 实际推送
if [ "$DIRECTION" = "to-cnb" ]; then
    # GitHub → CNB
    echo -e "${YELLOW}📤 推送所有分支到 $TARGET_REMOTE...${NC}"
    if [ "$DRY_RUN" = true ]; then
        echo "  [DRY-RUN] git push $TARGET_REMOTE --all"
    else
        GIT_TERMINAL_PROMPT=0 git push "$TARGET_REMOTE" --all
    fi
    echo ""

    echo -e "${YELLOW}📤 推送所有标签到 $TARGET_REMOTE...${NC}"
    if [ "$DRY_RUN" = true ]; then
        echo "  [DRY-RUN] git push $TARGET_REMOTE --tags"
    else
        GIT_TERMINAL_PROMPT=0 git push "$TARGET_REMOTE" --tags
    fi
else
    # CNB → GitHub
    echo -e "${YELLOW}📥 从 $SOURCE_REMOTE 拉取最新更改...${NC}"
    if [ "$DRY_RUN" = true ]; then
        echo "  [DRY-RUN] git fetch $SOURCE_REMOTE"
    else
        git fetch "$SOURCE_REMOTE"
    fi
    echo ""

    echo -e "${YELLOW}📤 推送到 $TARGET_REMOTE...${NC}"
    if [ "$DRY_RUN" = true ]; then
        echo "  [DRY-RUN] git push $TARGET_REMOTE --all --tags"
    else
        GIT_TERMINAL_PROMPT=0 git push "$TARGET_REMOTE" --all
        GIT_TERMINAL_PROMPT=0 git push "$TARGET_REMOTE" --tags
    fi
fi

# 验证结果
echo ""
if [ "$DRY_RUN" = false ]; then
    echo -e "${YELLOW}🔍 验证同步结果...${NC}"
    for branch in $BRANCHES; do
        SRC_HASH=$(git rev-parse "$SOURCE_REMOTE/$branch" 2>/dev/null || echo "N/A")
        TGT_HASH=$(git rev-parse "$TARGET_REMOTE/$branch" 2>/dev/null || echo "N/A")
        if [ "$SRC_HASH" = "$TGT_HASH" ]; then
            echo -e "  ${GREEN}✅ $branch: 一致 ($SRC_HASH)${NC}"
        else
            echo -e "  ${YELLOW}⚠️ $branch: 不一致 (源=$SRC_HASH, 目标=$TGT_HASH)${NC}"
        fi
    done
fi

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅ 同步完成！${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
echo ""
echo "📌 详细规则见: docs/SYNC_POLICY.md"
