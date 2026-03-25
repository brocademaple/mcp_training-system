# 开发与 AI 协作说明（文档索引 / Spec Coding）

> **本文档是仓库内「规范、协作入口、文档地图」的单一权威索引。**  
> 历史过程类文档（如一次性 AI 全量任务清单、过时项目快照、重复的 Git 说明、与现行规划重叠的 2.0 变更说明）已下线；具体事实以 **PRD、代码、[LEARNING.md](./LEARNING.md)** 为准。

---

## 一、文档地图（按角色）

| 角色 / 目的 | 文档 |
|-------------|------|
| 产品范围与需求 | 根目录 [PRD.md](../PRD.md)（**v2.0**，以 2.0 为主线） |
| 本机快速跑通 | [README.md](../README.md)（主流程）；迁移与补跑 SQL 见 [LEARNING.md](./LEARNING.md) 数据库迁移小节 |
| 读懂架构与模块、迁移与排错 | [LEARNING.md](./LEARNING.md) |
| HTTP API | [API.md](./API.md) |
| 部署与运维 | [DEPLOYMENT.md](./DEPLOYMENT.md) |
| 训练成功条件与数据集格式 | [TRAINING_SETUP.md](./TRAINING_SETUP.md) |
| 2.0 愿景、经典版工作台定位、技术升级路线（微调 / Manager） | [PLANNING_2.0.md](./PLANNING_2.0.md) |

---

## 二、给 AI / 协作者的协作约定

1. **事实来源优先级**：`PRD.md`（做什么）→ `docs/LEARNING.md`（怎么做、目录与数据流）→ 源码与 `internal/database/migrations`（当前行为）。不要依赖已删除的一次性 Phase 长清单推断现状。
2. **改数据库时**：新增/变更表结构须对应迁移 SQL，并在 `LEARNING.md` 的迁移小节补充说明（与 [.cursor/rules/db-migrations-documentation.mdc](../.cursor/rules/db-migrations-documentation.mdc) 一致）。
3. **Python 训练/清洗脚本**：与 Go 的约定（`LOG:`、`PROGRESS:`、结束 JSON 等）见 `LEARNING.md` 与 `docs/TRAINING_SETUP.md`；改协议须同步 `internal/agents` 解析逻辑。
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

以下内容概括原「2.0 升级说明」类文档的核心结论；**路由名、迁移文件名等以当前代码与 `LEARNING.md` 为准**。

- **流水线**：`Coordinator` 编排「清洗 → 训练 →评估」；HTTP 层提供 `POST/GET /api/v1/pipelines` 等（见 `internal/handlers/pipeline_handler.go`、`internal/mcp/coordinator.go`）。
- **数据模型**：`pipeline_instances` 等记录会话、步骤、关联 `job_id` / `model_id` / `eval_id`。
- **双版本 UI**：侧边栏可切换经典版与 Agent 版，偏好存 `localStorage`；数据互通。
- **后续方向**：会话可观测性、步骤日志、Skill/Workflow 等见 `PLANNING_2.0.md`。

---

## 五、已下线文档（勿再引用）

以下文件已从仓库删除，内容已由本索引承接或已由专题文档替代：

- `SUPER_PROMPT.md` — 一次性全量开发任务清单，易与现状不符。  
- `PROJECT_SUMMARY.md` — 过时完成快照。  
- `git-push-code-only.md` — 与 `git-push-exclude-data` Skill 重复。  
- `docs/UPGRADE_2.0.md` — 与 `PLANNING_2.0.md` 重叠，且部分操作路径已演进。  
- `docs/QUICKSTART.md`、`docs/DASHBOARD_PRODUCT.md`、`docs/UPGRADE_PLAN.md` — 已分别并入 `README`/`LEARNING` 与 `PLANNING_2.0.md`，不再单独维护。

若外部笔记或旧链接仍指向上述路径，请改为 **本文档** 或上表对应专题文档。
