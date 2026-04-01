package models

import (
	"encoding/json"
	"fmt"
)

// RunSpec 为单次训练/流水线的统一配置（与仓库根目录示例 YAML 同构）。
type RunSpec struct {
	RunID         string         `json:"run_id,omitempty"`
	ProjectName   string         `json:"project_name,omitempty"`
	BaseModel     string         `json:"base_model,omitempty"`
	SemanticTask  SemanticTask   `json:"semantic_task"`
	TrainingMethod TrainingMethod `json:"training_method"`
	Domain        DomainRef      `json:"domain"`
	Dataset       DatasetSpec    `json:"dataset,omitempty"`
	Metrics       []string       `json:"metrics,omitempty"`
	Runtime       RuntimeSpec    `json:"runtime,omitempty"`
	Artifacts     ArtifactsSpec  `json:"artifacts,omitempty"`
}

type SemanticTask struct {
	Family string `json:"family"` // e.g. Classification
	Name   string `json:"name"`   // e.g. SentimentClassification
}

type TrainingMethod struct {
	Name   string                 `json:"name"` // LoRA, SFT, QLoRA, DPO, ...
	Params map[string]interface{} `json:"params,omitempty"`
}

type DomainRef struct {
	Name string `json:"name"` // General, Finance, ...
}

type DatasetSpec struct {
	TrainPath string `json:"train_path,omitempty"`
	ValidPath string `json:"valid_path,omitempty"`
	Schema    string `json:"schema,omitempty"`
}

type RuntimeSpec struct {
	Epochs       int     `json:"epochs,omitempty"`
	BatchSize    int     `json:"batch_size,omitempty"`
	LearningRate float64 `json:"learning_rate,omitempty"`
	MaxLength    int     `json:"max_length,omitempty"`
}

type ArtifactsSpec struct {
	OutputDir string `json:"output_dir,omitempty"`
}

// DeriveRunSpecFromLegacy 由旧版 model_type + hyperparams 生成最小 RunSpec（仅用于展示/兼容；不落库也可在读取时计算）。
func DeriveRunSpecFromLegacy(modelType string, hyperparams map[string]interface{}, jobName string) *RunSpec {
	rs := &RunSpec{
		ProjectName: jobName,
		SemanticTask: SemanticTask{
			Family: "Classification",
			Name:   "SentimentClassification",
		},
		TrainingMethod: TrainingMethod{
			Name: "SFT",
			Params: map[string]interface{}{
				"legacy_model_type": modelType,
			},
		},
		Domain: DomainRef{Name: "General"},
		Metrics: []string{"accuracy", "macro_f1"},
		Runtime: RuntimeSpec{},
	}

	base := ""
	if hyperparams != nil {
		if s, ok := hyperparams["base_model"].(string); ok {
			base = s
		}
		rs.Runtime = RuntimeSpec{
			Epochs:       intFromHP(hyperparams, "epochs", 3),
			BatchSize:    intFromHP(hyperparams, "batch_size", 16),
			LearningRate: floatFromHP(hyperparams, "learning_rate", 2e-5),
			MaxLength:    intFromHP(hyperparams, "max_seq_length", 0),
		}
	}
	rs.BaseModel = base

	switch modelType {
	case "sft_finetune":
		rs.SemanticTask = SemanticTask{Family: "Generation", Name: "InstructionFollowing"}
		rs.TrainingMethod = TrainingMethod{
			Name: "LoRA",
			Params: map[string]interface{}{
				"r":       floatFromHP(hyperparams, "lora_r", 8),
				"alpha":   floatFromHP(hyperparams, "lora_alpha", 16),
				"dropout": floatFromHP(hyperparams, "lora_dropout", 0.05),
			},
		}
		rs.Metrics = []string{"rougeL", "bleu"}
		if rs.Runtime.LearningRate == 0 {
			rs.Runtime.LearningRate = 2e-4
		}
		if rs.Runtime.BatchSize == 0 {
			rs.Runtime.BatchSize = 4
		}
		if rs.Runtime.Epochs == 0 {
			rs.Runtime.Epochs = 2
		}
	case "text_classification":
		rs.SemanticTask = SemanticTask{Family: "Classification", Name: "SentimentClassification"}
		rs.TrainingMethod = TrainingMethod{Name: "SFT", Params: map[string]interface{}{"head": "classification"}}
		if rs.Runtime.LearningRate == 0 {
			rs.Runtime.LearningRate = 2e-5
		}
		if rs.Runtime.BatchSize == 0 {
			rs.Runtime.BatchSize = 16
		}
		if rs.Runtime.Epochs == 0 {
			rs.Runtime.Epochs = 3
		}
	default:
		if rs.Runtime.Epochs == 0 {
			rs.Runtime.Epochs = 3
		}
		if rs.Runtime.BatchSize == 0 {
			rs.Runtime.BatchSize = 16
		}
		if rs.Runtime.LearningRate == 0 {
			rs.Runtime.LearningRate = 2e-5
		}
	}

	return rs
}

