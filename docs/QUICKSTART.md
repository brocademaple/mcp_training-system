# 快速开始：本机运行（使用本机 GPU）

按顺序在终端执行以下命令。除「启动前端」外，均在 **项目根目录** 执行。

---

## 1. 启动数据库

```bash
docker-compose up -d postgres redis
```

---

## 2. 初始化数据库（仅首次需要，无用户管理）

**Bash / CMD：**

```bash
docker exec -i postgres-mcp-training psql -U mcp_user -d mcp_training < internal/database/migrations/001_init.sql
docker exec -i postgres-mcp-training psql -U mcp_user -d mcp_training < internal/database/migrations/003_add_job_name.sql
```

**PowerShell（若上面重定向报错）：**

```powershell
Get-Content internal/database/migrations/001_init.sql | docker exec -i postgres-mcp-training psql -U mcp_user -d mcp_training
Get-Content internal/database/migrations/003_add_job_name.sql | docker exec -i postgres-mcp-training psql -U mcp_user -d mcp_training
```

（若为旧库且曾建过 users 表，需再执行：`Get-Content internal/database/migrations/005_remove_users.sql | docker exec -i postgres-mcp-training psql -U mcp_user -d mcp_training`）

评估任务状态与错误信息（评估中/失败原因）需执行：`Get-Content internal/database/migrations/006_add_evaluation_status.sql | docker exec -i postgres-mcp-training psql -U mcp_user -d mcp_training`

评估任务名称（列表任务名列）需执行：`Get-Content internal/database/migrations/007_add_evaluation_name.sql | docker exec -i postgres-mcp-training psql -U mcp_user -d mcp_training`

数据集用途（训练集/测试集分离，避免删除互通）需执行：`Get-Content internal/database/migrations/008_add_dataset_usage.sql | docker exec -i postgres-mcp-training psql -U mcp_user -d mcp_training`

删除数据集时保留训练任务与模型（不再级联删除）需执行：`Get-Content internal/database/migrations/009_dataset_delete_set_null.sql | docker exec -i postgres-mcp-training psql -U mcp_user -d mcp_training`

---

## 3. 安装 Python 依赖

```bash
pip install -r python_scripts/requirements.txt
```

Windows 使用 `py -3` 时：

```bash
py -3 -m pip install -r python_scripts/requirements.txt
```

---

## 4. 配置环境变量

```bash
cp .env.example .env
```

默认已按本机方式配置（`DB_PORT=5433`），一般无需修改。

---

## 5. 启动后端

```bash
go run cmd/server/main.go
```

看到 `Server starting on 0.0.0.0:8080` 即可。保持此终端运行。

---

## 6. 启动前端（新开一个终端）

```bash
cd frontend
npm i
npm run dev
```

浏览器打开 **http://localhost:3000**。训练将使用本机 Python，若有 NVIDIA 显卡且驱动正常（`nvidia-smi` 可用），会自动使用 GPU。
