# yaoyao-plugin / yaoyao-soul 环境兼容性指南

> 不同用户的机器千差万别——Windows/Mac/Linux、Docker/NAS/树莓派、企业内网/海外节点、Node 20/22/24……> 这份指南告诉你：哪些环境**一定支持**，哪些**可能有问题**，以及**炸了怎么修**。

---

## ✅ 官方支持环境

| 项目 | 要求 | 说明 |
|---|---|---|
| **Node.js** | 22.0.0+ | `node:sqlite` 从 Node 22 开始内置。Node 20 可用但需自行编译 SQLite |
| **操作系统** | Linux / macOS | 充分测试。Windows 为实验性支持 |
| **文件系统** | ext4 / APFS / NTFS | WAL 模式正常。NFS / 某些 Docker 卷可能不支持 WAL |
| **内存** | >= 512MB | 空闲内存。大容量记忆（>10万条）建议 1GB+ |
| **磁盘** | >= 100MB 空闲 | 长期运行积累 daily md 和 SQLite 数据库 |

---

## ⚠️ 已知限制与对策

### 1. Node.js < 22 — `node:sqlite` 不可用

**症状**：启动报错 `Cannot find module 'node:sqlite'`

**原因**：`node:sqlite` 是 Node 22 新增模块。旧版本没有。

**修复**：
```bash
# 检查版本
node -v

# 升级到 Node 22+
# macOS/Linux (nvm)
nvm install 22
nvm use 22

# Windows
# 下载官方安装包：https://nodejs.org/
```

**降级方案（Node 20）**：Node 20 需要 `--experimental-sqlite` 标志或自行编译 better-sqlite3。不建议，升级更简单。

---

### 2. Windows 路径问题

**症状**：文件找不到、路径含混合格式（`C:\Users\xxx/memory/2026-05-14.md`）

**原因**：代码中某些地方硬编码了 `/` 分隔符，或 `path.join` 和字符串拼接混用。

**现状**：核心路径已统一使用 `path.join()` 和 `path.normalize()`，但以下功能仍依赖 Windows 特有命令：
- `cloud-sync.ts` 的 Samba 适配器使用 `net use` 和 `cmd /c`

**修复**：
- 避免在 Windows 上使用 Samba 云备份（用 WebDAV/S3/SFTP 代替）
- 如果仍有问题，在 `config.json` 中显式设置 `memoryDir` 为绝对路径：
```json
{
  "memoryDir": "C:\\Users\\你的用户名\\.openclaw\\workspace\\memory"
}
```

---

### 3. NFS / Docker 卷 — WAL 不支持

**症状**：启动正常，但数据库操作偶尔报错 `disk I/O error` 或性能极差

**原因**：SQLite WAL 模式需要文件系统支持 `mmap` 和原子写入。NFS 和部分 Docker 卷驱动不支持。

**检测**：运行 healthcheck 工具，看 "WAL 支持" 项。

**修复**：
- 已在 db-bridge.ts 中自动 fallback：WAL 失败后自动切换到 DELETE journal mode
- 手动禁用 WAL（不推荐，影响并发性能）：在 db-bridge.ts 中删除 `PRAGMA journal_mode = WAL`
- **最佳方案**：将 memory 目录映射到本地 ext4/APFS/NTFS 卷，而非 NFS

---

### 4. 企业内网 — git clone / embedding API 不可用

**症状**：
- 启动时卡在 "自动迁移 yaoyao-soul"
- `memory_search` 或 `auto-recall` 超时

**原因**：
- 自动迁移尝试 `git clone github.com`，企业防火墙阻断
- embedding API（如 OpenAI/Gitee）需要外网访问

**修复**：
```json
{
  "migrationGitTimeoutMs": 5000,
  "embedding": { "enabled": false },
  "llm": { "enabled": false }
}
```
- 关闭 embedding 后，FTS5 纯文本搜索仍完全可用
- 手动下载 yaoyao-soul 放到 plugins 目录

---

### 5. 无 UTF-8 locale — CJK 乱码

**症状**：中文记忆显示为乱码，emoji 变成 `???`，FTS5 搜不到中文

**原因**：系统 locale 不是 UTF-8。常见于老旧 Linux 服务器或精简 Docker 镜像。

