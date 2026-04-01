package services

import (
	"fmt"
	"strings"
	"time"

	"mcp-training-system/internal/config"
	"mcp-training-system/internal/models"
	"mcp-training-system/internal/registry"
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
	PlanID                    string                 `json:"plan_id"`
	Goal                      string                 `json:"goal"`
	InferredIntent            string                 `json:"inferred_intent"`
	TaskSpec                  TaskSpec               `json:"task_spec"`
	TrainMode                 string                 `json:"train_mode"`
	SelectedDatasetCandidates []DatasetCandidate     `json:"selected_dataset_candidates"`
	TrainConfig               map[string]interface{} `json:"train_config"`
	DataAgentPrompt           string                 `json:"data_agent_prompt"`
	Steps                     []PlanStep             `json:"steps"`
	FallbackActions           []FallbackAction       `json:"fallback_actions"`
	EstimatedDurationMinutes  int                    `json:"estimated_duration_minutes"`
	RunSpec                   *models.RunSpec        `json:"run_spec,omitempty"`
	IntentResolution          *ResolveResult         `json:"intent_resolution,omitempty"`
}

type TaskSpec struct {
	ProblemFamily    string   `json:"problem_family"`     // classification / token_classification / generation
	RequiredColumns  []string `json:"required_columns"`   // 最小数据列要求（便于前端/用户理解）
	OutputForm       string   `json:"output_form"`        // label / spans / text
	DefaultTrainMode string   `json:"default_train_mode"` // classic_clf / sft_lora
	Notes            string   `json:"notes"`              // 重要提示（如 NER/生成需要特殊格式）
}

