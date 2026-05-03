# 开发与 AI 协作说明（文档索引 / Spec Coding）

> **本文档是仓库内「规范、协作入口、文档地图」的单一权威索引。**  
> 历史过程类文档（如一次性 AI 全量任务清单、过时项目快照、重复的 Git 说明、与现行规划重叠的 2.0 变更说明）已下线；具体事实以 **PRD、代码、迁移 SQL、专题文档** 为准。  
> **说明**：`docs/LEARNING.md` 为**本地学习笔记**（已加入 `.gitignore`，不会提交到 Git）；协作者各自维护一份即可，仓库内以 `README.md`、`TRAINING_SETUP.md`、`PLANNING_2.0.md` 等为公开文档来源。

---

## 一、文档地图（按角色）

| 角色 / 目的 | 文档 |
|-------------|------|
| Agent / MCP 架构（双版本、独立 MCP 规划、训练前分工、进程内 MCP 消息） | [AGENT_AND_MCP_GUIDE.md](./AGENT_AND_MCP_GUIDE.md) |
| 产品范围与需求 | 根目录 [PRD.md](../PRD.md)（**v2.0**，以 2.0 为主线） |
| 本机快速跑通 | [README.md](../README.md)（主流程）；迁移与补跑 SQL 见本地 `docs/LEARNING.md`（若你有）或对照 `internal/database/migrations` |
| 读懂架构与模块、迁移与排错 | 本地 `docs/LEARNING.md`（若你有）+ `internal/database/migrations` + 源码；公开专题见 `TRAINING_SETUP.md` |
| HTTP API | [API.md](./API.md) |
| 部署与运维 | [DEPLOYMENT.md](./DEPLOYMENT.md) |
| 训练成功条件与数据集格式 | [TRAINING_SETUP.md](./TRAINING_SETUP.md) |
| 2.0 愿景、经典版工作台定位、技术升级路线（微调 / Manager） | [PLANNING_2.0.md](./PLANNING_2.0.md) |
| 毕设技术存档（索引） | [thesis/README.md](./thesis/README.md)（子目录含训练子系统等分类） |

---

## 二、给 AI / 协作者的协作约定

1. **事实来源优先级**：`PRD.md`（做什么）→ `README.md` / `TRAINING_SETUP.md` / `PLANNING_2.0.md`（公开说明）→ 源码与 `internal/database/migrations`（当前行为）。可选：本地 `docs/LEARNING.md`（个人笔记，不入库）。不要依赖已删除的一次性 Phase 长清单推断现状。
2. **改数据库时**：新增/变更表结构须对应迁移 SQL；若你维护本地 `LEARNING.md`，可在其中补充迁移说明（与 [.cursor/rules/db-migrations-documentation.mdc](../.cursor/rules/db-migrations-documentation.mdc) 一致）。
3. **Python 训练/清洗脚本**：与 Go 的约定（`LOG:`、`PROGRESS:`、结束 JSON 等）见 `docs/TRAINING_SETUP.md`；可选对照本地 `docs/LEARNING.md`（个人笔记）；改协议须同步 `internal/agents` 解析逻辑。
4. **双版本前端**：经典版与 Agent 版共用数据；路由与菜单以 `frontend/src/App.tsx`、`Layout` 为准，规划见 `PLANNING_2.0.md`（含第八、九节合并内容）。
5. **后端热重载**：本地开发若改 Go 代码，按 [.cursor/rules/go-backend-restart.mdc](../.cursor/rules/go-backend-restart.mdc) 重启服务。

---

## 三、Git 提交与推送（排除数据与模型）

- **唯一维护的说明**：项目 Cursor Skill [`.cursor/skills/git-push-exclude-data/SKILL.md`](../.cursor/skills/git-push-exclude-data/SKILL.md)。  
- 提交前对照根目录 `.gitignore`，勿将 `data/`、模型权重、日志、报告等打入版本库。

## 三之一、本机启动项目

- **Cursor Skill**：[`.cursor/skills/start-mcp-training-system/SKILL.md`](../.cursor/skills/start-mcp-training-system/SKILL.md)（Docker 起库、Go 后端、前端 dev）。  
- 全文步骤见根目录 [README.md](../README.md)。

