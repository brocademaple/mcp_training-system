---
name: start-mcp-training-system
description: 在本机启动 MCP Training System（Docker 起 PostgreSQL/Redis、Go 后端、Vite 前端）。在用户要求「启动项目」「跑起来本地开发」「起前后端」或首次搭建开发环境时使用。
---

# 启动 MCP Training System（本机开发）

## 前置条件

- **Docker Desktop**（或 Docker Engine）已安装，用于 `postgres` + `redis`。
- **Go 1.21+**、**Node.js 18+**、**Python 3.8+**（训练/清洗脚本由本机 Python 执行）。
- 工作目录为**项目根目录** `mcp-training-system`（含 `go.mod`、`docker-compose.yml`、`frontend/`）。

## 推荐流程（与 README 一致）

### 1. 启动数据库

```bash
docker-compose up -d postgres redis
```

容器名：`postgres-mcp-training`、`redis-mcp-training`。宿主机 Postgres 端口 **5433**。

### 2. 首次运行：初始化数据库（仅一次）

**Bash / CMD：**

```bash
docker exec -i postgres-mcp-training psql -U mcp_user -d mcp_training < internal/database/migrations/001_init.sql
docker exec -i postgres-mcp-training psql -U mcp_user -d mcp_training < internal/database/migrations/003_add_job_name.sql
```

**PowerShell（重定向报错时）：**

```powershell
Get-Content internal/database/migrations/001_init.sql | docker exec -i postgres-mcp-training psql -U mcp_user -d mcp_training
Get-Content internal/database/migrations/003_add_job_name.sql | docker exec -i postgres-mcp-training psql -U mcp_user -d mcp_training
```

旧库若曾有 `users` 表：再执行 `005_remove_users.sql`。评估/流水线等能力需补跑 **006～010** 等迁移：请直接对照 [`internal/database/migrations/`](../../internal/database/migrations/)（按文件名顺序执行）。

### 3. Python 依赖（本机）

```bash
pip install -r python_scripts/requirements.txt
```

Windows 常用：`py -3 -m pip install -r python_scripts/requirements.txt`

### 4. 环境变量

```bash
cp .env.example .env
```

默认 `DB_PORT=5433` 等与 docker-compose 一致，一般无需改。

### 5. 启动后端（终端 1，项目根目录）

```bash
go run cmd/server/main.go
```

成功标志：日志出现 **Server starting on 0.0.0.0:8080**（或等价）。API：`http://localhost:8080`。

### 6. 启动前端（终端 2）

```bash
cd frontend
npm install
npm run dev
```

浏览器：**http://localhost:3000**。

## 验证

- 打开 `http://localhost:3000`，经典版/Agent 版可切换。
- `curl http://localhost:8080/api/v1/health` 或浏览器访问已知健康检查路由（若项目已配置）。

## 常见问题

| 现象 | 处理 |
|------|------|
| Windows `Python was not found` / 9009 | 安装 Python 并勾选 PATH，或 `.env` 设置 `PYTHON_PATH` |
| `ModuleNotFoundError: pandas` | 执行步骤 3 安装 `python_scripts/requirements.txt` 后重启后端 |
| 数据库连接失败 | 确认 Docker 容器已起、`.env` 中 `DB_HOST=localhost`、`DB_PORT=5433` |
| 路径含中文导致 shell `cd` 失败 | 在 Cursor/IDE 中从资源管理器打开的项目根执行命令，或使用 `git -C "<路径>"` 式绝对路径 |

## 可选：全栈 Docker

无需本机 Go/Python 时：`docker-compose up -d`，再按 README 执行库初始化，最后本机只跑 `frontend` 的 `npm run dev`（见 [`README.md`](../../README.md)「可选：Docker 一键运行」）。

## 相关文档

- [`README.md`](../../README.md) — 快速开始全文  
- [`internal/database/migrations/`](../../internal/database/migrations/) — 数据库迁移 SQL（权威来源）  
- [`docs/SPEC_CODING.md`](../../docs/SPEC_CODING.md) — 文档索引  
