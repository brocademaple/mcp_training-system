# 基于 MCP 的多模型协同训练 Agent 系统 - 完整开发任务

## 📋 项目说明

你是一个专业的全栈开发工程师。现在需要完整实现一个基于 MCP 的多模型协同训练 Agent 系统。

**详细的产品需求文档（PRD）在当前目录的 `PRD.md` 文件中。**

请严格按照 PRD 的设计和代码示例来实现。

---

## 🎯 总体要求

### 工作方式
1. **一次性完成所有开发任务**
2. **严格遵循 PRD.md 的设计**
3. **每完成一个大模块就告诉我进度**
4. **代码必须可运行、无错误**
5. **所有文件都要创建，不要遗漏**

### 质量标准
- ✅ 代码有详细注释
- ✅ 错误处理完善
- ✅ 遵循 Go 和 Python 最佳实践
- ✅ 数据库设计符合 PRD
- ✅ API 符合 RESTful 规范

---

## 📦 Phase 1: 项目初始化

### 任务 1.1: 创建项目结构

根据 PRD.md 第 9 节，创建完整的项目目录结构，包括：

```
mcp-training-system/
├── cmd/server/main.go
├── internal/
│   ├── config/config.go
│   ├── database/
│   │   ├── postgres.go
│   │   ├── redis.go
│   │   └── migrations/001_init.sql
│   ├── models/
│   │   ├── dataset.go
│   │   ├── job.go
│   │   ├── model.go
│   │   └── evaluation.go
│   ├── handlers/
│   │   ├── dataset_handler.go
│   │   ├── training_handler.go
│   │   ├── model_handler.go
│   │   └── evaluation_handler.go
│   ├── services/
│   │   ├── dataset_service.go
│   │   ├── training_service.go
│   │   └── evaluation_service.go
│   ├── agents/
│   │   ├── base_agent.go
│   │   ├── data_agent.go
│   │   ├── training_agent.go
│   │   └── evaluation_agent.go
│   ├── mcp/
│   │   ├── coordinator.go
│   │   ├── message.go
│   │   └── router.go
│   ├── utils/
│   │   ├── python_executor.go
│   │   ├── file_utils.go
│   │   └── logger.go
│   └── middleware/
│       ├── cors.go
│       └── error_handler.go
├── python_scripts/
│   ├── requirements.txt
│   ├── common/utils.py
│   ├── data/
│   │   ├── clean_data.py
│   │   └── analyze_data.py
│   ├── training/
│   │   └── train_text_clf.py
│   └── evaluation/
│       └── evaluate_model.py
├── tests/
│   ├── unit/
│   └── integration/
└── docs/
    ├── API.md
    └── DEPLOYMENT.md
```

**创建所有文件夹和空文件，每个 Go 文件添加正确的 package 声明。**

---

### 任务 1.2: 初始化配置文件

创建以下文件：

**1. go.mod**
```go
module mcp-training-system

go 1.21

require (
    github.com/gin-gonic/gin v1.9.1
    github.com/lib/pq v1.10.9
    github.com/go-redis/redis/v9 v9.0.5
    github.com/google/uuid v1.3.1
)
```

**2. docker-compose.yml**（参考 PRD.md 第 10.1 节）
- PostgreSQL 14（数据库：mcp_training，用户：mcp_user，密码：mcp_password）
- Redis 7.0
- 数据持久化

**3. .env.example**
```
# Server
SERVER_HOST=0.0.0.0
SERVER_PORT=8080

# Database
DB_HOST=localhost
DB_PORT=5432
DB_USER=mcp_user
DB_PASSWORD=mcp_password
DB_NAME=mcp_training

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

# Storage
UPLOAD_DIR=./data/uploads
CLEANED_DIR=./data/cleaned
MODEL_DIR=./data/models
REPORT_DIR=./reports

# Python
PYTHON_PATH=python3
PYTHON_SCRIPTS_DIR=./python_scripts
```

**4. .gitignore**
```
# Go
*.exe
*.test
*.out
go.work

# Python
venv/
__pycache__/
*.pyc

# Project
.env
data/
logs/
reports/
```

**5. README.md**（包含项目简介、技术栈、快速开始）

---

## 🗄️ Phase 2: 数据库层

### 任务 2.1: 数据库迁移脚本

创建 `internal/database/migrations/001_init.sql`

