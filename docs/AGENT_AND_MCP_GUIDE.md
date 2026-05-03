# Agent 与 MCP 架构说明（讨论整理）

本文整理自对 **MCP Training System** 的产品定位、独立 MCP Server 规划思路、训练启动前的 Agent 分工，以及本仓库内「类 MCP」消息实现的对话结论；与 **代码事实** 不一致时以源码与 `PRD.md` 为准。

---

## 1. 双版本产品定位

| 维度 | 经典版 | Agent 版 |
|------|--------|----------|
| **角色** | 数据集、训练、评估的 **REST/页面操作面**；人工逐步完成数据 → 训练 → 评估。 | 以 **MCP 协调的多 Agent** 为主线，侧重 **训练任务策划与流水线执行**（清洗 → 训练 → 评估）。 |
| **数据** | 与 Agent 版 **共用** PostgreSQL / Redis 中的同一套表（如 `datasets`、`training_jobs` 等）。 | 读写同一数据层；画布上的流水线状态落在 `pipeline_instances` 等。 |
| **衔接叙述（架构/毕设）** | 经典侧沉淀的数据与任务状态，在叙述上可作为 **经 MCP 与 Agent 版衔接的数据来源**；**独立 MCP Server**（对外标准 MCP、对内调本系统 API 或只读库）的具体形态由后续实现定义。 | Agent 侧通过 Coordinator 编排各业务 Agent；会话可观测性见 HTTP `/api/v1/mcp/session/...` 与前端事件流。 |

实现与文案入口：`README.md`、`Agents.md`、`PRD.md` §1.2、`docs/index.html`（GitHub Pages）。

---

## 2. 独立 MCP Server 规划思路（示例）

目标：**解耦**「大模型 / 外部 Agent」与「数据库细节」——外部 Agent 不直接写 SQL，而是通过 **MCP Tools / Resources** 获取 **裁剪后的、稳定的** 实时状态。

### 2.1 设计顺序（推荐）

1. 先列出 Agent **决策问题**（能否训练、用哪份数据、流水线卡在哪一步等）。
2. 为每个问题定义 **一个 Tool**（或一组细粒度 Tool），明确 **输入 JSON** 与 **输出 JSON**（字段宜少、稳定）。
3. 表中的列（含分析类大字段）仅在 **个别 Tool** 中以摘要形式暴露，避免每个 Tool 复制全表。

### 2.2 Tool 示例（与领域模型对齐，非接口规范）

| Tool（示意名） | 用途 | 输入要点 | 输出要点 |
|----------------|------|-----------|-----------|
| `list_datasets_for_project` | 某项目下数据集列表 | `project_id`、`status_filter` | `id`、`name`、`row_count`、`usage`、`status` |
| `get_dataset_ready_signal` | 是否具备训练条件 | `dataset_id` | `ready`、`reason`、`columns_hint` |
| `get_latest_training_job` | 最近训练任务摘要 | `dataset_id` / `project_id` | `id`、`status`、`model_type`、`created_at` |
| `get_pipeline_instance` | 一键流水线当前步骤 | `session_id` 或 pipeline id | `status`、`current_step`、`error_msg`、`job_id` |

### 2.3 Resource 示例（只读引用）

- URI 形如：`training-system://dataset/42`
- 内容为 **裁剪后的** Markdown 或 JSON（元数据 + 短摘要），不含敏感路径或超大字段全文。

### 2.4 落地方式（两种常见形态）

- **薄封装**：MCP Server 调用现有 **Gin HTTP API**，将响应映射为上述契约。
- **厚封装**：MCP Server 只读直连数据库，SQL 封装在 Server 内，Agent 仍不可见原始表结构。

---

## 3. 发起训练前的职责划分与判断链

### 3.1 执行训练的主体

- **Training Agent**（`internal/agents/training_agent.go` 的 `Train(jobID)`）负责 **真正拉起 Python 训练进程**。
- 触发路径：**Coordinator** 流水线中 `executeStep` → `training-agent` / `train`；或 **经典版** `TrainingHandler.CreateJob` 创建任务后直接异步调用 `Train`。

本仓库 **未** 将「Planning Agent」作为独立进程保留；「策划」主要由 **`resolve-intent` + 规则 `plan`（`services.BuildRulePlan`）** 承担（HTTP 层，见 `internal/handlers/agent_handler.go`）。

### 3.2 训练前的层次（从意图到执行）

| 层次 | 做什么 | 说明 |
|------|--------|------|
| 意图 / 计划 | `ResolveIntent`、`CreatePlan` | 推断任务类型、领域、训练方式建议；拉取 `ready` 数据集候选；**不**等于 Training Agent。 |
| 流水线数据闸门 | **Data Agent**：`clean_data`、质检 `validate_quality` 等 | 在 `Coordinator.executePipelineAsync` 中，**先于** `createTrainingJob` 与 `train` 步；失败则流水线不进入训练。 |
| 训练执行闸门 | **Training Agent** 内 | 校验 `training_jobs` 存在、`dataset_id` 有效、**清洗路径或原始路径非空**（见 `Train` 内查询 `datasets`）；再更新状态并启动脚本。 |

经典版 **绕过** 流水线时，若数据集无可用路径，仍会在 **Training Agent** 阶段失败。

---

## 4. Agent 数量与本仓库中的「MCP 通信」

### 4.1 业务 Agent（执行侧）

当前流水线默认需要 **三个** 执行型 Agent（与 `Coordinator.RouteMessage` 的 `To` 分支一致）：

| Agent | 主要职责 |
|-------|----------|
| **Data Agent** | 清洗、分析、质量校验等 |
| **Training Agent** | 训练 |
| **Evaluation Agent** | 评估 |

另：**Coordinator** 负责编排与状态落库，不是与前三者并列的「第四种模型 Agent」，而是 **编排器（Orchestrator）**。

### 4.2 本仓库 MCP 的实现层次（重要）

此处 **不是** Cursor / Claude Desktop 使用的 **stdio MCP 传输协议** 的完整实现，而是进程内的 **类 MCP 消息模型**：

- 消息结构：`internal/mcp/message.go` 中 `MCPMessage`（`type`、`from`、`to`、`action`、`payload`）。
- 路由：`Coordinator.RouteMessage` 按 `msg.To` 分发到 `data-agent` / `training-agent` / `evaluation-agent`，再调用对应 Go 方法（同步调用，非独立 Agent 进程）。
- 流水线步骤构造：`executeStep` 使用 `NewRequest("coordinator", "<agent>", action, payload)`（见 `internal/mcp/coordinator.go`）。
- 可观测性：部分 HTTP 路径将 MCP 消息写入会话事件（Redis），供前端展示「发过什么请求/响应」。

若需对接 **外部** 标准 MCP 客户端，需新增 **MCP Server 适配层**，将 Tool 调用映射到上述 HTTP 或内部 Coordinator。

---

## 5. 代码与文档索引（延伸阅读）

| 内容 | 路径 |
|------|------|
| MCP 消息定义 | `internal/mcp/message.go` |
| Coordinator 编排与 `executeStep` | `internal/mcp/coordinator.go` |
| 创建训练任务与异步 `Train` | `internal/handlers/training_handler.go` |
| 意图与计划 API | `internal/handlers/agent_handler.go` |
| 产品需求与双版本说明 | `PRD.md` |
| Agent 设计原则（简） | `Agents.md` |
| Data Agent HTTP 说明 | `docs/DATA_AGENT_API.md` |
| 快速开始 | `README.md` |

---

**文档版本**：与仓库同步维护；修订时请同步更新 `README.md` / `docs/SPEC_CODING.md` 中的索引条目（若存在）。