func intFromHP(h map[string]interface{}, key string, def int) int {
	if h == nil {
		return def
	}
	v, ok := h[key]
	if !ok || v == nil {
		return def
	}
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	case int64:
		return int(n)
	default:
		return def
	}
}

func floatFromHP(h map[string]interface{}, key string, def float64) float64 {
	if h == nil {
		return def
	}
	v, ok := h[key]
	if !ok || v == nil {
		return def
	}
	switch n := v.(type) {
	case float64:
		return n
	case int:
		return float64(n)
	case int64:
		return float64(n)
	default:
		return def
	}
}

// RunSpecToJSON 序列化 RunSpec。
func RunSpecToJSON(rs *RunSpec) ([]byte, error) {
	if rs == nil {
		return nil, fmt.Errorf("nil run spec")
	}
	return json.Marshal(rs)
}

// ParseRunSpec 从 JSON 解析。
func ParseRunSpec(b []byte) (*RunSpec, error) {
	if len(b) == 0 {
		return nil, fmt.Errorf("empty run spec")
	}
	var rs RunSpec
	if err := json.Unmarshal(b, &rs); err != nil {
		return nil, err
	}
	return &rs, nil
}

// MergeRunSpecIntoHyperparams 将 runtime 等写入 hyperparams，供现有 Python 脚本读取。
func MergeRunSpecIntoHyperparams(h map[string]interface{}, rs *RunSpec) map[string]interface{} {
	if h == nil {
		h = make(map[string]interface{})
	}
	if rs == nil {
		return h
	}
	if rs.BaseModel != "" {
		h["base_model"] = rs.BaseModel
	}
	if rs.Runtime.Epochs > 0 {
		h["epochs"] = float64(rs.Runtime.Epochs)
	}
	if rs.Runtime.BatchSize > 0 {
		h["batch_size"] = float64(rs.Runtime.BatchSize)
	}
	if rs.Runtime.LearningRate > 0 {
		h["learning_rate"] = rs.Runtime.LearningRate
	}
	if rs.Runtime.MaxLength > 0 {
		h["max_seq_length"] = float64(rs.Runtime.MaxLength)
	}
	if rs.TrainingMethod.Params != nil {
		for k, v := range rs.TrainingMethod.Params {
			h[k] = v
		}
	}
	h["_semantic_task_family"] = rs.SemanticTask.Family
	h["_semantic_task_name"] = rs.SemanticTask.Name
	h["_training_method"] = rs.TrainingMethod.Name
	h["_domain"] = rs.Domain.Name
	return h
}

// ExecutionModelType 将 RunSpec 映射为现有训练脚本路由键（兼容旧 model_type）。
func ExecutionModelType(rs *RunSpec) string {
	if rs == nil {
		return "text_classification"
	}
	switch rs.SemanticTask.Family {
	case "Alignment":
		if rs.TrainingMethod.Name == "DPO" || rs.TrainingMethod.Name == "PPO" {
			return "dpo_alignment"
		}
	case "Generation", "Extraction", "Rewriting", "InfillingReasoning":
		return "sft_finetune"
	case "SequenceTagging":
		return "token_classification"
	}
	if rs.TrainingMethod.Name == "LoRA" || rs.TrainingMethod.Name == "QLoRA" || rs.TrainingMethod.Name == "SFT" {
		// 分类 + PEFT 仍走当前 sft 脚本路径时与生成共用 finetune 可后续拆分
		if rs.SemanticTask.Family == "Classification" && rs.TrainingMethod.Name == "SFT" {
			return "text_classification"
		}
		if rs.SemanticTask.Family == "Classification" {
			return "text_classification"
		}
	}
	return "text_classification"
}
