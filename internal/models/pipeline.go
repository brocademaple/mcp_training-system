package models

import (
	"encoding/json"
	"time"
)

type PipelineInstance struct {
	ID                  int             `json:"id" db:"id"`
	SessionID           string          `json:"session_id" db:"session_id"`
	DatasetID           int             `json:"dataset_id" db:"dataset_id"`
	Status              string          `json:"status" db:"status"` // pending, running, completed, failed
	CurrentStep         string          `json:"current_step" db:"current_step"`
	OrchestrationState  string          `json:"orchestration_state,omitempty" db:"orchestration_state"`
	FailureCode         string          `json:"failure_code,omitempty" db:"failure_code"`
	RunSpec             json.RawMessage `json:"run_spec,omitempty" db:"run_spec"`
	JobID               *int            `json:"job_id,omitempty" db:"job_id"`
	ModelID             *int            `json:"model_id,omitempty" db:"model_id"`
	EvalID              *int            `json:"eval_id,omitempty" db:"eval_id"`
	ErrorMsg            string          `json:"error_msg,omitempty" db:"error_msg"`
	DataAgentPrompt     string          `json:"data_agent_prompt,omitempty" db:"data_agent_prompt"` // 用户设定的 Data Agent 规划偏好，用于驱动数据获取/规划
	PlanID              string          `json:"plan_id,omitempty" db:"plan_id"`                     // 计划 ID（规则版/后续 LLM Planner 生成）
	PlanSummary         string          `json:"plan_summary,omitempty" db:"plan_summary"`       // 执行时使用的计划摘要，便于审计与复现
	CreatedAt           time.Time       `json:"created_at" db:"created_at"`
	UpdatedAt           time.Time       `json:"updated_at" db:"updated_at"`
}