---

## 四、历史快照：2.0a 已具备能力（简要）

以下内容概括原「2.0 升级说明」类文档的核心结论；**路由名、迁移文件名等以当前代码与 `internal/database/migrations` 为准**。

- **流水线**：`Coordinator` 编排「清洗 → 训练 →评估」；HTTP 层提供 `POST/GET /api/v1/pipelines` 等（见 `internal/handlers/pipeline_handler.go`、`internal/mcp/coordinator.go`）。
- **数据模型**：`pipeline_instances` 等记录会话、步骤、关联 `job_id` / `model_id` / `eval_id`。
- **双版本 UI**：侧边栏可切换经典版与 Agent 版，偏好存 `localStorage`；数据互通。
- **后续方向**：会话可观测性、步骤日志、Skill/Workflow 等见 `PLANNING_2.0.md`。

---

## 四之一、Agent 意图识别（规则引擎 + 可选阿里云通义）

默认用可维护的关键词表对「一句话目标」做加权匹配，推断任务类型（`inferred_intent`）、训练方式建议（`classic_clf` / `sft_lora`）与领域提示（`domain_hint`），并返回命中词与说明文案。  
若环境变量 `INTENT_RESOLVER_PROVIDER` 设为 `aliyun` 或 `hybrid` 且已配置 `ALIYUN_DASHSCOPE_API_KEY`，则通过 **阿里云 DashScope OpenAI 兼容接口**（默认 `qwen-turbo`）解析用户描述，输出与规则版相同结构的 JSON 字段；`hybrid` 在调用失败时回退规则引擎。详见 `.env.example`。

| 项 | 说明 |
|----|------|
| 规则文件 | 仓库根 [`intent_registry/intent_patterns.yaml`](../intent_registry/intent_patterns.yaml) |
| 回退 | [`internal/services/defaults/intent_patterns.yaml`](../internal/services/defaults/intent_patterns.yaml) 随二进制嵌入，工作目录下无 YAML 时使用 |
| 加载时机 | `cmd/server/main.go` 在 `registry.LoadFromDir` 之后调用 `services.LoadIntentPatterns(".")` |
| 扩展方式 | 在 `patterns` 中增加条目：`intent`（与 Planner / 前端任务选项 id 一致）、`weight`、`keywords`、`negative_keywords`（可选）；`domain_hints` 中的 `domain` 必须与 [`domain_registry/index.yaml`](../domain_registry/index.yaml) 的 `id` 一致 |
| 通义解析 | `internal/services/dashscope_intent.go`：系统提示词约束 intent / train_mode / domain 与本系统 Planner、流水线一致；`matched_pattern_ids` 含 `dashscope` |
| HTTP | `POST /api/v1/agent/resolve-intent`，请求体 `{ "goal": "..." }`，响应 `{ "result": { ... } }`；生成计划仍用 `POST /api/v1/agent/plan`，响应 `plan` 中含 `intent_resolution`（与 resolve 结构一致） |

实现入口：`internal/services/intent_resolver.go`、`internal/services/dashscope_intent.go`、`internal/handlers/agent_handler.go`。

---

## 五、已下线文档（勿再引用）

以下文件已从仓库删除，内容已由本索引承接或已由专题文档替代：

- `SUPER_PROMPT.md` — 一次性全量开发任务清单，易与现状不符。  
- `PROJECT_SUMMARY.md` — 过时完成快照。  
- `git-push-code-only.md` — 与 `git-push-exclude-data` Skill 重复。  
- `docs/UPGRADE_2.0.md` — 与 `PLANNING_2.0.md` 重叠，且部分操作路径已演进。  
- `docs/QUICKSTART.md`、`docs/DASHBOARD_PRODUCT.md`、`docs/UPGRADE_PLAN.md` — 已分别并入 `README`/`LEARNING` 与 `PLANNING_2.0.md`，不再单独维护。

若外部笔记或旧链接仍指向上述路径，请改为 **本文档** 或上表对应专题文档。