**严格按照 PRD.md 第 4.1 节的表结构**，创建所有 6 个表：
1. users
2. datasets（带索引 idx_datasets_user_id, idx_datasets_status）
3. training_jobs（带索引）
4. models（带索引）
5. training_logs（带索引）
6. evaluations（带索引）

每个表包含完整的列定义、主键、外键约束、默认值、时间戳。

---

### 任务 2.2: 数据库连接层

**1. internal/database/postgres.go**
- NewPostgresDB(host, port, user, password, dbname string) (*sql.DB, error)
- 连接池配置：MaxOpenConns=25, MaxIdleConns=5, ConnMaxLifetime=5min
- Ping 测试
- 完善的错误处理

**2. internal/database/redis.go**
- NewRedisClient(host, port, password string, db int) (*redis.Client, error)
- Ping 测试
- 完善的错误处理

---

### 任务 2.3: 配置管理

**internal/config/config.go**
- Config 结构体（Server, Database, Redis, Storage）
- LoadConfig() 函数（从环境变量读取，提供默认值）
- 使用 os.Getenv() 和 godotenv

---

## 📦 Phase 3: 数据模型层

### 任务 3.1: 实现所有数据模型

**严格按照 PRD.md 第 4.1 节的表结构**，为每个表创建：

**1. internal/models/dataset.go**
- Dataset 结构体
- Create, GetByID, GetByUserID, Update, Delete 方法
- UpdateStatus 方法

**2. internal/models/job.go**
- TrainingJob 结构体
- CRUD 方法
- UpdateProgress, UpdateStatus 方法

**3. internal/models/model.go**
- Model 结构体
- CRUD 方法

**4. internal/models/evaluation.go**
- Evaluation 结构体
- CRUD 方法

所有模型都要包含完善的错误处理和注释。

---

## 🔧 Phase 4: 工具函数

### 任务 4.1: Python 执行器

**internal/utils/python_executor.go**

**严格按照 PRD.md 第 11.1 节的代码示例实现**：
- PythonExecutor 结构体
- NewPythonExecutor() 构造函数
- Execute(script string, args ...string) (map[string]interface{}, error)
- 使用 exec.Command
- 解析 JSON 输出
- 完善的错误处理

---

### 任务 4.2: 文件工具

**internal/utils/file_utils.go**
- SaveUploadedFile(file multipart.File, filename string, destDir string) (string, error)
- EnsureDir(dir string) error
- GetFileSize(path string) (int64, error)
- ValidateCSVFile(path string) error

---

### 任务 4.3: 日志工具

**internal/utils/logger.go**
- 初始化日志（写入 ./logs/app.log 和控制台）
- Info, Warning, Error 函数
- 包含时间戳、日志级别、文件位置

---

## 🐍 Phase 5: Python 脚本

### 任务 5.1: Python 依赖

**python_scripts/requirements.txt**（参考 PRD.md 第 3.2 节）
```
pandas>=2.0.0
numpy>=1.24.0
torch>=2.0.0
transformers>=4.30.0
datasets>=2.12.0
scikit-learn>=1.3.0
matplotlib>=3.7.0
```

---

### 任务 5.2: 数据清洗脚本

**python_scripts/data/clean_data.py**

**严格按照 PRD.md 第 11.2 节的代码示例实现**：
- clean_data(file_path) 函数
- 读取 CSV
- 去重：df.drop_duplicates()
- 删除缺失值：df.dropna()
- 保存清洗后的数据
- 返回 JSON：{status, original_rows, cleaned_rows, columns, output_path}
- 异常处理（返回错误 JSON）
- 命令行参数处理

---

### 任务 5.3: 数据分析脚本

**python_scripts/data/analyze_data.py**
- 读取 CSV
- 生成统计信息（数据类型、均值、方差、类别分布）
- 返回 JSON 格式
- 命令行参数处理
- 异常处理

---

### 任务 5.4: 训练脚本

**python_scripts/training/train_text_clf.py**

**严格按照 PRD.md 第 11.4 节的代码示例实现**：
- ProgressCallback 类（输出 PROGRESS:{json}）
- train_text_classification(dataset_path, hyperparams) 函数
- 使用 bert-base-uncased
- TrainingArguments 配置
- Trainer 训练
- 保存模型
- 返回 JSON 结果
- 异常处理

