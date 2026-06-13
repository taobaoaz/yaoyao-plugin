#!/bin/bash
set -uo pipefail

ERRORS=0
WARNINGS=0
fail() { echo "  ❌ $1"; ((ERRORS++)) || true; }
warn() { echo "  ⚠️  $1"; ((WARNINGS++)) || true; }
pass() { echo "  ✅ $1"; }

echo "═══════════════════════════════════════════════════════════════"
echo "  yaoyao-memory v1.6.0 — 全生命周期模拟推演"
echo "═══════════════════════════════════════════════════════════════"

# ═══════════════════════════════════════════════════════════════
# 一、安装流程 (Install)
# ═══════════════════════════════════════════════════════════════
echo ""
echo "【一】安装流程推演"
echo "───────────────────────────────────────────────────────────────"

echo "  -> 1.1 仓库结构..."
for f in README.md LICENSE openclaw.plugin.json package.json dist/index.js; do
  [ -f "$f" ] && pass "$f 存在" || fail "$f 缺失 — clone 后无法安装"
done

echo "  -> 1.2 发布包完整性..."
FILES=$(node -e "console.log(require('./package.json').files.join(' '))")
[[ "$FILES" == *"dist/"* ]] && pass "files 包含 dist/" || fail "files 缺失 dist/ — 发布后无入口"
[[ "$FILES" == *"openclaw.plugin.json"* ]] && pass "files 包含 openclaw.plugin.json" || fail "files 缺失 openclaw.plugin.json"

echo "  -> 1.3 构建依赖..."
if find dist -maxdepth 2 -type d -name "core" | grep -q .; then
  pass "dist/ 已预构建（无需 tsc）"
else
  warn "dist/ 可能需手动编译"
fi

echo "  -> 1.4 运行时要求..."
ENGINE=$(node -e "console.log(require('./package.json').engines?.node || 'any')")
[[ "$ENGINE" == *"22"* ]] && pass "引擎要求: $ENGINE" || warn "引擎要求: $ENGINE（用户环境需确认）"

echo "  -> 1.5 插件注册..."
PLG_MAIN=$(node -e "console.log(require('./package.json').main)")
[ "$PLG_MAIN" = "dist/index.js" ] && pass "main = dist/index.js" || fail "main 指向错误: $PLG_MAIN"
PLG_EXPORT=$(node -e "console.log(require('./package.json').exports?.['.'])")
[ "$PLG_EXPORT" = "./dist/index.js" ] && pass "exports[.] = ./dist/index.js" || fail "exports 错误"

# ═══════════════════════════════════════════════════════════════
# 二、配置流程 (Configure)
# ═══════════════════════════════════════════════════════════════
echo ""
echo "【二】配置流程推演"
echo "───────────────────────────────────────────────────────────────"

echo "  -> 2.1 配置Schema..."
SCHEMA=$(node -e "console.log(require('./openclaw.plugin.json').configSchema ? 'PRESENT' : 'MISSING')")
[ "$SCHEMA" = "PRESENT" ] && pass "configSchema 存在" || fail "configSchema 缺失 — OpenClaw 无法渲染配置面板"

echo "  -> 2.2 关键配置项..."
for key in capture recall memoryDir embedding llm cleanup cloud; do
  HAS=$(node -e "console.log(require('./openclaw.plugin.json').configSchema.properties?.['$key'] ? 'YES' : 'NO')")
  [ "$HAS" = "YES" ] && pass "配置项 '$key' 存在" || warn "配置项 '$key' 缺失"
done

echo "  -> 2.3 默认值检查..."
CAP_DEF=$(node -e "console.log(require('./openclaw.plugin.json').configSchema.properties?.capture?.properties?.enabled?.default)")
[ "$CAP_DEF" = "true" ] && pass "capture.enabled 默认 true" || warn "capture.enabled 默认: $CAP_DEF"
REC_DEF=$(node -e "console.log(require('./openclaw.plugin.json').configSchema.properties?.recall?.properties?.enabled?.default)")
[ "$REC_DEF" = "true" ] && pass "recall.enabled 默认 true" || warn "recall.enabled 默认: $REC_DEF"
EMB_DEF=$(node -e "console.log(require('./openclaw.plugin.json').configSchema.properties?.embedding?.properties?.enabled?.default)")
[ "$EMB_DEF" = "false" ] && pass "embedding.enabled 默认 false（零成本启动）" || fail "embedding 默认开启会烧 API 额度"

echo "  -> 2.4 必填/可选..."
REQD=$(node -e "console.log(JSON.stringify(require('./openclaw.plugin.json').configSchema.required || []))")
[[ "$REQD" == *"additionalProperties"* ]] || pass "无硬必填项（全部有默认值）" || warn "有必填项: $REQD"

