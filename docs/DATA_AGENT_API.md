# Data Agent 与 HTTP API 说明（含阿里云）

本文说明本仓库中 **Data Agent** 的接入方式、可通过 HTTP 调用的接口，以及与 **阿里云通义（DashScope）** 的关系。

## Data Agent 是什么

- **Data Agent** 在后端由 `internal/agents/data_agent.go` 实现，主要通过 **Python 脚本**（`python_scripts/data/*.py`）完成：
  - 数据集 **清洗**（`CleanData`）
  - 数据集 **统计分析**（`AnalyzeData`）
  - 数据集 **划分**（`SplitDataset`，由 `DatasetHandler.SplitDataset` 暴露）
- Data Agent **不直接调用** 阿里云 HTTP API；清洗/分析在**应用服务器本机**执行（需配置 `PYTHON_PATH`、`PYTHON_SCRIPTS_DIR`）。

## 与「阿里云」的关系

- **Planning / 意图解析**（如 `POST /api/v1/agent/resolve-intent`）可通过环境变量接入 **阿里云 DashScope（通义）** 兼容接口：
  - `INTENT_RESOLVER_PROVIDER=aliyun` 或 `hybrid`
  - `ALIYUN_DASHSCOPE_API_KEY`（必填）
  - `ALIYUN_INTENT_MODEL`（可选，默认如 `qwen-turbo`）
  - `ALIYUN_DASHSCOPE_BASE_URL`（可选，默认 `https://dashscope.aliyuncs.com/compatible-mode/v1`）
- **Data Agent** 的数据处理仍走本地 Python；若你在**阿里云 ECS** 上部署本服务，只需把服务监听在 `0.0.0.0:端口`，并对安全组/SLB 放行，即可从外网或同 VPC 调用下方 API。

## 与 Data Agent 相关的主要 HTTP 接口（`BASE_URL` = 如 `http://<ECS公网或内网IP>:8080`）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/datasets/upload` | 上传数据集；成功后异步触发 **Data Agent 清洗** |
| POST | `/api/v1/datasets/from-url` | 从 URL 导入；成功后异步清洗 |
| POST | `/api/v1/datasets/:id/retry-clean` | 失败数据集重试清洗 |
| POST | `/api/v1/datasets/:id/analyze` | **Data Agent 分析**（要求数据集已 `ready`，即已清洗） |
| POST | `/api/v1/datasets/:id/split` | 划分训练/测试集（调用 `SplitDataset`） |
| GET | `/api/v1/datasets/:id/preview` | 预览 CSV 前几行 |
| GET | `/api/v1/datasets/:id` | 数据集详情 |

流水线（Coordinator + Data Agent 步骤）见：

- `POST /api/v1/pipelines` — 创建流水线实例（内部会按步骤调用 Data Agent 等）

## 调用示例（在阿里云 ECS 上已部署后端时）

```bash
# 假设数据集 id=1 已清洗完成（status=ready）
curl -sS -X POST "$BASE_URL/api/v1/datasets/1/analyze" \
  -H "Content-Type: application/json"
```

返回 JSON 的 `data` 字段为 Python 脚本输出的统计结构（见 `data/analyze_data.py` 的约定）。

## 前端中如何「看到效果」

1. 在 **Agent 画布** 中完成流程确认与数据准备，进入 **数据工作台**（上传、校验、确认数据）。
2. 在 **经典版**「数据集」页上传 CSV，待状态变为 `ready` 后，可通过上述 API 或后续 UI 扩展触发分析。

若你希望「画布内一键展示 Data Agent 分析结果」，可在前端 `datasetService` 中增加对 `POST /datasets/:id/analyze` 的封装并在数据工作台挂载展示（当前变更以 **API 暴露 + 文档** 为主）。