---

### 任务 5.5: 评估脚本

**python_scripts/evaluation/evaluate_model.py**
- evaluate_model(model_path, test_data_path) 函数
- 加载模型和数据
- 计算指标：accuracy, precision, recall, f1
- 生成混淆矩阵图（matplotlib）
- 保存到 ./reports/cm_{model_id}.png
- 返回 JSON 结果
- 异常处理

---

## 🤖 Phase 6: Agent 层

### 任务 6.1: 数据 Agent

**internal/agents/data_agent.go**

**严格按照 PRD.md 第 11.3 节的代码示例实现**：
- DataAgent 结构体
- NewDataAgent(db *sql.DB) 构造函数
- CleanData(datasetID int) error 方法：
  * 查询数据库获取 original_file_path
  * 调用 Python 脚本
  * 更新数据库（cleaned_file_path, row_count, column_count, status）
- AnalyzeData(datasetID int) (map[string]interface{}, error)

---

### 任务 6.2: 训练 Agent

**internal/agents/training_agent.go**
- TrainingAgent 结构体（db, redis, executor）
- Train(jobID int) error 方法：
  * 查询 job 和 dataset 信息
  * 更新状态为 "running"
  * 启动 Python 训练（goroutine）
  * 实时读取输出，解析 PROGRESS 行
  * 更新 Redis 进度
  * 插入训练日志
  * 训练完成：创建 model 记录，更新 job 状态
  * 错误处理
- GetProgress(jobID int) (map[string]interface{}, error)

使用 bufio.Scanner 实时读取 Python 输出。

---

### 任务 6.3: 评估 Agent

**internal/agents/evaluation_agent.go**
- EvaluationAgent 结构体
- Evaluate(modelID int, testDatasetID int) error 方法：
  * 查询模型信息
  * 如果没有测试集，从训练集分割 20%
  * 调用 Python 评估脚本
  * 保存到 evaluations 表
- GetEvaluationResult(evaluationID int) (*models.Evaluation, error)

---

## 🌐 Phase 7: Service 层

### 任务 7.1: 数据集 Service

**internal/services/dataset_service.go**
- UploadDataset(file multipart.File, name, dataType string, userID int) (*models.Dataset, error)
- CleanDataset(datasetID int) error
- GetDatasetInfo(datasetID int) (*models.Dataset, error)
- GetUserDatasets(userID int) ([]*models.Dataset, error)

---

### 任务 7.2: 训练 Service

**internal/services/training_service.go**
- CreateTrainingJob(datasetID int, modelType string, hyperparams map[string]interface{}) (*models.TrainingJob, error)
- StartTraining(jobID int) error
- GetJobStatus(jobID int) (*models.TrainingJob, error)
- GetJobLogs(jobID int) ([]*models.TrainingLog, error)

---

### 任务 7.3: 评估 Service

**internal/services/evaluation_service.go**
- CreateEvaluation(modelID int, testDatasetID int) (*models.Evaluation, error)
- GetEvaluationResult(evaluationID int) (*models.Evaluation, error)

---

## 🌐 Phase 8: Handler 层（API）

### 任务 8.1: 数据集 Handler

**internal/handlers/dataset_handler.go**

根据 PRD.md 第 6.1.1 节实现：
- UploadDatasetHandler(c *gin.Context)
  * 验证文件类型（只允许 CSV）
  * 验证文件大小（最大 100MB）
  * 调用 Service
  * 返回统一 JSON 格式
- GetDatasetsHandler(c *gin.Context)
- GetDatasetDetailHandler(c *gin.Context)

---

### 任务 8.2: 训练 Handler

**internal/handlers/training_handler.go**

根据 PRD.md 第 6.1.2 节实现：
- CreateJobHandler(c *gin.Context)
- GetJobStatusHandler(c *gin.Context)
- GetJobLogsHandler(c *gin.Context)

---

### 任务 8.3: 模型 Handler

**internal/handlers/model_handler.go**
- GetModelsHandler(c *gin.Context)
- DownloadModelHandler(c *gin.Context)

---

### 任务 8.4: 评估 Handler

**internal/handlers/evaluation_handler.go**

根据 PRD.md 第 6.1.4 节实现：
- CreateEvaluationHandler(c *gin.Context)
- GetEvaluationResultHandler(c *gin.Context)