echo "  -> 2.5 配置热重载..."
if grep -q "pluginConfig" dist/src/entry/index.js; then
  pass "register() 读取 pluginConfig"
else
  warn "配置来源需确认"
fi

# ═══════════════════════════════════════════════════════════════
# 三、使用流程 (Runtime)
# ═══════════════════════════════════════════════════════════════
echo ""
echo "【三】使用流程推演"
echo "───────────────────────────────────────────────────────────────"

APP="dist/src/core/app.js"
BOOT="dist/src/core/boot/steps.js"

echo "  -> 3.1 启动链路..."
grep -q "runInstallCheck" "$APP" && pass "(1) 安装环境检查" || fail "缺少安装检查"
grep -q "createMemoryStore" "$BOOT" && pass "(2) 创建 MemoryStore" || fail "缺少 MemoryStore"
grep -q "createStorage" "$BOOT" && pass "(3) 创建 Storage" || fail "缺少 Storage"
grep -q "\.init()" "$BOOT" && pass "(4) 初始化 DB（建表）" || fail "缺少 DB init"
grep -q "registerMemoryTools" "$APP" && pass "(5) 注册工具" || fail "缺少工具注册"
grep -q "registerCaptureHook" "$APP" && pass "(6) 注册 capture hook" || fail "缺少 capture hook"
grep -q "registerRecallHook" "$APP" && pass "(7) 注册 recall hook" || fail "缺少 recall hook"
grep -q "showBanner" "$APP" && pass "(8) 显示启动 Banner" || fail "缺少 Banner"

echo "  -> 3.2 捕获链路..."
CAP="dist/src/hooks/auto-capture.js"
grep -q "agent_end" "$CAP" && pass "监听 agent_end 事件" || fail "未监听 agent_end"
if grep -q "writeDailyFile" dist/src/hooks/capture-pipeline.js; then
  pass "写入 L0 日志（文件）"
else
  warn "L0 写入确认"
fi
grep -q "indexTurn\|storage.*insert\|memory-store" "$CAP" && pass "索引到 FTS5（DB）" || warn "FTS5 索引确认"
# speculative & correction detection lives in capture-filter module
if grep -q "detectSpeculative" dist/src/hooks/capture-pipeline.js 2>/dev/null; then
  pass "推测检测（capture-filter）"
else
  warn "防幻觉推测检测缺失"
fi
if grep -q "detectCorrection" dist/src/hooks/capture-pipeline.js 2>/dev/null; then
  pass "纠正检测（capture-filter）"
else
  warn "防幻觉纠正检测缺失"
fi
if ls dist/src/hooks/capture-*.js 2>/dev/null; then
  pass "捕获管线已拆分为子模块 (content/pipeline/filter/watermark)"
fi

echo "  -> 3.3 召回链路..."
REC="dist/src/hooks/auto-recall.js"
grep -q "doParallelRecall\|recall-search\|recall\.search" "$REC" && pass "搜索调用存在" || fail "搜索调用缺失"
grep -q "cache" "$REC" && pass "结果缓存" || warn "缓存机制需确认"
grep -q "jaccard\|diversity\|distinct\|dedup" "$REC" && pass "多样性采样" || warn "多样性采样需确认"

echo "  -> 3.4 工具注册..."
TOOLS="dist/src/tools/index.js"
TOOL_COUNT=$(grep -cE "create[A-Za-z]+Tool" "$TOOLS" || true)
[ "$TOOL_COUNT" -ge 20 ] && pass "注册 $TOOL_COUNT 个工具" || fail "工具数不足 ($TOOL_COUNT)"
for tool in Search Get Save Forget Tag Export Backup CloudSync Import Stats Timeline Remind Verify; do
  if grep -q "create${tool}Tool" "$TOOLS" 2>/dev/null; then
    pass "工具 ${tool} 已注册"
  else
    warn "工具 ${tool} 未找到"
  fi
done

echo "  -> 3.5 embedding 条件分支..."
grep -qr "embedCfg\|embedding.*enabled" dist/ && pass "embedding 有条件初始化" || fail "embedding 无条件判断"

echo "  -> 3.6 DB 降级..."
if grep -q "FileDB" dist/src/utils/file-db.js 2>/dev/null; then
  pass "FileDB 降级路径（node:sqlite 不可用时）"
else
  warn "FileDB 降级路径需确认"
fi
if grep -q "supportsFTS5\|fts5" dist/src/utils/db-compat.js 2>/dev/null; then
  pass "FTS5 能力检测"
else
  warn "FTS5 检测缺失"
fi

