# MCP Training System API 文档

## 基础信息

**Base URL**: `http://localhost:8080/api/v1`

**Content-Type**: `application/json` (除文件上传外)

**响应格式**: 统一JSON格式

```json
{
  "code": 200,
  "message": "success",
  "data": {}
}
```

**错误码说明**:

- `200`: 成功
- `400`: 请求参数错误
- `404`: 资源不存在
- `500`: 服务器内部错误

---

## 1. 数据集管理 API

### 1.1 上传数据集

**接口**: `POST /datasets/upload`

**Content-Type**: `multipart/form-data`

**请求参数**:


| 参数   | 类型     | 必填  | 说明               |
| ---- | ------ | --- | ---------------- |
| file | File   | 是   | CSV文件，最大100MB    |
| name | String | 是   | 数据集名称            |
| type | String | 是   | 数据类型（text/image） |


**请求示例**:

```bash
curl -X POST http://localhost:8080/api/v1/datasets/upload \
  -F "file=@sentiment_data.csv" \
  -F "name=情感分类数据集" \
  -F "type=text"
```

**响应示例**:

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "dataset_id": 1,
    "status": "uploading"
  }
}
```

**说明**:

- 上传后系统会自动在后台进行数据清洗
- 可通过查询接口获取清洗状态

---

### 1.2 从 URL 导入数据集

**接口**: `POST /datasets/from-url`

**Content-Type**: `application/json`

**请求参数**:


| 参数   | 类型     | 必填  | 说明                       |
| ---- | ------ | --- | ------------------------ |
| name | String | 是   | 数据集名称                    |
| url  | String | 是   | CSV 文件地址（仅支持 http/https） |
| type | String | 否   | 数据类型（text/image），默认 text |


**请求示例**:

```bash
curl -X POST http://localhost:8080/api/v1/datasets/from-url \
  -H "Content-Type: application/json" \
  -d '{"name":"远程数据集","url":"https://example.com/data.csv","type":"text"}'
```

**响应示例**:

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "dataset_id": 2,
    "status": "uploading"
  }
}
```

**说明**:

- 服务端会抓取 URL 内容（最大 100MB），保存为 CSV 后自动触发数据清洗
- `datasets.source` 会保存该 URL，便于区分来源

---

### 1.3 获取数据集列表

**接口**: `GET /datasets`

**请求参数**: 无

**请求示例**:

```bash
curl http://localhost:8080/api/v1/datasets
```

**响应示例**:

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "total": 2,
    "datasets": [
      {
        "id": 1,
        "name": "情感分类数据集",
        "type": "text",
        "status": "ready",
        "row_count": 1200,
        "column_count": 2,
        "file_size": 524288,
        "created_at": "2026-01-10T12:00:00Z"
      }
    ]
  }
}
```

---

### 1.4 获取数据集详情

**接口**: `GET /datasets/:id`

**路径参数**:


| 参数  | 类型      | 说明    |
| --- | ------- | ----- |
| id  | Integer | 数据集ID |


**请求示例**:

```bash
curl http://localhost:8080/api/v1/datasets/1
```

**响应示例**:

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "id": 1,
    "name": "情感分类数据集",
    "type": "text",
    "status": "ready",
    "row_count": 1200,
    "column_count": 2,
    "original_file_path": "./data/uploads/dataset_1.csv",
    "cleaned_file_path": "./data/cleaned/dataset_1_cleaned.csv",
    "created_at": "2026-01-10T12:00:00Z"
  }
}
```

---

## 2. 训练任务管理 API

### 2.1 创建训练任务

**接口**: `POST /training/jobs`

**Content-Type**: `application/json`

**请求参数**:


| 参数          | 类型      | 必填  | 说明                        |
| ----------- | ------- | --- | ------------------------- |
| dataset_id  | Integer | 是   | 数据集ID                     |
| model_type  | String  | 是   | 模型类型（text_classification） |
| hyperparams | Object  | 是   | 超参数配置                     |


**hyperparams 参数**:


| 参数            | 类型      | 说明   | 默认值     |
| ------------- | ------- | ---- | ------- |
| learning_rate | Float   | 学习率  | 0.00002 |
| batch_size    | Integer | 批次大小 | 16      |
| epochs        | Integer | 训练轮数 | 3       |


**请求示例**:

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

**响应示例**:

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "job_id": 1,
    "status": "queued"
  }
}
```

---

### 2.2 获取训练任务列表

**接口**: `GET /training/jobs`

**请求参数**:


| 参数      | 类型      | 必填  | 说明        |
| ------- | ------- | --- | --------- |
| user_id | Integer | 否   | 用户ID，默认 1 |


**请求示例**:

```bash
curl "http://localhost:8080/api/v1/training/jobs?user_id=1"
```

**响应示例**:

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "jobs": [
      {
        "id": 1,
        "user_id": 1,
        "dataset_id": 1,
        "model_type": "text_classification",
        "status": "running",
        "progress": 50,
        "current_epoch": 2,
        "total_epochs": 3,
        "created_at": "2026-01-10T12:00:00Z"
      }
    ]
  }
}
```

---

### 2.3 获取训练任务状态

**接口**: `GET /training/jobs/:id`

**路径参数**:


| 参数  | 类型      | 说明     |
| --- | ------- | ------ |
| id  | Integer | 训练任务ID |


**请求示例**:

```bash
curl http://localhost:8080/api/v1/training/jobs/1
```

