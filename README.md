# MCP Training System

基于 MCP 的多模型协同训练 Agent 系统

## 技术栈

- **后端**: Go 1.21+ (Gin框架)
- **前端**: React 18 + TypeScript + Ant Design 5
- **数据库**: PostgreSQL 14, Redis 7
- **AI框架**: Python 3.8+, PyTorch, Transformers
- **模型**: BERT (文本分类)

## 快速开始

### 启动项目（按顺序执行）

在项目根目录打开终端，依次执行：

| 步骤 | 命令 | 说明 |
|------|------|------|
| 1 | `docker-compose up -d` | 启动 PostgreSQL 和 Redis（需先安装并运行 Docker Desktop） |
| 2 | 初始化数据库 | 见下方「3. 初始化数据库」（首次必须执行） |
| 3 | `cp .env.example .env` | 复制环境变量（首次或未配置时执行） |
| 4 | `go run cmd/server/main.go` | 启动后端，默认 http://localhost:8080 |
| 5 | `cd frontend && npm i && npm run dev` | 安装前端依赖并启动，默认 http://localhost:3000 |

浏览器访问 **http://localhost:3000** 即可使用。若 Docker 未安装，可改用本机安装的 PostgreSQL/Redis，并修改 `.env` 中的连接信息。

---

### 1. 环境准备

**安装依赖**:
```bash
# Go依赖
go mod download

# Python依赖
pip install -r python_scripts/requirements.txt

# 前端依赖
cd frontend
npm install
cd ..
```

### 2. 启动数据库

```bash
docker-compose up -d
```

### 3. 初始化数据库

**方式一（本机已安装 psql）**：
```bash
psql -h localhost -U mcp_user -d mcp_training -f internal/database/migrations/001_init.sql
psql -h localhost -U mcp_user -d mcp_training -f internal/database/migrations/002_seed_default_user.sql
```
（密码见 `.env` 中 `DB_PASSWORD`；`002` 会插入默认用户 id=1，避免上传数据集时报外键错误）

**方式二（用 Docker 容器执行，适合 Windows 未装 psql）**：
```bash
docker exec -i postgres-mcp-training psql -U mcp_user -d mcp_training < internal/database/migrations/001_init.sql
docker exec -i postgres-mcp-training psql -U mcp_user -d mcp_training < internal/database/migrations/002_seed_default_user.sql
```

### 4. 配置环境变量

```bash
cp .env.example .env
# 根据需要修改 .env 文件
```

### 5. 启动后端服务

```bash
go run cmd/server/main.go
```

后端服务将在 `http://localhost:8080` 启动

### 6. 启动前端服务

```bash
cd frontend
npm run dev
```

前端服务将在 `http://localhost:3000` 启动

现在可以通过浏览器访问 `http://localhost:3000` 使用Web界面

## API 使用示例

### 上传数据集

```bash
curl -X POST http://localhost:8080/api/v1/datasets/upload \
  -F "file=@data.csv" \
  -F "name=测试数据集" \
  -F "type=text"
```

### 创建训练任务

```bash
curl -X POST http://localhost:8080/api/v1/training/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "dataset_id": 1,
    "model_type": "text_classification",
    "hyperparams": {
      "learning_rate": 0.00002,
      "batch_size": 16,
      "epochs": 3
    }
  }'
```

### 查询训练状态

```bash
curl http://localhost:8080/api/v1/training/jobs/1
```

### 创建评估任务

```bash
curl -X POST http://localhost:8080/api/v1/evaluations \
  -H "Content-Type: application/json" \
  -d '{
    "model_id": 1,
    "test_dataset_id": 0
  }'
```

## 项目结构

