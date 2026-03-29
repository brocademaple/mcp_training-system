package services

import (
	"fmt"
	"strings"
	"time"
)

type DatasetCandidate struct {
	ID     int    `json:"id"`
	Name   string `json:"name"`
	Status string `json:"status"`
}

type PlanRequest struct {
	Goal              string             `json:"goal"`
	ModelType         string             `json:"model_type"`
	Intent            string             `json:"intent"`
	MaterialSource    string             `json:"material_source"`
	DataAgentPrompt   string             `json:"data_agent_prompt"`
	TrainMode         string             `json:"train_mode"` // 可选：classic_clf / sft_lora；为空则由 intent 推断
	DatasetCandidates []DatasetCandidate `json:"dataset_candidates"`
}

type PlanStep struct {
	Name          string `json:"name"`
	Agent         string `json:"agent"`
	InputSummary  string `json:"input_summary"`
	OutputSummary string `json:"output_summary"`
	Rationale     string `json:"rationale"`
}

type FallbackAction struct {
	Key         string `json:"key"`
	Label       string `json:"label"`
	Description string `json:"description"`
}

type PlanResult struct {
	PlanID                     string                   `json:"plan_id"`
	Goal                       string                   `json:"goal"`
	InferredIntent             string                   `json:"inferred_intent"`
	TaskSpec                   TaskSpec                 `json:"task_spec"`
	TrainMode                  string                   `json:"train_mode"`
	SelectedDatasetCandidates  []DatasetCandidate       `json:"selected_dataset_candidates"`
	TrainConfig                map[string]interface{}   `json:"train_config"`
	DataAgentPrompt            string                   `json:"data_agent_prompt"`
	Steps                      []PlanStep               `json:"steps"`
	FallbackActions            []FallbackAction         `json:"fallback_actions"`
	EstimatedDurationMinutes   int                      `json:"estimated_duration_minutes"`
}

type TaskSpec struct {
	ProblemFamily    string   `json:"problem_family"`    // classification / token_classification / generation
	RequiredColumns  []string `json:"required_columns"`  // 最小数据列要求（便于前端/用户理解）
	OutputForm       string   `json:"output_form"`       // label / spans / text
	DefaultTrainMode string   `json:"default_train_mode"`// classic_clf / sft_lora
	Notes            string   `json:"notes"`             // 重要提示（如 NER/生成需要特殊格式）
}

func getTaskSpecByIntent(intent string) TaskSpec {
	switch intent {
	case "sentiment", "topic", "binary", "multiclass", "intent":
		return TaskSpec{
			ProblemFamily:    "classification",
			RequiredColumns:  []string{"text", "label"},
			OutputForm:       "label",
			DefaultTrainMode: "classic_clf",
			Notes:            "分类任务：至少需要文本列 + 标签列（label/labels）。",
		}
	case "ner":
		return TaskSpec{
			ProblemFamily:    "token_classification",
			RequiredColumns:  []string{"tokens", "tags"},
			OutputForm:       "spans",
			DefaultTrainMode: "classic_clf",
			Notes:            "NER/序列标注需要特殊数据格式（tokens+tags 或 spans）。当前版本入口可展示但训练链路需单独适配。",
		}
	case "summary":
		return TaskSpec{
			ProblemFamily:    "generation",
			RequiredColumns:  []string{"input", "output"},
			OutputForm:       "text",
			DefaultTrainMode: "sft_lora",
			Notes:            "生成/摘要通常走 SFT（input->output 对），更适合用 LoRA 参数高效微调。",
		}
	default:
		return TaskSpec{
			ProblemFamily:    "classification",
			RequiredColumns:  []string{"text", "label"},
			OutputForm:       "label",
			DefaultTrainMode: "classic_clf",
			Notes:            "默认按分类任务处理。",
		}
	}
}

func BuildRulePlan(req PlanRequest) PlanResult {
	goal := strings.TrimSpace(req.Goal)
	if goal == "" {
		goal = "完成一条从数据清洗到训练评估的流水线"
	}

	inferredIntent := req.Intent
	if inferredIntent == "" {
		// 规则优先：关键字推断
		switch {
		case strings.Contains(goal, "情感"):
			inferredIntent = "sentiment"
		case strings.Contains(goal, "主题"), strings.Contains(goal, "新闻"):
			inferredIntent = "topic"
		case strings.Contains(goal, "实体"):
			inferredIntent = "ner"
		default:
			inferredIntent = "sentiment"
		}
	}

	modelType := req.ModelType
	if modelType == "" {
		modelType = "text"
	}

	spec := getTaskSpecByIntent(inferredIntent)
	trainMode := strings.TrimSpace(req.TrainMode)
	if trainMode == "" {
		trainMode = spec.DefaultTrainMode
	}

	trainCfg := map[string]interface{}{
		"model_type":    "text_classification",
		"base_model":    "bert-base-uncased",
		"epochs":        3.0,
		"learning_rate": 2e-5,
		"batch_size":    16.0,
	}
	if trainMode == "sft_lora" || strings.Contains(strings.ToLower(goal), "微调") || strings.Contains(strings.ToLower(goal), "sft") || strings.Contains(strings.ToLower(goal), "lora") {
		trainCfg["model_type"] = "sft_finetune"
		trainCfg["base_model"] = "Qwen/Qwen2.5-0.5B-Instruct"
		trainCfg["epochs"] = 2.0
		trainCfg["learning_rate"] = 2e-4
		trainCfg["batch_size"] = 4.0
	}

	prompt := strings.TrimSpace(req.DataAgentPrompt)
	if req.MaterialSource == "agent" && prompt == "" {
		prompt = "请优先搜集与当前任务一致的高质量训练语料，并保证标签质量和领域相关性。"
	}

	planID := fmt.Sprintf("plan_%d", time.Now().Unix())
	steps := []PlanStep{
		{
			Name:          "clean_data",
			Agent:         "DataAgent",
			InputSummary:  "原始/候选数据集",
			OutputSummary: "可训练清洗数据集",
			Rationale:     "先保证数据质量，再进入训练可降低后续失败率。",
		},
		{
			Name:          "train",
			Agent:         "TrainingAgent",
			InputSummary:  "清洗后数据 + 训练配置",
			OutputSummary: "训练任务与模型产物",
			Rationale:     "基于目标任务自动选择训练配置，兼顾效果与资源开销。",
		},
		{
			Name:          "evaluate",
			Agent:         "EvaluationAgent",
			InputSummary:  "训练模型 + 测试数据集",
			OutputSummary: "评估指标与报告",
			Rationale:     "给出可解释指标，支持后续继续优化训练策略。",
		},
	}

	fallback := []FallbackAction{
		{Key: "retry_clean", Label: "重新清洗后重跑", Description: "当数据噪声较大或格式不稳定时使用。"},
		{Key: "reduce_lr", Label: "降低学习率重试", Description: "训练震荡或发散时，降低 learning_rate。"},
		{Key: "switch_data_source", Label: "切换数据来源策略", Description: "改为 Data Agent 规划数据来源并补齐样本。"},
	}

	return PlanResult{
		PlanID:                    planID,
		Goal:                      goal,
		InferredIntent:            inferredIntent,
		TaskSpec:                  spec,
		TrainMode:                 trainMode,
		SelectedDatasetCandidates: req.DatasetCandidates,
		TrainConfig:               trainCfg,
		DataAgentPrompt:           prompt,
		Steps:                     steps,
		FallbackActions:           fallback,
		EstimatedDurationMinutes:  8,
	}
}