**响应示例**:

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "id": 1,
    "status": "running",
    "progress": 50,
    "current_epoch": 2,
    "total_epochs": 3
  }
}
```

**状态说明**:

- `queued`: 排队中
- `running`: 训练中
- `completed`: 已完成
- `failed`: 失败

---

### 2.4 获取训练日志

**接口**: `GET /training/jobs/:id/logs`

**路径参数**:


| 参数  | 类型      | 说明     |
| --- | ------- | ------ |
| id  | Integer | 训练任务ID |


**说明**: 返回该任务每个 epoch 的日志（loss、accuracy、learning_rate），训练过程中每完成一个 epoch 会写入一条记录。

**请求示例**:

```bash
curl "http://localhost:8080/api/v1/training/jobs/1/logs"
```

**响应示例**:

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "logs": [
      {
        "id": 1,
        "job_id": 1,
        "epoch": 1,
        "loss": 0.52,
        "accuracy": 0.72,
        "learning_rate": 2e-05,
        "log_time": "2026-01-10T12:10:00Z"
      },
      {
        "id": 2,
        "job_id": 1,
        "epoch": 2,
        "loss": 0.31,
        "accuracy": 0.88,
        "learning_rate": 2e-05,
        "log_time": "2026-01-10T12:15:00Z"
      }
    ]
  }
}
```

---

### 2.5 WebSocket 实时训练进度

**连接地址**: `ws://localhost:8080/ws/training/:job_id`

**说明**: 连接后服务端会通过 Redis 订阅该任务的进度更新，并实时推送 JSON 消息。前端训练任务页会对所有 `running` 状态的任务自动建立 WebSocket 连接并更新进度。

**消息格式**（服务端 → 客户端）:

```json
{
  "epoch": 1.5,
  "loss": 0.23,
  "learning_rate": 2e-05,
  "step": 100,
  "max_steps": 500
}
```

**结束消息**（训练完成或失败时）:

```json
{"status": "completed", "progress": 100}
```

或

```json
{"status": "failed", "error_message": "..."}
```

**示例**（浏览器控制台）:

```javascript
const ws = new WebSocket('ws://localhost:8080/ws/training/1');
ws.onmessage = (e) => console.log(JSON.parse(e.data));
```

---

## 3. 模型评估 API

### 3.1 获取评估列表

**接口**: `GET /evaluations`

**请求示例**:

```bash
curl "http://localhost:8080/api/v1/evaluations"
```

**响应示例**:

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "evaluations": [
      {
        "id": 1,
        "model_id": 1,
        "accuracy": 0.94,
        "precision": 0.93,
        "recall": 0.95,
        "f1_score": 0.94,
        "report_path": "./reports/eval_1_123.html",
        "created_at": "2026-01-10T13:00:00Z"
      }
    ]
  }
}
```

---

### 3.2 创建评估任务

**接口**: `POST /evaluations`

**Content-Type**: `application/json`

**请求参数**:


| 参数              | 类型      | 必填  | 说明               |
| --------------- | ------- | --- | ---------------- |
| model_id        | Integer | 是   | 模型ID             |
| test_dataset_id | Integer | 否   | 测试数据集ID，0表示使用训练集 |


**请求示例**:

```bash
curl -X POST http://localhost:8080/api/v1/evaluations \
  -H "Content-Type: application/json" \
  -d '{
    "model_id": 1,
    "test_dataset_id": 0
  }'
```

**响应示例**:

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "status": "processing"
  }
}
```

---

### 3.3 获取评估结果

**接口**: `GET /evaluations/:id`

**路径参数**:


| 参数  | 类型      | 说明   |
| --- | ------- | ---- |
| id  | Integer | 评估ID |


**请求示例**:

```bash
curl http://localhost:8080/api/v1/evaluations/1
```

**响应示例**:

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "id": 1,
    "model_id": 1,
    "accuracy": 0.94,
    "precision": 0.93,
    "recall": 0.95,
    "f1_score": 0.94,
    "confusion_matrix_path": "./reports/cm_1_123.png",
    "roc_curve_path": "./reports/roc_1_123.png",
    "report_path": "./reports/eval_1_123.html",
    "created_at": "2026-01-10T13:00:00Z"
  }
}
```

---

### 3.4 下载评估报告

**接口**: `GET /reports/download/:id`

**路径参数**:


| 参数  | 类型      | 说明                   |
| --- | ------- | -------------------- |
| id  | Integer | 评估ID (evaluation_id) |


**说明**: 返回该评估对应的 HTML 报告文件（内嵌混淆矩阵、ROC 曲线图及指标）。若该评估未生成报告则返回 404。

**请求示例**:

```bash
curl -O -J "http://localhost:8080/api/v1/reports/download/1"
```

**响应**: 文件流 (`text/html`)，`Content-Disposition: attachment`

---

## 4. 模型管理 API

### 4.1 获取模型列表

**接口**: `GET /models`

**请求参数**:


| 参数      | 类型      | 必填  | 说明        |
| ------- | ------- | --- | --------- |
| user_id | Integer | 否   | 用户ID，默认 1 |


**请求示例**:

```bash
curl "http://localhost:8080/api/v1/models?user_id=1"
```

**响应示例**:

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "models": [
      {
        "id": 1,
        "job_id": 1,
        "name": "Model for job 1",
        "model_path": "./data/models/job_1",
        "model_size": 0,
        "model_type": "text_classification",
        "framework": "pytorch",
        "is_deployed": false,
        "created_at": "2026-01-10T12:30:00Z"
      }
    ]
  }
}
```

---

### 4.2 下载模型

**接口**: `GET /models/:id/download`

**路径参数**:


| 参数  | 类型      | 说明   |
| --- | ------- | ---- |
| id  | Integer | 模型ID |


**说明**: 若模型为目录（如 Transformers 保存格式），将打包为 `model_<id>.zip` 下载；若为单文件则直接返回该文件。

**请求示例**:

```bash
curl -O -J "http://localhost:8080/api/v1/models/1/download"
```

**响应**: 文件流 (`application/zip` 或 `application/octet-stream`)，`Content-Disposition: attachment`