---

## 🔗 Phase 9: MCP 集成

### 任务 9.1: MCP 消息定义

**internal/mcp/message.go**

根据 PRD.md 第 2.3 节定义：
- MCPMessage 结构体
- NewRequest, NewResponse 函数

---

### 任务 9.2: MCP 协调器

**internal/mcp/coordinator.go**
- Coordinator 结构体（包含三个 Agent）
- NewCoordinator() 构造函数
- RouteMessage(msg *MCPMessage) (*MCPMessage, error)
  * 路由到 data-agent, training-agent, evaluation-agent
- ExecuteWorkflow(datasetID int) error
  * 完整工作流：上传 → 清洗 → 训练 → 评估

---

## 🚀 Phase 10: 主服务器

### 任务 10.1: 实现主程序

**cmd/server/main.go**

包含：
1. 加载配置
2. 连接数据库（PostgreSQL + Redis）
3. 初始化所有 Agent
4. 初始化所有 Service
5. 初始化所有 Handler
6. 配置 Gin 路由（参考 PRD.md 第 6 节）：
   ```
   POST   /api/v1/datasets/upload
   GET    /api/v1/datasets
   GET    /api/v1/datasets/:id
   
   POST   /api/v1/training/jobs
   GET    /api/v1/training/jobs/:id
   GET    /api/v1/training/jobs/:id/logs
   
   GET    /api/v1/models
   GET    /api/v1/models/:id/download
   
   POST   /api/v1/evaluations
   GET    /api/v1/evaluations/:id
   
   POST   /api/v1/workflows/auto-train
   ```
7. 添加 CORS 中间件
8. 添加错误处理中间件
9. 启动训练任务 Worker（3 个 goroutine）
10. 启动服务器（默认 8080）
11. 优雅关闭

---

## 🧪 Phase 11: 测试

### 任务 11.1: 单元测试

创建以下测试文件：
- tests/unit/python_executor_test.go
- tests/unit/data_agent_test.go
- tests/unit/models_test.go

使用 Go 标准库 testing。

---

### 任务 11.2: 集成测试脚本

**tests/integration/e2e_test.sh**

测试完整流程：
1. 启动服务器（后台）
2. 上传数据集
3. 等待清洗完成
4. 创建训练任务
5. 轮询训练状态
6. 创建评估任务
7. 验证所有步骤成功

---

## 📝 Phase 12: 文档

### 任务 12.1: API 文档

**docs/API.md**

根据所有实现的 API 端点，生成完整文档，包括：
- 请求方法和路径
- 请求参数/Body
- 响应格式
- curl 示例
- 错误码说明

---

### 任务 12.2: 部署文档

**docs/DEPLOYMENT.md**
- 生产环境要求
- Docker 部署步骤
- 环境变量配置
- 数据库迁移
- 监控和日志

---

### 任务 12.3: 更新 README

更新 README.md，包含：
- 项目简介
- 功能特性
- 技术栈
- 快速开始（环境要求、安装步骤、启动服务）
- 项目结构说明
- API 文档链接
- 常见问题

---

## 🎯 执行要求

### 工作流程
1. **按顺序完成所有 Phase**
2. **每完成一个 Phase 就告诉我：**
   ```
   ✅ Phase X 完成
   - 创建了哪些文件
   - 实现了哪些功能
   ```
3. **所有代码必须符合 PRD 的设计**
4. **严格使用 PRD 中的代码示例**
5. **遇到问题立即告诉我**

### 代码质量标准
- ✅ 每个函数都有注释
- ✅ 错误处理完善（不要 panic，返回 error）
- ✅ 变量命名清晰（驼峰命名）
- ✅ 导入语句分组（标准库、第三方、本地）
- ✅ SQL 使用参数化查询（防止注入）
- ✅ JSON 使用 struct tag

### 特别注意
1. **Python 脚本必须输出 JSON 格式**
2. **训练脚本必须输出 PROGRESS 行供 Go 实时解析**
3. **所有文件路径使用相对路径**
4. **时间戳使用 time.Now()**
5. **Redis 键名格式：training:progress:{job_id}**

---

## 🚀 现在开始执行

请从 **Phase 1** 开始，按顺序完成所有任务。

每完成一个 Phase，告诉我进度，然后继续下一个。

**现在开始吧！**
