package agents

import (
	"encoding/json"
	"mcp-training-system/internal/utils"
)

// ValidateQuality 多阶段质量验证
func (a *DataAgent) ValidateQuality(filePath, taskFamily string) (bool, map[string]interface{}, error) {
	utils.Info("DataAgent: Validating quality for %s", filePath)
	result, err := a.executor.Execute("data/validate_quality.py", filePath, taskFamily)
	if err != nil {
		return false, nil, err
	}
	valid := result["overall_valid"].(bool)
	return valid, result, nil
}

// CreateDataGenTask 创建数据生成任务
func (a *DataAgent) CreateDataGenTask(stage string, pipelineID *int, parentID *int, input map[string]interface{}) (int, error) {
	inputJSON, _ := json.Marshal(input)
	var taskID int
	err := a.db.QueryRow(`
		INSERT INTO data_generation_tasks (stage, pipeline_id, parent_task_id, status, input_data, task_started_at)
		VALUES ($1, $2, $3, 'pending', $4, NOW()) RETURNING id
	`, stage, pipelineID, parentID, inputJSON).Scan(&taskID)
	return taskID, err
}

// UpdateTaskStatus 更新任务状态
func (a *DataAgent) UpdateTaskStatus(taskID int, status string, output map[string]interface{}, outputPath string) error {
	outputJSON, _ := json.Marshal(output)
	_, err := a.db.Exec(`
		UPDATE data_generation_tasks
		SET status=$1, output_data=$2, output_file_path=$3, completed_at=NOW(), updated_at=NOW()
		WHERE id=$4
	`, status, outputJSON, outputPath, taskID)
	return err
}

// CheckTaskTimeout 检查并释放超时任务
func (a *DataAgent) CheckTaskTimeout() error {
	_, err := a.db.Exec(`
		UPDATE data_generation_tasks
		SET status='pending', locked_by=NULL, locked_at=NULL
		WHERE status='in_progress' AND locked_at < NOW() - INTERVAL '24 hours'
	`)
	return err
}