func getTaskSpecByIntent(intent string) TaskSpec {
	b := registry.Get()
	if b != nil {
		family, taskName, cols, form, notes := mapIntentToRegistry(intent)
		if family != "" {
			tf := b.TaskFamilyByID(family)
			if tf != nil {
				return TaskSpec{
					ProblemFamily:    strings.ToLower(family),
					RequiredColumns:  cols,
					OutputForm:       form,
					DefaultTrainMode: defaultTrainModeForFamily(family, taskName),
					Notes:            notes + " 一级族: " + family + " / " + taskName,
				}
			}
		}
	}
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
			Notes:            "NER/序列标注需要特殊数据格式（tokens+tags 或 spans）。",
		}
	case "summary":
		return TaskSpec{
			ProblemFamily:    "generation",
			RequiredColumns:  []string{"input", "output"},
			OutputForm:       "text",
			DefaultTrainMode: "sft_lora",
			Notes:            "生成/摘要通常走 SFT（input->output 对），更适合用 LoRA 参数高效微调。",
		}
	case "extraction":
		return TaskSpec{
			ProblemFamily:    "extraction",
			RequiredColumns:  []string{"text", "schema", "output"},
			OutputForm:       "json",
			DefaultTrainMode: "sft_lora",
			Notes:            "信息抽取：建议 text + schema + output(JSON/三元组) 结构。",
		}
	case "rewriting":
		return TaskSpec{
			ProblemFamily:    "rewriting",
			RequiredColumns:  []string{"source", "target"},
			OutputForm:       "text",
			DefaultTrainMode: "sft_lora",
			Notes:            "文本改写：source -> target（复述、纠错、风格迁移等）。",
		}
	case "matching":
		return TaskSpec{
			ProblemFamily:    "matching_ranking",
			RequiredColumns:  []string{"query", "candidate", "label_or_score"},
			OutputForm:       "score",
			DefaultTrainMode: "classic_clf",
			Notes:            "匹配排序：query/candidate 对，输出标签或相关性分数。",
		}
	case "infilling":
		return TaskSpec{
			ProblemFamily:    "infilling_reasoning",
			RequiredColumns:  []string{"context", "target"},
			OutputForm:       "text",
			DefaultTrainMode: "sft_lora",
			Notes:            "填空推理：带缺失上下文到目标输出，适用于 Cloze/推理/补全。",
		}
	case "alignment":
		return TaskSpec{
			ProblemFamily:    "alignment",
			RequiredColumns:  []string{"prompt", "chosen", "rejected"},
			OutputForm:       "preference",
			DefaultTrainMode: "sft_lora",
			Notes:            "偏好对齐：需要 prompt/chosen/rejected 字段，通常走 DPO。",
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

func mapIntentToRegistry(intent string) (family, taskName string, cols []string, outputForm, notes string) {
	switch intent {
	case "sentiment", "topic", "binary", "multiclass", "intent":
		return "Classification", "SentimentClassification", []string{"text", "label"}, "label", "分类："
	case "ner":
		return "SequenceTagging", "NER", []string{"tokens", "tags"}, "spans", "序列标注："
	case "summary":
		return "Generation", "Summarization", []string{"input", "output"}, "text", "摘要/生成："
	case "extraction":
		return "Extraction", "RelationExtraction", []string{"text", "schema", "output"}, "json", "信息抽取："
	case "rewriting":
		return "Rewriting", "Paraphrase", []string{"source", "target"}, "text", "文本改写："
	case "matching":
		return "MatchingRanking", "NLI", []string{"query", "candidate", "label_or_score"}, "score", "匹配与排序："
	case "infilling":
		return "InfillingReasoning", "MultiChoiceQA", []string{"context", "target"}, "text", "填空与推理："
	case "alignment":
		return "Alignment", "DPOTraining", []string{"prompt", "chosen", "rejected"}, "preference", "偏好对齐："
	default:
		return "Classification", "SentimentClassification", []string{"text", "label"}, "label", ""
	}
}

func defaultTrainModeForFamily(family, taskName string) string {
	switch family {
	case "Generation", "Alignment":
		return "sft_lora"
	case "SequenceTagging", "Extraction", "Rewriting", "InfillingReasoning":
		return "sft_lora"
	default:
		return "classic_clf"
	}
}

func defaultMetricsByFamily(family string) []string {
	switch family {
	case "Classification":
		return []string{"accuracy", "macro_f1"}
	case "SequenceTagging":
		return []string{"entity_f1", "span_f1"}
	case "Generation":
		return []string{"rougeL", "bleu", "bertscore"}
	case "Extraction":
		return []string{"precision", "recall", "f1"}
	case "Rewriting":
		return []string{"sari", "bleu"}
	case "MatchingRanking":
		return []string{"ndcg", "mrr", "accuracy"}
	case "InfillingReasoning":
		return []string{"exact_match", "accuracy"}
	case "Alignment":
		return []string{"win_rate", "reward_score"}
	default:
		return []string{"accuracy", "macro_f1"}
	}
}

func BuildRulePlan(req PlanRequest, agentCfg *config.AgentConfig) PlanResult {
	goal := strings.TrimSpace(req.Goal)
	if goal == "" {
		goal = "完成一条从数据清洗到训练评估的流水线"
	}

	resolved := ResolveIntentUnified(goal, agentCfg)
	inferredIntent := strings.TrimSpace(req.Intent)
	if inferredIntent == "" {
		inferredIntent = resolved.InferredIntent
	}
	intentRes := resolved
	if strings.TrimSpace(req.Intent) != "" {
		intentRes.InferredIntent = inferredIntent
		intentRes.Message = fmt.Sprintf("任务类型已选「%s」。%s", labelIntent(inferredIntent), resolved.Message)
	}
	intentResolution := &intentRes

	modelType := req.ModelType
	if modelType == "" {
		modelType = "text"
	}

	spec := getTaskSpecByIntent(inferredIntent)
	trainMode := strings.TrimSpace(req.TrainMode)
	if trainMode == "" {
		trainMode = resolved.TrainMode
	}
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

	var rs *models.RunSpec
	fam, tname, _, _, _ := mapIntentToRegistry(inferredIntent)
	if fam != "" {
		method := SelectMethodForTaskWithGoal(fam, trainMode == "sft_lora", goal)
		if trainMode == "classic_clf" && fam == "Classification" {
			method = "SFT"
		}
		domainName := "General"
		if resolved.DomainHint != "" {
			domainName = resolved.DomainHint
		}
		rs = &models.RunSpec{
			ProjectName:    fmt.Sprintf("plan-%s", inferredIntent),
			BaseModel:      fmt.Sprintf("%v", trainCfg["base_model"]),
			SemanticTask:   models.SemanticTask{Family: fam, Name: tname},
			TrainingMethod: models.TrainingMethod{Name: method},
			Domain:         models.DomainRef{Name: domainName},
			Metrics:        defaultMetricsByFamily(fam),
			Runtime: models.RuntimeSpec{
				Epochs:       int(trainCfg["epochs"].(float64)),
				BatchSize:    int(trainCfg["batch_size"].(float64)),
				LearningRate: trainCfg["learning_rate"].(float64),
			},
		}
		ApplyDomainToRunSpec(rs)
		MergeMethodDefaults(rs)
		trainCfg["run_spec"] = rs
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
		RunSpec:                   rs,
		IntentResolution:          intentResolution,
	}
}
