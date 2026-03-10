# 项目学习指南

适合从零理解本项目，把「vibe coding」变成「能讲清楚、能改得动」的代码。

---

## 一、一句话理解项目

**用户上传 CSV → 系统自动清洗 → 选数据集点训练 → 实时看进度 → 训练完可评估、下模型和报告。**

技术上：**Go 做 API 和调度，三个 Agent（数据 / 训练 / 评估）各管一块，AI 真正干活的是 Python（Pandas/PyTorch/sklearn），数据在 PostgreSQL，进度用 Redis 推。**

---

## 二、建议学习顺序（先文档后代码）

| 步骤 | 看什么 | 目的 |
|------|--------|------|
| 1 | **README.md** | 能跑起来、知道技术栈和目录结构 |
| 2 | **PRD.md** 第 1、2、5 节 | 业务目标、架构图、数据/训练/评估流程 |
| 3 | **internal/database/migrations/001_init.sql** | 6 张表各存什么（users, datasets, training_jobs, models, training_logs, evaluations） |
| 4 | **cmd/server/main.go** | 入口：怎么连 DB/Redis、怎么挂路由、哪些 Handler |
| 5 | 按「一条用户请求」跟代码 | 见下文「按请求跟代码」 |

---

## 三、核心概念（必记）

### 1. 三层架构

- **HTTP 层**：Gin 路由 → Handler（解析参数、调 Agent、写响应）
- **Agent 层**：DataAgent / TrainingAgent / EvaluationAgent，Go 里写业务逻辑、调 Python
- **Python 脚本**：真正做清洗、训练、评估，用 JSON 和 Go 通信

### 2. 「MCP」在项目里指什么

这里没有用标准 MCP SDK，而是**自己约定**：协调层（Go）把任务分给三个 Agent，Agent 之间通过**消息/调用关系**协作（可对照 PRD 2.3 节的请求/响应格式理解）。重点理解「谁调谁、数据怎么传」。

### 3. 数据流（记这条链）

```
上传/URL → 存文件 + 写 datasets 表 → DataAgent.CleanData(Python) → 更新 status=ready
→ 用户创建训练任务 → 写 training_jobs + Redis 队列 → TrainingAgent.Train(Python)
→ 进度写 Redis + 可选 WebSocket 推前端 → 训练完写 models 表
→ 用户创建评估 → EvaluationAgent.Evaluate(Python) → 写 evaluations 表 + 报告文件
```

---

## 四、按「一条请求」跟代码（推荐）

选一条你关心的请求，从路由跟到 DB/脚本，整条链走通。

### 例 1：上传数据集

1. **路由**：`main.go` 里 `POST /datasets/upload` → `datasetHandler.UploadDataset`
2. **Handler**：`internal/handlers/dataset_handler.go`  
   收文件、校验、存到 `uploadDir`、写 `datasets` 表、**异步**调 `dataAgent.CleanData(dataset.ID)`
3. **Agent**：`internal/agents/data_agent.go` 的 `CleanData`  
   查 `original_file_path`，调 `executor.Execute("data/clean_data.py", filePath)`
4. **Python**：`python_scripts/data/clean_data.py`  
   读 CSV、去重去空、写 `*_cleaned.csv`，stdout 打 JSON，Go 解析后更新 `cleaned_file_path`、`row_count`、`status=ready`

### 例 2：创建训练任务 + 看进度

1. **创建任务**：`POST /training/jobs` → `training_handler.CreateJob` → 写 `training_jobs`，`go func(){ trainingAgent.Train(job.ID) }()`
2. **训练**：`internal/agents/training_agent.go` 的 `Train`  
   查 job、查数据集路径、起子进程跑 `train_text_clf.py`，从 stdout 解析 `PROGRESS:` 行 → 写 Redis + 更新 DB，结束时写 `training_logs`、`models`
3. **进度**：前端轮询 `GET /training/jobs/:id`，或连 WebSocket `ws://.../ws/training/:id`（服务端从 Redis 订阅同名的 channel 推给浏览器）

### 例 3：评估 + 下载报告

1. **创建评估**：`POST /evaluations` → 异步 `evalAgent.Evaluate(modelID, testDatasetID)`  
   Agent 调 `evaluate_model.py`，脚本算指标、画混淆矩阵和 ROC、生成 HTML，返回路径；Go 写 `evaluations` 表（含 `report_path`）
