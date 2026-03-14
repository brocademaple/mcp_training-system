package models

import "time"

type PipelineInstance struct {
	ID               int       `json:"id" db:"id"`
	SessionID        string    `json:"session_id" db:"session_id"`
	DatasetID        int       `json:"dataset_id" db:"dataset_id"`
	Status           string    `json:"status" db:"status"` // pending, running, completed, failed
	CurrentStep      string    `json:"current_step" db:"current_step"`
	JobID            *int      `json:"job_id,omitempty" db:"job_id"`
	ModelID          *int      `json:"model_id,omitempty" db:"model_id"`
	EvalID           *int      `json:"eval_id,omitempty" db:"eval_id"`
	ErrorMsg         string    `json:"error_msg,omitempty" db:"error_msg"`
	DataAgentPrompt  string    `json:"data_agent_prompt,omitempty" db:"data_agent_prompt"` // 用户设定的 Data Agent 规划偏好，用于驱动数据获取/规划
	CreatedAt        time.Time `json:"created_at" db:"created_at"`
	UpdatedAt        time.Time `json:"updated_at" db:"updated_at"`
}
