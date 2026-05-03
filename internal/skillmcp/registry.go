// Package skillmcp 预留 Skill 驱动 + MCP 通信扩展点（与仓库根目录 skills/SKILL_REGISTRY.yaml 同步）。
// 当前训练仍由 internal/agents.TrainingAgent 直连 Python；后续可在此接入 Skill 路由与 MCP 工具名映射。
package skillmcp

// 与 training_jobs.model_type 及 TrainingAgent 脚本分支一致。
const (
	ExecutionTextClassification  = "text_classification"
	ExecutionSFTFinetune       = "sft_finetune"
	ExecutionTokenClassification = "token_classification"
	ExecutionDPOAlignment      = "dpo_alignment"
)

// SkillSlot 为逻辑占位 ID，供后续 Skill 宿主 / MCP Server 注册使用（非文件路径）。
const (
	SlotTrainingTextClassification   = "skill.training.text_classification"
	SlotTrainingSFTFinetune          = "skill.training.sft_finetune"
	SlotTrainingTokenClassification  = "skill.training.token_classification"
	SlotTrainingDPO                  = "skill.training.dpo_alignment"
	SlotAgentResolveIntent           = "skill.agent.resolve_intent"
	SlotAgentPlanPipeline            = "skill.agent.plan_pipeline"
	SlotTrainingDispatchFromContext  = "skill.training.dispatch_from_context"
)

// MCPToolPlaceholder 为未来对外暴露的 MCP 工具名占位（与 SKILL_REGISTRY.yaml 中 mcp_tool_placeholder 一致）。
const (
	MCPToolRunTextClassification   = "mcp.training.run_text_classification"
	MCPToolRunSFTFinetune           = "mcp.training.run_sft_finetune"
	MCPToolRunTokenClassification   = "mcp.training.run_token_classification"
	MCPToolRunDPO                   = "mcp.training.run_dpo_alignment"
)

// SkillSlotForExecutionModelType 返回与当前 model_type 路由对应的 Skill 占位 ID。
func SkillSlotForExecutionModelType(modelType string) string {
	switch modelType {
	case ExecutionSFTFinetune:
		return SlotTrainingSFTFinetune
	case ExecutionTokenClassification:
		return SlotTrainingTokenClassification
	case ExecutionDPOAlignment:
		return SlotTrainingDPO
	default:
		return SlotTrainingTextClassification
	}
}

// MCPToolPlaceholderForExecutionModelType 返回建议的 MCP 工具名占位。
func MCPToolPlaceholderForExecutionModelType(modelType string) string {
	switch modelType {
	case ExecutionSFTFinetune:
		return MCPToolRunSFTFinetune
	case ExecutionTokenClassification:
		return MCPToolRunTokenClassification
	case ExecutionDPOAlignment:
		return MCPToolRunDPO
	default:
		return MCPToolRunTextClassification
	}
}