2. **下载报告**：`GET /reports/download/:id` → 查 `evaluations` 取 `report_path`，用 `reportDir + basename` 读文件并返回

---

## 五、目录与文件速查

```
cmd/server/main.go            # 入口：配置、DB、Redis、路由、WebSocket
internal/
  config/config.go            # 环境变量 / 配置
  database/                   # Postgres、Redis 连接
  models/                     # 表对应结构体 + CRUD（dataset, job, model, evaluation, training_log）
  handlers/                   # HTTP：dataset, training, evaluation, model, ws
  agents/                     # 业务：data_agent, training_agent, evaluation_agent
  mcp/                        # 消息结构与协调（message, coordinator）
  utils/                      # Python 执行器、文件、URL 抓取、日志
python_scripts/
  data/clean_data.py          # 清洗
  data/analyze_data.py        # 分析
  training/train_text_clf.py  # BERT 文本分类训练
  evaluation/evaluate_model.py # 评估 + 混淆矩阵 + ROC + HTML 报告
frontend/src/
  pages/                      # Dashboard, Dataset, Training, Model, Evaluation
  services/                   # 各模块 API 封装
  types/                      # TS 类型
```

---

## 六、怎么跑、怎么调试

### 跑起来

```bash
docker-compose up -d
# 初始化 DB：psql -h localhost -U mcp_user -d mcp_training -f internal/database/migrations/001_init.sql
cp .env.example .env
go run cmd/server/main.go
cd frontend && npm i && npm run dev
```

### 调试建议

- **Go**：在 Handler/Agent 里打断点，看请求参数、DB 查询结果、调用 Python 的入参和返回。
- **Python**：直接 `python python_scripts/data/clean_data.py /path/to/file.csv` 看 stdout；或脚本里加 `print(json.dumps(...))` 和 Go 对齐。
- **Redis**：训练时用 `redis-cli` 看 `training:progress:<job_id>`、`training:progress:<job_id>` 的 pub/sub，确认 WebSocket 能收到同样数据。

### 容易晕的点

- **异步**：上传/创建任务后，清洗、训练、评估都在 `go func()` 里跑，所以接口先返回，状态要轮询或 WebSocket 看。
- **路径**：`original_file_path` / `cleaned_file_path` / `model_path` 多为相对路径（如 `./data/uploads/...`），当前工作目录一般是项目根目录；报告下载用 `reportDir + filepath.Base(report_path)` 拼绝对路径。
- **模型格式**：训练保存的是目录（Transformers），下载时用 zip 打包；若以后改成单文件 .pth，下载逻辑已支持单文件直接返回。

---

## 七、技术栈速查（Go / Redis / Postgres / 前端）

### 1. Go（后端）

- **框架**：Gin（`github.com/gin-gonic/gin`），负责 HTTP 路由、中间件和响应。
- **结构**：
  - `cmd/server/main.go`：入口，加载 `.env` → 连接 Postgres / Redis → 初始化 PythonExecutor / Agents / Handlers → 注册路由。
  - `internal/handlers`：每个模块一组 Handler，只做「收参数 + 调 Agent + 返回 JSON」。
  - `internal/agents`：真正的业务逻辑和编排，调用 `utils.PythonExecutor` 跑脚本。
  - `internal/models`：表结构 + CRUD。
- **与 Python 交互**：
  - 用 `exec.Command` 或 `PythonExecutor.Execute` 启动脚本。
  - Python 用 `print(json.dumps(...))` 把结果写到 stdout，Go 解析为 `map[string]interface{}`。

### 2. Redis（训练进度和 Pub/Sub）

- 连接在 `internal/database/redis.go`（通过 `NewRedisClient`）。
- 使用场景：
  - `TrainingAgent.Train` 在解析 `PROGRESS:` 行时：
    - `HSet("training:progress:<job_id>", progress)`：存当前进度，供轮询接口 `GetProgress` 使用。
    - `Publish("training:progress:<job_id>", jsonStr)`：推给 WebSocket 订阅者。
  - WebSocket Handler（`internal/handlers/ws_handler.go`）：
    - 订阅同一个 channel，把收到的消息直接写到浏览器的 WebSocket 连接。