**检测**：
```bash
echo $LANG
echo $LC_ALL
```

**修复**：
```bash
# 临时
export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8

# 永久（Debian/Ubuntu）
sudo dpkg-reconfigure locales
# 选择 en_US.UTF-8 并设为默认

# Docker 镜像
ENV LANG=en_US.UTF-8
ENV LC_ALL=en_US.UTF-8
```

---

### 6. 磁盘满 / 权限不足

**症状**：`EACCES` / `ENOSPC` / `disk full` 错误，记忆不写入

**原因**：
- `memory/` 目录所在分区满了
- 运行用户没有写入权限
- Docker 容器以非 root 运行但目录属主是 root

**检测**：
```bash
df -h ~/.openclaw/workspace/memory
ls -la ~/.openclaw/workspace/memory
```

**修复**：
```bash
# 清理旧日志
rm ~/.openclaw/workspace/memory/2026-01-*.md

# 改权限
sudo chown -R $(whoami) ~/.openclaw

# 或换目录
# config.json:
{ "memoryDir": "/data/yaoyao-memory" }
```

---

### 7. 多用户 / 多容器同时访问同一数据库

**症状**：`SQLITE_BUSY` / `database is locked` / 数据损坏

**原因**：SQLite 不支持多进程并发写入。两个 OpenClaw 实例同时打开 `.yaoyao.db` 会冲突。

**修复**：
- **不要** 在多容器间共享同一个 `memory/` 目录
- 每个实例使用独立的 `memoryDir`：
```json
{ "memoryDir": "/data/yaoyao/instance-1" }
{ "memoryDir": "/data/yaoyao/instance-2" }
```
- 如需共享记忆，用 `memory_export` / `memory_import` 定期同步，或用云备份适配器

---

### 8. ARM / 树莓派 — sqlite-vec 编译失败

**症状**：`npm install sqlite-vec` 报错，或 `sqlite-vec.load(db)` 失败

**原因**：`sqlite-vec` 是原生 C 扩展，ARM 架构可能没有预编译二进制包。

**修复**：
- 关闭 embedding：`"embedding": { "enabled": false }`
- FTS5 纯文本搜索完全可用，不需要向量搜索
- 如需向量搜索，在 ARM 设备上从源码编译 sqlite-vec（需 `build-essential` / `python3`）

---

### 9. 旧版 OpenClaw Gateway — plugin API 不兼容

**症状**：插件加载失败，日志显示 `pluginApi` 版本不匹配

**原因**：yaoyao-plugin 需要 OpenClaw Gateway `>=2026.5.5`

**检测**：查看启动日志中的 `Compat: xxx` 行

**修复**：升级 OpenClaw Gateway：
```bash
npm install -g openclaw@latest
openclaw gateway restart
```

---

## 🔧 环境自检命令

在故障排查时，先跑这个：

```bash
cd /path/to/yaoyao-plugin
node --experimental-strip-types -e "
  const { runHealthcheck, formatHealthcheck } = await import('./src/utils/healthcheck.ts');
  const r = await runHealthcheck();
  console.log(formatHealthcheck(r));
"
```

或等待后续版本中的 `memory_healthcheck` 工具（直接通过 OpenClaw 调用）。

---

## 📞 报错速查表

| 报错关键词 | 排查顺序 | 解决 |
|---|---|---|
| `Cannot find module 'node:sqlite'` | Node 版本 < 22 | 升级 Node |
| `disk I/O error` | WAL / NFS / 权限 | 检查文件系统，或禁用 WAL |
| `database is locked` | 多实例访问同一 DB | 每个实例独立 memoryDir |
| `EACCES` / `EPERM` | 权限 | `chown` 或换目录 |
| `ECONNREFUSED` / `ETIMEDOUT` | embedding API 网络 | 关闭 embedding 或检查代理 |
| `ENOENT` 路径相关 | 路径错误 / Windows | 显式设置绝对路径 |
| `JSON.parse` / `SyntaxError` | 配置文件损坏 | 重建 `config.json` |
| `git clone` 超时 | 内网无外网 | 手动下载 yaoyao-soul |

---

**Last updated**: 2026-05-14
**适用范围**: yaoyao-plugin ≥1.5.0, yaoyao-soul ≥1.0.0