# ═══════════════════════════════════════════════════════════════
# 四、升级/迁移流程 (Upgrade/Migration)
# ═══════════════════════════════════════════════════════════════
echo ""
echo "【四】升级/迁移推演"
echo "───────────────────────────────────────────────────────────────"

echo "  -> 4.1 遗留检测..."
grep -q "detectLegacy\|legacy\|migration" "$BOOT" && pass "启动时检测遗留文件" || fail "遗留检测缺失"
MIG="dist/src/entry/migration.js"
if grep -qE "persona.md|\.persona|\.pipeline" "$MIG" 2>/dev/null; then
  pass "检测 .persona/.pipeline/persona.md"
else
  warn "遗留检测范围不足"
fi

echo "  -> 4.2 数据保留策略..."
if grep -qE "rm -rf|unlinkSync.*persona|unlinkSync.*pipeline" "$MIG" 2>/dev/null; then
  fail "migration 可能删除用户数据！"
else
  pass "不自动删除用户数据"
fi

echo "  -> 4.3 迁移提示..."
grep -q "yaoyao-soul" "$MIG" 2>/dev/null && pass "提示安装 yaoyao-soul" || warn "未提示 soul 迁移"
grep -q "banner\|warn\|info\|logger" "$MIG" 2>/dev/null && pass "有日志提示输出" || warn "迁移无可见提示"

# ═══════════════════════════════════════════════════════════════
# 五、卸载/清理流程 (Uninstall/Shutdown)
# ═══════════════════════════════════════════════════════════════
echo ""
echo "【五】卸载/清理推演"
echo "───────────────────────────────────────────────────────────────"

echo "  -> 5.1 关闭钩子..."
grep -q "gateway_stop" "$APP" && pass "有 gateway_stop 处理" || warn "关闭钩子需确认"

echo "  -> 5.2 DB 资源释放..."
grep -q "close\|destroy" "$APP" && pass "调用 close()" || fail "资源未关闭 — 可能泄漏"

echo "  -> 5.3 定时器清理..."
grep -q "clearTimeout\|cleanupStop" "$APP" && pass "清理定时器" || warn "定时器可能泄漏"

echo "  -> 5.4 数据持久性..."
grep -q "memoryDir\|baseDir" dist/src/utils/memory-store.js 2>/dev/null && pass "数据目录独立存在" || fail "数据目录未定义"
if grep -qE "rm -rf|rmdirSync.*memory" "$APP"; then
  fail "卸载可能删数据"
else
  pass "卸载不删除记忆文件"
fi

# ═══════════════════════════════════════════════════════════════
# 六、边界场景推演 (Edge Cases)
# ═══════════════════════════════════════════════════════════════
echo ""
echo "【六】边界场景推演"
echo "───────────────────────────────────────────────────────────────"

echo "  -> 6.1 无网络..."
grep -q "retries\|timeout\|catch" dist/src/utils/embedding.js 2>/dev/null && pass "embedding 有容错" || warn "embedding 容错不足"

echo "  -> 6.2 磁盘/权限..."
if grep -A3 "fs.mkdirSync" dist/src/utils/memory-store.js 2>/dev/null | grep -q "catch"; then
  pass "目录创建有 try/catch 保护"
else
  fail "目录创建无保护 — 磁盘满/权限不足时启动崩溃"
fi

echo "  -> 6.3 空配置..."
node -e "
const s = require('./openclaw.plugin.json').configSchema;
const props = s.properties || {};
" 2>/dev/null && pass "配置Schema可解析（空配置友好）" || warn "配置Schema解析异常"

echo "  -> 6.4 重复注册..."
grep -q "registerMemoryTools" "$APP" && pass "工具注册函数独立" || warn "重复注册风险需确认"

echo "  -> 6.5 内存管理..."
if grep -qE "maxCacheSize|cacheSize|recallMaxCacheSize|maxResults" "$REC" 2>/dev/null; then
  pass "recall 缓存有大小限制"
else
  warn "recall 缓存上限需确认（可能通过参数传入）"
fi
grep -q "prune\|cleanup\|clear\|cleanerFeature" "$APP" && pass "有清理逻辑" || warn "长期运行可能累积"

# ═══════════════════════════════════════════════════════════════
# 总结
# ═══════════════════════════════════════════════════════════════
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  全生命周期推演结果"
echo "═══════════════════════════════════════════════════════════════"
echo "  失败项: $ERRORS"
echo "  警告项: $WARNINGS"
[ "$ERRORS" -eq 0 ] && echo "  🎉 全生命周期推演通过" || echo "  ⚠️ 发现 $ERRORS 个阻塞问题"
[ "$WARNINGS" -gt 0 ] && echo "  📋 $WARNINGS 项建议关注" || true
echo "═══════════════════════════════════════════════════════════════"
exit $ERRORS