### 3. PostgreSQL（业务数据）

- 连接在 `internal/database/postgres.go`，连接参数从 `.env` 读（`DB_HOST/PORT/USER/PASSWORD/DB_NAME`）。
- 表结构见 `internal/database/migrations/001_init.sql`：
  - `users`、`datasets`、`training_jobs`、`models`、`training_logs`、`evaluations`。
- 外键关系：
  - `datasets.user_id` → `users.id`
  - `training_jobs.user_id` → `users.id`
  - `training_jobs.dataset_id` → `datasets.id`
  - `models.job_id` → `training_jobs.id`
  - `evaluations.model_id` → `models.id`
- 默认用户：
  - `002_seed_default_user.sql` 会插入 `id = 1` 的用户，方便所有默认数据（目前 Go 代码里都用 `UserID: 1`）。

### 4. 前端（React + Ant Design + Vite）

- **框架**：
  - React 18（函数组件 + Hooks）。
  - React Router v6（`frontend/src/App.tsx` + `routes`）。
  - UI：Ant Design 5（`Card/Table/Button/Form/Modal/Menu` 等）。
  - 构建：Vite（`frontend/vite.config.ts`，含 `/api` 代理和 `/ws` WebSocket 代理）。
- **页面结构**（`frontend/src/pages`）：
  - `Dashboard`：仪表盘。
  - `Dataset`：数据集管理（上传 / URL 导入 / 在线数据集导入 / 预览）。
  - `Training`：训练任务列表 + 创建任务 + 实时进度（含 WebSocket）。
  - `Model`：模型管理（列表 + 下载）。
  - `Evaluation`：评估记录 + 创建评估 + 下载报告。
- **布局**（`frontend/src/components/Layout`）：
  - 左侧 Sider 菜单（可折叠成仅 icon），右侧 Content。
  - 底部有深浅色主题切换（使用 AntD `ConfigProvider` + `theme.defaultAlgorithm/darkAlgorithm`）。

---

## 八、运维小抄：什么时候要重启 / 迁移

### 1. 什么时候要重启 Go 后端

- ✅ **要重启**：
  - 改了任何 Go 代码：`internal/*`、`cmd/server/main.go`、路由、Handler、Agent、Model、Middleware 等。
  - 改了 `.env`（端口、DB 配置、存储路径、Python 路径等）。
- ❌ **不用重启**：
  - 只改前端（`frontend/`）。
  - 只改 Python 脚本（`python_scripts/`），因为是子进程，每次都会重新拉起。

> 实操：终端里 Ctrl+C 停掉 `go run cmd/server/main.go`，再执行一次 `go run cmd/server/main.go` 即可。

### 2. 什么时候需要执行数据库迁移（.sql）

- **首次初始化**：
  - `001_init.sql`：建表和索引。
  - `002_seed_default_user.sql`：插入默认 `users.id = 1`，避免 `datasets_user_id_fkey` 这类外键错误。
- **以后新增表或字段**：
  - 新增 `003_xxx.sql` 之类迁移时，只需要执行**新加的迁移**，不要重复跑旧的。
- **不需要迁移的情况**：
  - 只改业务逻辑、路由、前端、Python，但不改表结构。

### 3. 推荐命令（按当前 `.env`：root/5433）

在项目根目录，初始化 + seed 一次：

```bash
psql -h localhost -p 5433 -U root -d mcp_training -f internal/database/migrations/001_init.sql
psql -h localhost -p 5433 -U root -d mcp_training -f internal/database/migrations/002_seed_default_user.sql
```

---

## 九、接下来可以做什么

- **讲清楚**：用「数据流」那一段 + 一个你跟过的请求（如上传数据集）给同学/老师讲一遍。
- **改小功能**：例如改前端文案、给某个 API 加一个查询参数、在评估脚本里多算一个指标。
- **读 PRD 非功能**：错误重试、单元测试、日志规范，按 PRD 和 README 里的文档慢慢补。

有问题随时查 `docs/API.md`、`PRD.md` 和本文件；改代码前先确定「这条请求」的完整链路，再动对应层（Handler → Agent → Python）。
