# Skill / MCP 占位目录

- **`SKILL_REGISTRY.yaml`**：训练路由键、数据集任务类型、语义任务族与 Skill/MCP 占位符的对照表（给编排器或文档生成用）。
- **实现侧常量**：`internal/skillmcp/registry.go`（与 YAML 保持语义一致）。

业务代码中已用注释标明「后续接 Skill+MCP」的挂载点，见下方「路径清单」。
- **`data_agent_skill.md`**：Data Agent 职责边界、脚本与模板协作、输出结构。
- **`evaluation_agent_skill.md`**：Evaluation Agent 输入信号与解释输出结构。
- **`task_intent_skill.md`**：任务理解输入范式、标准化 schema、与后续步骤映射。
