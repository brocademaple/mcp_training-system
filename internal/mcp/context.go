package mcp

import "time"

// MCPContext is the shared task context passed across agents.
type MCPContext struct {
	SessionID     string    `json:"session_id"`
	ProjectID     int64     `json:"project_id,omitempty"`
	DatasetID     int64     `json:"dataset_id"`
	TaskType      string    `json:"task_type"`
	Domain        string    `json:"domain"`
	LabelColumn   string    `json:"label_column"`
	TextColumn    string    `json:"text_column"`
	NumClasses    int       `json:"num_classes"`
	Confirmed     bool      `json:"confirmed"`
	TrainingJobID int64     `json:"training_job_id,omitempty"`
	EvalJobID     int64     `json:"eval_job_id,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}
