# 快速启动

## 方式一：桌面版（推荐）

从 [GitHub Releases](https://github.com/aqm857886159/Nomi/releases/latest) 下载安装包：

- **macOS**：下载 `.dmg`，拖入 Applications，双击打开
- **Windows**：下载 `.exe`，安装后从开始菜单启动

无需 Docker，无需命令行，安装即用。内置 SQLite 数据库，项目文件全部存在本地。

---

## 方式二：开发者版（源码启动）

### 环境要求

- Node.js 20+
- pnpm 10+
- PostgreSQL 16+
- Redis 7+

### 安装依赖（macOS Homebrew）

```bash
brew install postgresql@16 redis
brew services start postgresql@16
brew services start redis
```

### Windows / Linux（Docker 方式）

```bash
docker run -d --name nomi-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
docker run -d --name nomi-redis -p 6379:6379 redis:7
```

### 克隆并安装

```bash
git clone https://github.com/aqm857886159/Nomi.git
cd Nomi
pnpm install
```

### 配置

```bash
cp apps/hono-api/.env.example apps/hono-api/.env
```

编辑 `apps/hono-api/.env`：

```env
DATABASE_URL=postgresql://YOUR_USER@localhost:5432/nomi_dev
JWT_SECRET=any-random-string
REDIS_URL=redis://localhost:6379
```

创建数据库：

```bash
psql postgres -c "CREATE DATABASE nomi_dev;"
```

### 启动

开三个终端：

```bash
# 终端 1 — API（端口 8788）
pnpm dev:api

# 终端 2 — Web（端口 5173）
pnpm dev:web

# 终端 3 — Agents（可选，AI 创作功能需要）
pnpm dev:agents
```

打开 http://localhost:5173。

---

## 添加模型

进入 **设置 → 模型管理**，使用 AI 集成助手添加任意供应商（即梦、可灵、Runway、OpenAI 兼容接口等）。

详见 [docs/provider-integration.md](provider-integration.md)。