```
mcp-training-system/
├── cmd/server/          # 主程序入口
├── internal/            # 内部包
│   ├── agents/         # Agent层（数据、训练、评估）
│   ├── config/         # 配置管理
│   ├── database/       # 数据库连接和迁移
│   ├── handlers/       # HTTP处理器
│   ├── middleware/     # 中间件
│   ├── models/         # 数据模型
│   └── utils/          # 工具函数
├── python_scripts/      # Python脚本
│   ├── data/           # 数据处理
│   ├── training/       # 模型训练
│   └── evaluation/     # 模型评估
├── frontend/           # 前端项目
│   ├── src/
│   │   ├── components/ # 公共组件
│   │   ├── pages/      # 页面组件
│   │   ├── services/   # API服务层
│   │   └── types/      # TypeScript类型定义
│   ├── package.json
│   └── vite.config.ts
└── docker-compose.yml   # Docker配置
```

## 功能特性

### 后端功能
- ✅ 数据集上传和自动清洗；支持从 URL 链接爬取/导入 CSV
- ✅ BERT文本分类模型训练
- ✅ 实时训练进度监控（WebSocket 推送 + Redis 发布订阅）
- ✅ 模型评估和指标计算（含混淆矩阵、ROC 曲线、HTML 报告及下载）
- ✅ 模型管理：模型列表、模型导出下载（.zip/.pth）
- ✅ 三个Agent通过MCP协议协作
- ✅ RESTful API接口

### 前端功能
- ✅ 现代化Web界面（React + TypeScript + Ant Design）
- ✅ 仪表盘：系统概览和统计信息
- ✅ 数据集管理：本地上传、从 URL 导入、查看、状态监控
- ✅ 训练任务管理：创建任务、配置超参数、进度监控
- ✅ 模型管理：模型列表、下载入口
- ✅ 模型评估：查看评估结果、详细指标及下载 HTML 报告
- ✅ 响应式设计，支持多种屏幕尺寸

### PRD 功能对照（均已实现）
| 功能 | 状态 |
|------|------|
| 模型列表 API `GET /models` | ✅ |
| 模型下载 `GET /models/:id/download` | ✅ |
| 训练日志 API `GET /training/jobs/:id/logs` | ✅ |
| WebSocket 实时进度 `ws://.../ws/training/:id` | ✅ |
| 评估 ROC 曲线生成与存储 | ✅ |
| 评估报告 HTML 及 `GET /reports/download/:id` | ✅ |
| 从 URL 爬取/导入数据集 `POST /datasets/from-url` | ✅ |
| 前端「模型管理」页（列表与下载） | ✅ |

## 使用指南

### 通过Web界面使用

1. **访问系统**
   - 打开浏览器访问 `http://localhost:3000`
   - 系统会显示仪表盘页面

2. **上传或导入数据集**
   - 点击左侧菜单"数据集管理"
   - **本地上传**：点击"上传数据集"，填写名称与类型，选择 CSV 文件（最大 100MB），点击"上传"
   - **从 URL 导入**：点击"从 URL 导入"，填写名称与 CSV 文件链接（http/https），系统会抓取并自动清洗

3. **创建训练任务**
   - 点击左侧菜单"训练任务"
   - 点击"创建训练任务"按钮
   - 选择已就绪的数据集
   - 选择模型类型（文本分类）
   - 配置超参数：
     - 学习率（推荐：0.00002）
     - 批次大小（推荐：16）
     - 训练轮数（推荐：3）
   - 点击"创建"开始训练

4. **监控训练进度**
   - 在训练任务列表中查看任务状态
   - 实时显示训练进度和当前epoch
   - 点击"刷新"按钮更新状态

5. **评估模型**
   - 点击左侧菜单"模型评估"
   - 点击"创建评估任务"按钮
   - 输入训练完成的模型ID
   - 可选：指定测试数据集ID（留空则自动分割）
   - 点击"创建"开始评估

6. **查看评估结果**
   - 在评估列表中点击"查看详情"
   - 查看准确率、精确率、召回率、F1分数等指标

## 开发者

本项目严格按照PRD文档实现，包含完整的数据库设计、Agent架构、API接口和Web前端界面。

### 技术文档
- 详细API文档：`docs/API.md`
- 部署文档：`docs/DEPLOYMENT.md`
- 前端文档：`frontend/README.md`
- 产品需求文档：`PRD.md`

