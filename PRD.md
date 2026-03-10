**文档版本**: v1.0  
**创建日期**: 2026-01-10

---

## 📋 目录
~~1. [项目概述](https://claude.ai/chat/c0cb9ea7-21d4-426f-ad36-171fc62ba8af#1-%E9%A1%B9%E7%9B%AE%E6%A6%82%E8%BF%B0)
2. [系统架构](https://claude.ai/chat/c0cb9ea7-21d4-426f-ad36-171fc62ba8af#2-%E7%B3%BB%E7%BB%9F%E6%9E%B6%E6%9E%84)
3. [技术栈](https://claude.ai/chat/c0cb9ea7-21d4-426f-ad36-171fc62ba8af#3-%E6%8A%80%E6%9C%AF%E6%A0%88)
4. [数据库设计](https://claude.ai/chat/c0cb9ea7-21d4-426f-ad36-171fc62ba8af#4-%E6%95%B0%E6%8D%AE%E5%BA%93%E8%AE%BE%E8%AE%A1)
5. [核心功能模块](https://claude.ai/chat/c0cb9ea7-21d4-426f-ad36-171fc62ba8af#5-%E6%A0%B8%E5%BF%83%E5%8A%9F%E8%83%BD%E6%A8%A1%E5%9D%97)
6. [API 设计](https://claude.ai/chat/c0cb9ea7-21d4-426f-ad36-171fc62ba8af#6-api-%E8%AE%BE%E8%AE%A1)
7. [开发优先级](https://claude.ai/chat/c0cb9ea7-21d4-426f-ad36-171fc62ba8af#7-%E5%BC%80%E5%8F%91%E4%BC%98%E5%85%88%E7%BA%A7)
8. [非功能性需求](https://claude.ai/chat/c0cb9ea7-21d4-426f-ad36-171fc62ba8af#8-%E9%9D%9E%E5%8A%9F%E8%83%BD%E6%80%A7%E9%9C%80%E6%B1%82)
9. [项目结构](https://claude.ai/chat/c0cb9ea7-21d4-426f-ad36-171fc62ba8af#9-%E9%A1%B9%E7%9B%AE%E7%BB%93%E6%9E%84)
10. [开发指南](https://claude.ai/chat/c0cb9ea7-21d4-426f-ad36-171fc62ba8af#10-%E5%BC%80%E5%8F%91%E6%8C%87%E5%8D%97)~~

---

## 1. 项目概述
### 1.1 项目背景
普通用户在训练机器学习模型时面临以下痛点：

+ **技术门槛高**：不懂 ML 原理、不会调参
+ **流程繁琐**：数据处理、训练、评估需要多工具操作
+ **缺乏自动化**：超参数调优、训练监控需人工干预

### 1.2 项目目标
构建一个自动化的模型训练平台，用户只需：

1. 上传数据集
2. 选择模型类型
3. 点击开始训练
4. 获得训练好的模型和评估报告

### 1.3 核心价值
+ **降低门槛**：非专业用户也能训练 AI 模型
+ **全流程自动化**：从数据清洗到模型评估一键完成
+ **智能调优**：自动调整学习率、Batch Size 等超参数
+ **数据私有化**：支持用户私有数据集

### 1.4 MVP 范围
**必须实现**：

+ ✅ 用户上传数据集（本地 CSV 文件）
+ ✅ 数据自动清洗（去重、缺失值处理）
+ ✅ 支持至少 1 种模型类型（文本分类）
+ ✅ 基础超参数调优（学习率动态调整）
+ ✅ 训练进度实时监控（Agent 之间通过 MCP 进行通信，通报实时训练进度，反馈到前端 Web 界面）
+ ✅ 模型评估（准确率、损失曲线）
+ ✅ 模型导出（下载 .pth 文件）
+ ✅ 三个 Agent 通过 MCP 协议通信
+ ✅ URL 链接爬取数据
+ ✅ 详细评估报告（混淆矩阵、ROC 曲线）
+ ✅ 简单的 Web 前端界面

可选：

+ [ ] 支持图像分类模型



---

## 2. 系统架构
### 2.1 整体架构图
```plain
┌─────────────────────────────────────────────────┐
│              前端层（可选）                       │
│         数据上传 | 任务管理 | 结果查看            │
└─────────────────────────────────────────────────┘
                        ↓ HTTP API
┌─────────────────────────────────────────────────┐
│              MCP 协调层（Go）                    │
│  - HTTP Server (Gin)                             │
│  - 任务调度器                                     │
│  - Agent 生命周期管理                             │
│  - MCP 消息路由                                  │
└─────────────────────────────────────────────────┘
         ↓                ↓                ↓
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ 数据 Agent    │  │ 训练 Agent    │  │ 评估 Agent    │
│  (Go 壳)     │  │  (Go 壳)     │  │  (Go 壳)     │
│      ↓       │  │      ↓       │  │      ↓       │
│ Python 核心  │  │ Python 核心  │  │ Python 核心  │
│ - Pandas     │  │ - PyTorch    │  │ - Sklearn    │
│ - 数据清洗    │  │ - 模型训练    │  │ - 模型评估    │
└──────────────┘  └──────────────┘  └──────────────┘
         ↓                ↓                ↓
┌─────────────────────────────────────────────────┐
│            数据存储层                             │
│  PostgreSQL (元数据)  |  Redis (队列/缓存)        │
└─────────────────────────────────────────────────┘
```

### 2.2 数据流向
```plain
用户上传数据
    ↓
MCP 协调层接收请求
    ↓
调度数据 Agent
    ↓
数据 Agent (Go) → 调用 Python 脚本清洗数据
    ↓
保存清洗后数据到文件系统
    ↓
更新数据库状态为 "ready"
    ↓
MCP 协调层调度训练 Agent
    ↓
训练 Agent (Go) → 调用 Python 脚本训练模型
    ↓
实时输出训练进度（通过 Redis 发布）
    ↓
训练完成，保存模型文件
    ↓
MCP 协调层调度评估 Agent
    ↓
评估 Agent (Go) → 调用 Python 脚本评估模型
    ↓
生成评估报告（JSON + 图表）
    ↓
保存到数据库，返回结果给用户
```

### 2.3 MCP 消息通信
MCP（Model Context Protocol）是 Agent 间的通信协议。

**消息格式**：

```json
{
  "id": "msg-123",
  "type": "request",
  "from": "mcp-coordinator",
  "to": "data-agent",
  "action": "clean_data",
  "payload": {
    "dataset_id": 1,
    "file_path": "/data/uploads/dataset_1.csv"
  },
  "timestamp": "2026-01-10T12:00:00Z"
}
```

**响应格式**：

```json
{
  "id": "msg-124",
  "type": "response",
  "from": "data-agent",
  "to": "mcp-coordinator",
  "action": "clean_data",
  "payload": {
    "status": "success",
    "row_count": 1000,
    "output_path": "/data/cleaned/dataset_1_cleaned.csv"
  },
  "timestamp": "2026-01-10T12:01:30Z"
}
```

---

## 3. 技术栈
### 3.1 后端（Go）
| 组件 | 技术选型 | 版本 | 用途 |
| --- | --- | --- | --- |
| Web 框架 | Gin | v1.9+ | HTTP API 服务 |
| 数据库驱动 | lib/pq | v1.10+ | PostgreSQL 连接 |
| Redis 客户端 | go-redis | v9.0+ | 任务队列、缓存 |
| UUID 生成 | google/uuid | v1.3+ | 生成唯一 ID |
| JSON 处理 | encoding/json | 标准库 | - |
| 进程管理 | os/exec | 标准库 | 调用 Python 脚本 |


### 3.2 Agent 核心（Python）
| 组件 | 技术选型 | 版本 | 用途 |
| --- | --- | --- | --- |
| 数据处理 | Pandas | 2.0+ | 数据清洗、分析 |
| 数值计算 | NumPy | 1.24+ | 数组操作 |
| 深度学习 | PyTorch | 2.0+ | 模型训练 |
| 预训练模型 | Transformers | 4.30+ | BERT 等模型 |
| 数据集 | Datasets | 2.12+ | HuggingFace 数据集 |
| 评估指标 | Scikit-learn | 1.3+ | 准确率、F1 等 |
| 可视化 | Matplotlib | 3.7+ | 生成图表 |


### 3.3 数据库
| 组件 | 版本 | 用途 |
| --- | --- | --- |
| PostgreSQL | 14+ | 存储用户、数据集、任务、模型元数据 |
| Redis | 7.0+ | 任务队列、训练进度缓存 |


### 3.4 前端（可选）
| 组件 | 版本 | 用途 |
| --- | --- | --- |
| React | 18+ | UI 框架 |
| Ant Design | 5.0+ | UI 组件库 |
| Axios | 1.4+ | HTTP 请求 |


---

## 4. 数据库设计
### 4.1 PostgreSQL 表结构
#### 表 1: users（用户表）
```sql
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    email VARCHAR(100) UNIQUE,
    password_hash VARCHAR(255),  -- 可选，暂不实现认证
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

#### 表 2: datasets（数据集表）
```sql
CREATE TABLE datasets (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    type VARCHAR(50) NOT NULL,  -- 'text', 'image', 'multimodal'
    source VARCHAR(500),  -- 'local' or URL
    original_file_path VARCHAR(500),
    cleaned_file_path VARCHAR(500),
    row_count INT,
    column_count INT,
    file_size BIGINT,  -- bytes
    status VARCHAR(50) DEFAULT 'uploading',  -- 'uploading', 'processing', 'ready', 'error'
    error_message TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_datasets_user_id ON datasets(user_id);
CREATE INDEX idx_datasets_status ON datasets(status);
```

#### 表 3: training_jobs（训练任务表）
```sql
CREATE TABLE training_jobs (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    dataset_id INT REFERENCES datasets(id) ON DELETE CASCADE,
    model_type VARCHAR(100) NOT NULL,  -- 'text_classification', 'image_classification'
    hyperparams JSONB,  -- {"learning_rate": 0.001, "batch_size": 32, "epochs": 10}
    status VARCHAR(50) DEFAULT 'queued',  -- 'queued', 'running', 'completed', 'failed'
    progress INT DEFAULT 0,  -- 0-100
    current_epoch INT DEFAULT 0,
    total_epochs INT,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_jobs_user_id ON training_jobs(user_id);
CREATE INDEX idx_jobs_status ON training_jobs(status);
```

#### 表 4: models（模型表）
```sql
CREATE TABLE models (
    id SERIAL PRIMARY KEY,
    job_id INT REFERENCES training_jobs(id) ON DELETE CASCADE,
    name VARCHAR(200),
    model_path VARCHAR(500) NOT NULL,
    model_size BIGINT,  -- bytes
    model_type VARCHAR(100),
    framework VARCHAR(50) DEFAULT 'pytorch',  -- 'pytorch', 'tensorflow'
    is_deployed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_models_job_id ON models(job_id);
```

#### 表 5: training_logs（训练日志表）
```sql
CREATE TABLE training_logs (
    id SERIAL PRIMARY KEY,
    job_id INT REFERENCES training_jobs(id) ON DELETE CASCADE,
    epoch INT NOT NULL,
    loss FLOAT,
    accuracy FLOAT,
    learning_rate FLOAT,
    log_time TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_logs_job_id ON training_logs(job_id);
```

#### 表 6: evaluations（评估结果表）
```sql
CREATE TABLE evaluations (
    id SERIAL PRIMARY KEY,
    model_id INT REFERENCES models(id) ON DELETE CASCADE,
    accuracy FLOAT,
    precision FLOAT,
    recall FLOAT,
    f1_score FLOAT,
    metrics JSONB,  -- 完整的评估指标 JSON
    confusion_matrix_path VARCHAR(500),
    roc_curve_path VARCHAR(500),
    report_path VARCHAR(500),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_eval_model_id ON evaluations(model_id);
```

### 4.2 Redis 数据结构
#### 任务队列
```plain
Key: training:queue
Type: List (LPUSH/RPOP)
Value: job_id (整数)

示例:
LPUSH training:queue 1
RPOP training:queue  # 返回 "1"
```

#### 训练进度
```plain
Key: training:progress:{job_id}
Type: Hash
Fields:
  - epoch: 当前 epoch
  - loss: 当前 loss
  - accuracy: 当前准确率
  - timestamp: 时间戳

示例:
HSET training:progress:1 epoch 5 loss 0.23 accuracy 0.87
HGETALL training:progress:1
```

#### Agent 状态
```plain
Key: agent:status:{agent_name}
Type: String
Value: "idle" | "busy"
Expiry: 60 seconds

示例:
SET agent:status:data-agent "busy" EX 60
```

---

## 5. 核心功能模块
### 5.1 数据 Agent
#### 功能 1: 数据上传
**输入**:

+ 文件：CSV 文件
+ 元数据：数据集名称、类型

**处理流程**:

1. 接收文件上传请求
2. 保存文件到 `/data/uploads/dataset_{id}.csv`
3. 在数据库中创建 dataset 记录，状态为 `uploading`
4. 返回 dataset_id

**输出**:

```json
{
  "dataset_id": 1,
  "status": "uploading"
}
```

#### 功能 2: 数据清洗
**输入**:

```json
{
  "dataset_id": 1
}
```

**处理流程**:

1. Go Agent 接收 MCP 消息
2. 从数据库读取 `original_file_path`
3. 调用 Python 脚本 `clean_data.py`
4. Python 脚本执行： 
    - 读取 CSV 文件
    - 去重 (`df.drop_duplicates()`)
    - 删除缺失值 (`df.dropna()`)
    - 保存到 `/data/cleaned/dataset_{id}_cleaned.csv`
    - 返回统计信息（行数、列数）
5. Go Agent 更新数据库： 
    - `cleaned_file_path`
    - `row_count`, `column_count`
    - `status = 'ready'`

**输出**:

```json
{
  "status": "success",
  "original_rows": 1500,
  "cleaned_rows": 1200,
  "columns": ["text", "label"]
}
```

#### 功能 3: 数据分析
**输入**:

```json
{
  "dataset_id": 1
}
```

**处理流程**:

1. 调用 Python 脚本 `analyze_data.py`
2. 生成统计信息： 
    - 每列的数据类型
    - 数值列的均值、方差
    - 分类列的类别分布
3. 生成可视化图表（可选）

**输出**:

```json
{
  "stats": {
    "text": {"type": "string", "null_count": 0},
    "label": {"type": "int", "distribution": {"0": 600, "1": 600}}
  }
}
```

---

### 5.2 训练 Agent
#### 功能 1: 创建训练任务
**输入**:

```json
{
  "dataset_id": 1,
  "model_type": "text_classification",
  "hyperparams": {
    "learning_rate": 0.001,
    "batch_size": 32,
    "epochs": 10
  }
}
```

**处理流程**:

1. 验证 dataset 状态为 `ready`
2. 在数据库创建 training_job 记录，状态为 `queued`
3. 将 job_id 推入 Redis 队列 `training:queue`
4. 返回 job_id

**输出**:

```json
{
  "job_id": 1,
  "status": "queued"
}
```

#### 功能 2: 执行训练
**输入**: 从 Redis 队列 pop 出 job_id

**处理流程**:

1. 从数据库读取 job 信息
2. 更新状态为 `running`, `started_at = NOW()`
3. 调用 Python 脚本 `train_model.py`（异步）
4. Python 脚本执行： 

```python
# 伪代码model = BertForSequenceClassification(num_labels=2)trainer = Trainer(    model=model,    args=TrainingArguments(        learning_rate=hyperparams['learning_rate'],        per_device_train_batch_size=hyperparams['batch_size'],        num_train_epochs=hyperparams['epochs'],        logging_steps=10    ),    train_dataset=dataset)# 训练时输出进度（JSON 格式，Go 可解析）trainer.train()trainer.save_model(f"./models/job_{job_id}")
```

5. Go Agent 监听 Python 输出，实时解析进度
6. 更新 Redis `training:progress:{job_id}`
7. 每个 epoch 结束，插入 `training_logs` 表
8. 训练完成后： 
    - 更新 job 状态为 `completed`
    - 在 `models` 表插入记录
    - 返回 model_id

**输出**:

```json
{
  "status": "completed",
  "model_id": 1,
  "final_loss": 0.12,
  "final_accuracy": 0.94
}
```

#### 功能 3: 进度监控
**输入**:

```json
{
  "job_id": 1
}
```

**处理流程**:

1. 查询 Redis `training:progress:{job_id}`
2. 查询数据库 `training_jobs` 表获取状态

**输出**:

```json
{
  "status": "running",
  "progress": 50,
  "current_epoch": 5,
  "total_epochs": 10,
  "current_loss": 0.23,
  "current_accuracy": 0.87
}
```

---

### 5.3 评估 Agent
#### 功能 1: 模型评估
**输入**:

```json
{
  "model_id": 1,
  "test_dataset_id": 2  // 可选，使用单独的测试集
}
```

**处理流程**:

1. 从数据库读取模型路径和训练数据集
2. 如果没有提供测试集，自动从训练集分割 20% 作为测试集
3. 调用 Python 脚本 `evaluate_model.py`
4. Python 脚本执行： 

```python
# 加载模型model = AutoModelForSequenceClassification.from_pretrained(model_path)# 预测predictions = trainer.predict(test_dataset)# 计算指标accuracy = accuracy_score(labels, predictions)precision, recall, f1, _ = precision_recall_fscore_support(labels, predictions)# 生成混淆矩阵图cm = confusion_matrix(labels, predictions)plot_confusion_matrix(cm, save_path="./reports/cm_{model_id}.png")# 返回结果return {    "accuracy": accuracy,    "precision": precision,    "recall": recall,    "f1_score": f1}
```

5. 保存结果到 `evaluations` 表

**输出**:

```json
{
  "evaluation_id": 1,
  "accuracy": 0.94,
  "precision": 0.93,
  "recall": 0.95,
  "f1_score": 0.94,
  "confusion_matrix_path": "/reports/cm_1.png"
}
```

#### 功能 2: 生成评估报告
**输入**:

```json
{
  "evaluation_id": 1
}
```

**处理流程**:

1. 查询 `evaluations` 表
2. 生成 HTML 报告（包含图表）
3. 保存为 `/reports/eval_{evaluation_id}.html`

**输出**:

```json
{
  "report_path": "/reports/eval_1.html",
  "download_url": "/api/reports/download/1"
}
```

---

## 6. API 设计
### 6.1 RESTful API
#### Base URL
```plain
http://localhost:8080/api/v1
```

#### 6.1.1 数据集管理
**上传数据集**

```http
POST /datasets/upload
Content-Type: multipart/form-data

参数:
- file: CSV 文件
- name: 数据集名称
- type: 数据类型 (text/image)

响应:
{
  "code": 200,
  "message": "success",
  "data": {
    "dataset_id": 1,
    "status": "uploading"
  }
}
```

**获取数据集列表**

```http
GET /datasets?user_id=1&status=ready

响应:
{
  "code": 200,
  "data": {
    "total": 10,
    "datasets": [
      {
        "id": 1,
        "name": "情感分类数据集",
        "type": "text",
        "row_count": 1200,
        "status": "ready",
        "created_at": "2026-01-10T12:00:00Z"
      }
    ]
  }
}
```

**获取数据集详情**

```http
GET /datasets/{dataset_id}

响应:
{
  "code": 200,
  "data": {
    "id": 1,
    "name": "情感分类数据集",
    "type": "text",
    "row_count": 1200,
    "column_count": 2,
    "columns": ["text", "label"],
    "status": "ready",
    "stats": {
      "label_distribution": {"0": 600, "1": 600}
    }
  }
}
```

#### 6.1.2 训练任务管理
**创建训练任务**

```http
POST /training/jobs
Content-Type: application/json

Body:
{
  "dataset_id": 1,
  "model_type": "text_classification",
  "hyperparams": {
    "learning_rate": 0.001,
    "batch_size": 32,
    "epochs": 10
  }
}

响应:
{
  "code": 200,
  "data": {
    "job_id": 1,
    "status": "queued"
  }
}
```

**获取训练任务状态**

```http
GET /training/jobs/{job_id}

响应:
{
  "code": 200,
  "data": {
    "id": 1,
    "status": "running",
    "progress": 50,
    "current_epoch": 5,
    "total_epochs": 10,
    "current_loss": 0.23,
    "current_accuracy": 0.87,
    "started_at": "2026-01-10T12:05:00Z"
  }
}
```

**获取训练日志**

```http
GET /training/jobs/{job_id}/logs

响应:
{
  "code": 200,
  "data": {
    "logs": [
      {"epoch": 1, "loss": 0.65, "accuracy": 0.72, "timestamp": "..."},
      {"epoch": 2, "loss": 0.45, "accuracy": 0.81, "timestamp": "..."}
    ]
  }
}
```

#### 6.1.3 模型管理
**获取模型列表**

```http
GET /models?user_id=1

响应:
{
  "code": 200,
  "data": {
    "models": [
      {
        "id": 1,
        "name": "BERT 情感分类模型",
        "model_type": "text_classification",
        "accuracy": 0.94,
        "created_at": "2026-01-10T12:30:00Z"
      }
    ]
  }
}
```

**下载模型**

```http
GET /models/{model_id}/download

响应: 模型文件流 (application/octet-stream)
```

#### 6.1.4 评估管理
**创建评估任务**

```http
POST /evaluations
Content-Type: application/json

Body:
{
  "model_id": 1,
  "test_dataset_id": 2  // 可选
}

响应:
{
  "code": 200,
  "data": {
    "evaluation_id": 1,
    "status": "processing"
  }
}
```

**获取评估结果**

```http
GET /evaluations/{evaluation_id}

响应:
{
  "code": 200,
  "data": {
    "id": 1,
    "accuracy": 0.94,
    "precision": 0.93,
    "recall": 0.95,
    "f1_score": 0.94,
    "confusion_matrix_url": "/api/reports/cm_1.png",
    "report_url": "/api/reports/eval_1.html"
  }
}
```

### 6.2 WebSocket API（实时进度）
**连接**

```plain
ws://localhost:8080/ws/training/{job_id}
```

**消息格式**

```json
{
  "type": "progress",
  "data": {
    "epoch": 5,
    "loss": 0.23,
    "accuracy": 0.87,
    "timestamp": "2026-01-10T12:15:30Z"
  }
}
```

---

## 7. 开发优先级
### Phase 1: 核心基础（Week 1-4）
**优先级 P0（最高）**:

1. ✅ 搭建 Go 项目框架
2. ✅ 数据库设计与初始化
3. ✅ 实现数据上传 API
4. ✅ 实现数据清洗功能（Data Agent）
5. ✅ Go 调用 Python 脚本的通用方法

**交付物**:

+ 用户可以上传 CSV 文件
+ 系统自动清洗数据
+ 数据库正确保存元数据

### Phase 2: 训练功能（Week 5-8）
**优先级 P0**:

1. ✅ 实现文本分类模型训练（Training Agent）
2. ✅ 训练进度监控（Redis + WebSocket）
3. ✅ 训练日志记录
4. ✅ 模型保存

**优先级 P1**:

1. ✅ 学习率动态调整
2. ✅ Early Stopping

**交付物**:

+ 用户可以选择数据集开始训练
+ 实时查看训练进度
+ 训练完成后保存模型

### Phase 3: 评估功能（Week 9-10）
**优先级 P0**:

1. ✅ 模型评估（Evaluation Agent）
2. ✅ 计算准确率、精确率、召回率、F1
3. ✅ 生成评估报告

**优先级 P1**:

1. ⭕ 混淆矩阵可视化
2. ⭕ ROC 曲线

**交付物**:

+ 用户可以查看模型评估结果
+ 下载评估报告

### Phase 4: MCP 集成（Week 11-12）
**优先级 P0**:

1. ✅ 实现 MCP 协调层
2. ✅ Agent 之间通过 MCP 消息通信
3. ✅ 完整工作流：上传 → 清洗 → 训练 → 评估

**交付物**:

+ 三个 Agent 通过 MCP 协议协作
+ 完整的自动化训练流程

### Phase 5: 优化与测试（Week 13-14）
**优先级 P1**:

1. ⭕ 性能优化（数据库查询、并发）
2. ⭕ 错误处理与重试
3. ⭕ 单元测试
4. ⭕ 集成测试

**优先级 P2（可选）**:

1. ⭕ 简单的 Web 前端
2. ⭕ 支持图像分类模型

---

## 8. 非功能性需求
### 8.1 性能要求
| 指标 | 目标值 |
| --- | --- |
| API 响应时间 | < 200ms (非训练接口) |
| 数据上传速度 | 支持 100MB 文件 < 10s |
| 并发训练任务 | 至少 3 个 |
| 数据库查询 | < 50ms |


### 8.2 可靠性要求
+ **训练任务失败重试**: 自动重试 3 次
+ **数据备份**: 训练完成后模型文件保留至少 7 天
+ **日志记录**: 所有 Agent 操作记录日志

### 8.3 安全性要求（简化）
+ **文件上传验证**: 仅允许 CSV 文件，最大 100MB
+ **SQL 注入防护**: 使用参数化查询
+ **路径遍历防护**: 验证文件路径

### 8.4 可维护性要求
+ **代码规范**: 遵循 Go 官方代码规范
+ **注释覆盖**: 关键函数必须有注释
+ **错误处理**: 所有错误必须返回明确信息

---

## 9. 项目结构
```plain
mcp-training-system/
├── README.md
├── go.mod
├── go.sum
├── Makefile
├── docker-compose.yml
│
├── cmd/
│   └── server/
│       └── main.go                 # 程序入口
│
├── internal/
│   ├── config/
│   │   └── config.go               # 配置管理
│   │
│   ├── database/
│   │   ├── postgres.go             # PostgreSQL 连接
│   │   ├── redis.go                # Redis 连接
│   │   └── migrations/             # 数据库迁移脚本
│   │       └── 001_init.sql
│   │
│   ├── models/
│   │   ├── dataset.go              # Dataset 模型
│   │   ├── job.go                  # TrainingJob 模型
│   │   ├── model.go                # Model 模型
│   │   └── evaluation.go           # Evaluation 模型
│   │
│   ├── handlers/
│   │   ├── dataset_handler.go      # 数据集 API Handler
│   │   ├── training_handler.go     # 训练 API Handler
│   │   ├── model_handler.go        # 模型 API Handler
│   │   └── evaluation_handler.go   # 评估 API Handler
│   │
│   ├── services/
│   │   ├── dataset_service.go      # 数据集业务逻辑
│   │   ├── training_service.go     # 训练业务逻辑
│   │   └── evaluation_service.go   # 评估业务逻辑
│   │
│   ├── mcp/
│   │   ├── coordinator.go          # MCP 协调器
│   │   ├── message.go              # MCP 消息定义
│   │   └── router.go               # MCP 消息路由
│   │
│   ├── agents/
│   │   ├── base_agent.go           # Agent 基类
│   │   ├── data_agent.go           # 数据 Agent
│   │   ├── training_agent.go       # 训练 Agent
│   │   └── evaluation_agent.go     # 评估 Agent
│   │
│   ├── utils/
│   │   ├── python_executor.go      # Python 脚本执行器
│   │   ├── file_utils.go           # 文件操作工具
│   │   └── logger.go               # 日志工具
│   │
│   └── middleware/
│       ├── cors.go                 # CORS 中间件
│       └── error_handler.go        # 错误处理中间件
│
├── python_scripts/
│   ├── requirements.txt            # Python 依赖
│   ├── common/
│   │   └── utils.py                # 通用工具函数
│   ├── data/
│   │   ├── clean_data.py           # 数据清洗
│   │   └── analyze_data.py         # 数据分析
│   ├── training/
│   │   ├── train_text_clf.py       # 文本分类训练
│   │   └── train_image_clf.py      # 图像分类训练（可选）
│   └── evaluation/
│       └── evaluate_model.py       # 模型评估
│
├── data/
│   ├── uploads/                    # 上传的原始数据
│   ├── cleaned/                    # 清洗后的数据
│   └── models/                     # 训练的模型
│
├── reports/                        # 评估报告
│
├── logs/                           # 日志文件
│
└── tests/
    ├── integration/                # 集成测试
    └── unit/                       # 单元测试
```

---

## 10. 开发指南
### 10.1 环境准备
**Go 环境**:

```bash
# 1. 安装 Go 1.21+
go version

# 2. 初始化项目
mkdir mcp-training-system
cd mcp-training-system
go mod init mcp-training-system

# 3. 安装依赖
go get github.com/gin-gonic/gin
go get github.com/lib/pq
go get github.com/go-redis/redis/v9
go get github.com/google/uuid
```

**Python 环境**:

```bash
# 1. 创建虚拟环境
python3 -m venv venv
source venv/bin/activate  # Linux/Mac
# venv\Scripts\activate   # Windows

# 2. 安装依赖
pip install pandas numpy torch transformers datasets scikit-learn matplotlib
```

**数据库**:

```bash
# 使用 Docker Compose 启动
docker-compose up -d
```

`docker-compose.yml`:

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:14
    environment:
      POSTGRES_USER: mcp_user
      POSTGRES_PASSWORD: mcp_password
      POSTGRES_DB: mcp_training
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

volumes:
  postgres_data:
  redis_data:
```

### 10.2 开发流程
**Step 1: 创建数据库**

```bash
# 连接 PostgreSQL
psql -h localhost -U mcp_user -d mcp_training

# 执行初始化脚本
\i internal/database/migrations/001_init.sql
```

**Step 2: 实现 Go 后端**

```bash
# 1. 实现数据库连接
# internal/database/postgres.go

# 2. 实现模型定义
# internal/models/dataset.go

# 3. 实现 API Handler
# internal/handlers/dataset_handler.go

# 4. 实现业务逻辑
# internal/services/dataset_service.go

# 5. 启动服务器
go run cmd/server/main.go
```

**Step 3: 实现 Python 脚本**

```bash
# 1. 创建数据清洗脚本
# python_scripts/data/clean_data.py

# 2. 测试脚本
python python_scripts/data/clean_data.py ./data/test.csv
```

**Step 4: Go 调用 Python**

```go
// internal/utils/python_executor.go
func CallPython(script string, args ...string) (map[string]interface{}, error) {
    cmd := exec.Command("python3", append([]string{script}, args...)...)
    output, err := cmd.Output()
    // ...解析 JSON 输出
}
```

**Step 5: 实现 Agent**

```go
// internal/agents/data_agent.go
func (a *DataAgent) CleanData(datasetID int) error {
    // 1. 查询数据库获取文件路径
    // 2. 调用 Python 脚本
    // 3. 更新数据库
}
```

**Step 6: 集成 MCP**

```go
// internal/mcp/coordinator.go
func (c *Coordinator) RouteMessage(msg Message) error {
    switch msg.To {
    case "data-agent":
        return c.dataAgent.HandleMessage(msg)
    case "training-agent":
        return c.trainingAgent.HandleMessage(msg)
    // ...
    }
}
```

### 10.3 测试
**单元测试**:

```bash
go test ./internal/services/... -v
```

**集成测试**:

```bash
# 1. 启动服务
go run cmd/server/main.go

# 2. 运行测试脚本
curl -X POST http://localhost:8080/api/v1/datasets/upload \
  -F "file=@test.csv" \
  -F "name=测试数据集" \
  -F "type=text"
```

**Python 脚本测试**:

```bash
python python_scripts/data/clean_data.py ./data/test.csv
```

### 10.4 调试技巧
**Go 调试**:

```bash
# 使用 delve
go install github.com/go-delve/delve/cmd/dlv@latest
dlv debug cmd/server/main.go
```

**Python 调试**:

```python
# 在脚本中添加
import pdb; pdb.set_trace()
```

**日志输出**:

```go
// internal/utils/logger.go
log.Printf("[DATA-AGENT] Cleaning dataset %d", datasetID)
```

---

## 11. 关键代码示例
### 11.1 Go 调用 Python（通用方法）
```go
// internal/utils/python_executor.go
package utils

import (
    "encoding/json"
    "fmt"
    "os/exec"
    "path/filepath"
)

type PythonExecutor struct {
    pythonPath string
    scriptsDir string
}

func NewPythonExecutor() *PythonExecutor {
    return &PythonExecutor{
        pythonPath: "python3",
        scriptsDir: "./python_scripts",
    }
}

func (e *PythonExecutor) Execute(script string, args ...string) (map[string]interface{}, error) {
    scriptPath := filepath.Join(e.scriptsDir, script)
    cmdArgs := append([]string{scriptPath}, args...)
    
    cmd := exec.Command(e.pythonPath, cmdArgs...)
    output, err := cmd.CombinedOutput()
    if err != nil {
        return nil, fmt.Errorf("python execution failed: %v, output: %s", err, string(output))
    }
    
    var result map[string]interface{}
    if err := json.Unmarshal(output, &result); err != nil {
        return nil, fmt.Errorf("failed to parse python output: %v", err)
    }
    
    return result, nil
}
```

### 11.2 数据清洗 Python 脚本
```python
# python_scripts/data/clean_data.py
import sys
import json
import pandas as pd

def clean_data(file_path):
    try:
        # 读取数据
        df = pd.read_csv(file_path)
        original_rows = len(df)
        
        # 去重
        df = df.drop_duplicates()
        
        # 删除缺失值
        df = df.dropna()
        
        # 保存清洗后的数据
        output_path = file_path.replace('.csv', '_cleaned.csv')
        df.to_csv(output_path, index=False)
        
        # 返回结果
        result = {
            "status": "success",
            "original_rows": original_rows,
            "cleaned_rows": len(df),
            "columns": list(df.columns),
            "output_path": output_path
        }
        
        print(json.dumps(result))
        
    except Exception as e:
        error_result = {
            "status": "error",
            "error_message": str(e)
        }
        print(json.dumps(error_result))
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"status": "error", "error_message": "Missing file path"}))
        sys.exit(1)
    
    file_path = sys.argv[1]
    clean_data(file_path)
```

### 11.3 数据 Agent 实现
```go
// internal/agents/data_agent.go
package agents

import (
    "database/sql"
    "fmt"
    "mcp-training-system/internal/utils"
)

type DataAgent struct {
    db       *sql.DB
    executor *utils.PythonExecutor
}

func NewDataAgent(db *sql.DB) *DataAgent {
    return &DataAgent{
        db:       db,
        executor: utils.NewPythonExecutor(),
    }
}

func (a *DataAgent) CleanData(datasetID int) error {
    // 1. 查询数据库获取文件路径
    var filePath string
    err := a.db.QueryRow(
        "SELECT original_file_path FROM datasets WHERE id = $1",
        datasetID,
    ).Scan(&filePath)
    if err != nil {
        return fmt.Errorf("failed to query dataset: %v", err)
    }
    
    // 2. 调用 Python 脚本
    result, err := a.executor.Execute("data/clean_data.py", filePath)
    if err != nil {
        return err
    }
    
    // 3. 检查执行状态
    if result["status"] != "success" {
        return fmt.Errorf("python script failed: %v", result["error_message"])
    }
    
    // 4. 更新数据库
    _, err = a.db.Exec(`
        UPDATE datasets 
        SET cleaned_file_path = $1, 
            row_count = $2, 
            column_count = $3,
            status = 'ready',
            updated_at = NOW()
        WHERE id = $4
    `,
        result["output_path"],
        int(result["cleaned_rows"].(float64)),
        len(result["columns"].([]interface{})),
        datasetID,
    )
    
    return err
}
```

### 11.4 训练 Python 脚本
```python
# python_scripts/training/train_text_clf.py
import sys
import json
import torch
from datasets import load_dataset
from transformers import (
    AutoTokenizer,
    AutoModelForSequenceClassification,
    TrainingArguments,
    Trainer,
    TrainerCallback
)

class ProgressCallback(TrainerCallback):
    """输出训练进度，供 Go 解析"""
    def on_log(self, args, state, control, logs=None, **kwargs):
        if logs:
            progress = {
                "epoch": state.epoch,
                "loss": logs.get("loss", 0),
                "learning_rate": logs.get("learning_rate", 0),
                "step": state.global_step,
                "max_steps": state.max_steps
            }
            # 输出到 stdout，Go 可实时读取
            print(f"PROGRESS:{json.dumps(progress)}", flush=True)

def train_text_classification(dataset_path, hyperparams):
    # 1. 加载数据
    dataset = load_dataset('csv', data_files={'train': dataset_path})
    
    # 2. Tokenize
    tokenizer = AutoTokenizer.from_pretrained("bert-base-uncased")
    def tokenize_function(examples):
        return tokenizer(examples["text"], padding="max_length", truncation=True)
    
    tokenized_dataset = dataset.map(tokenize_function, batched=True)
    
    # 3. 加载模型
    model = AutoModelForSequenceClassification.from_pretrained(
        "bert-base-uncased",
        num_labels=2
    )
    
    # 4. 训练参数
    training_args = TrainingArguments(
        output_dir="./results",
        learning_rate=hyperparams['learning_rate'],
        per_device_train_batch_size=hyperparams['batch_size'],
        num_train_epochs=hyperparams['epochs'],
        logging_steps=10,
        save_strategy="epoch"
    )
    
    # 5. 训练
    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=tokenized_dataset['train'],
        callbacks=[ProgressCallback()]
    )
    
    trainer.train()
    
    # 6. 保存模型
    model_save_path = f"./data/models/job_{hyperparams['job_id']}"
    trainer.save_model(model_save_path)
    
    # 7. 返回结果
    result = {
        "status": "success",
        "model_path": model_save_path,
        "final_loss": trainer.state.log_history[-1].get("loss", 0)
    }
    print(json.dumps(result))

if __name__ == "__main__":
    dataset_path = sys.argv[1]
    hyperparams = json.loads(sys.argv[2])
    
    try:
        train_text_classification(dataset_path, hyperparams)
    except Exception as e:
        error_result = {
            "status": "error",
            "error_message": str(e)
        }
        print(json.dumps(error_result))
        sys.exit(1)
```

---

## 12. 常见问题（FAQ）
### Q1: Go 如何实时读取 Python 训练进度？
**A**: 使用 `cmd.StdoutPipe()` 读取 Python 的标准输出：

```go
cmd := exec.Command("python3", "train.py")
stdout, _ := cmd.StdoutPipe()
cmd.Start()

scanner := bufio.NewScanner(stdout)
for scanner.Scan() {
    line := scanner.Text()
    if strings.HasPrefix(line, "PROGRESS:") {
        jsonStr := strings.TrimPrefix(line, "PROGRESS:")
        var progress map[string]interface{}
        json.Unmarshal([]byte(jsonStr), &progress)
        
        // 更新 Redis
        redis.HSet(ctx, fmt.Sprintf("training:progress:%d", jobID), progress)
    }
}

cmd.Wait()
```

### Q2: 如何处理 Python 脚本执行失败？
**A**: 在 Python 脚本中用 `try-except` 捕获异常，返回错误 JSON：

```python
try:
    # 执行逻辑
    result = {"status": "success", "data": ...}
except Exception as e:
    result = {"status": "error", "error_message": str(e)}
    sys.exit(1)  # 非零退出码
finally:
    print(json.dumps(result))
```

Go 端检查退出码：

```go
err := cmd.Run()
if err != nil {
    // 获取 stderr
    stderr, _ := cmd.StderrPipe()
    // 处理错误
}
```

### Q3: MCP 消息如何路由到不同 Agent？
**A**: 在 MCP Coordinator 中实现路由：

```go
type Coordinator struct {
    dataAgent      *DataAgent
    trainingAgent  *TrainingAgent
    evaluationAgent *EvaluationAgent
}

func (c *Coordinator) RouteMessage(msg Message) error {
    switch msg.To {
    case "data-agent":
        return c.dataAgent.HandleMessage(msg)
    case "training-agent":
        return c.trainingAgent.HandleMessage(msg)
    case "evaluation-agent":
        return c.evaluationAgent.HandleMessage(msg)
    default:
        return fmt.Errorf("unknown agent: %s", msg.To)
    }
}
```

### Q4: 如何支持多个训练任务并发？
**A**: 使用 Redis 队列 + Go 协程池：

```go
// 启动 Worker Pool
for i := 0; i < 3; i++ {  // 最多 3 个并发训练
    go func() {
        for {
            // 从 Redis 队列 pop 任务
            jobID := redis.RPop("training:queue")
            
            // 执行训练
            trainingAgent.Train(jobID)
        }
    }()
}
```

---

## 13. 交付检查清单
在完成开发后，请确保以下所有项都已完成：

### 功能完整性
+ [ ] 用户可以上传 CSV 数据集
+ [ ] 系统自动清洗数据（去重、缺失值）
+ [ ] 用户可以创建训练任务
+ [ ] 训练过程实时显示进度
+ [ ] 训练完成后可以查看评估结果
+ [ ] 用户可以下载训练好的模型

### 技术要求
+ [ ] 三个 Agent 通过 MCP 协议通信
+ [ ] Go 后端正确连接 PostgreSQL 和 Redis
+ [ ] Python 脚本能被 Go 正确调用
+ [ ] 数据库表结构符合设计
+ [ ] API 响应格式统一（JSON）

### 代码质量
+ [ ] 关键函数有注释
+ [ ] 错误处理完善
+ [ ] 日志记录清晰
+ [ ] 无明显的 bug

### 文档
+ [ ] README.md 包含启动说明
+ [ ] API 文档完整
+ [ ] 数据库 Schema 文档

---

## 14. 联系方式
如果在开发过程中遇到问题，请：

1. 查看本 PRD 的相关章节
2. 查阅项目 README.md
3. 检查日志文件
4. 咨询项目负责人

---

**祝开发顺利！****🚀**

