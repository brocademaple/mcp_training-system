package agents

import (
	"bufio"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/redis/go-redis/v9"
	"mcp-training-system/internal/models"
	"mcp-training-system/internal/utils"
)

// TrainingAgent handles model training operations
type TrainingAgent struct {
	db       *sql.DB
	redis    *redis.Client
	executor *utils.PythonExecutor
}

// NewTrainingAgent creates a new training agent
func NewTrainingAgent(db *sql.DB, redisClient *redis.Client, executor *utils.PythonExecutor) *TrainingAgent {
	return &TrainingAgent{
		db:       db,
		redis:    redisClient,
		executor: executor,
	}
}

// Train executes a training job
func (a *TrainingAgent) Train(jobID int) error {
	ctx := context.Background()
	utils.Info("TrainingAgent: Starting training for job %d", jobID)

	// 1. Query job and dataset information
	var datasetID int
	var modelType string
	var hyperparamsJSON []byte
	err := a.db.QueryRow(`
		SELECT dataset_id, model_type, hyperparams
		FROM training_jobs WHERE id = $1
	`, jobID).Scan(&datasetID, &modelType, &hyperparamsJSON)
	if err != nil {
		utils.Error("TrainingAgent: Failed to query job: %v", err)
		return fmt.Errorf("failed to query job: %v", err)
	}

	// Parse hyperparams
	var hyperparams map[string]interface{}
	if err := json.Unmarshal(hyperparamsJSON, &hyperparams); err != nil {
		return fmt.Errorf("failed to parse hyperparams: %v", err)
	}
	hyperparams["job_id"] = jobID

	// 2. Get dataset file path
	var datasetPath string
	err = a.db.QueryRow(
		"SELECT cleaned_file_path FROM datasets WHERE id = $1",
		datasetID,
	).Scan(&datasetPath)
	if err != nil {
		utils.Error("TrainingAgent: Failed to query dataset: %v", err)
		return fmt.Errorf("failed to query dataset: %v", err)
	}

	// 3. Update job status to running
	models.SetTrainingJobStarted(a.db, jobID)
	utils.Info("TrainingAgent: Job %d status updated to running", jobID)

	// 4. Prepare Python command
	hyperparamsJSON, _ = json.Marshal(hyperparams)
	scriptPath := filepath.Join(a.executor.ScriptsDir, "training/train_text_clf.py")
	cmd := exec.Command(a.executor.PythonPath, scriptPath, datasetPath, string(hyperparamsJSON))

	// Get stdout pipe for real-time progress
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		utils.Error("TrainingAgent: Failed to get stdout pipe: %v", err)
		models.UpdateTrainingJobStatus(a.db, jobID, "failed", err.Error())
		return err
	}

	// Start command
	if err := cmd.Start(); err != nil {
		utils.Error("TrainingAgent: Failed to start training: %v", err)
		models.UpdateTrainingJobStatus(a.db, jobID, "failed", err.Error())
		return err
	}

	utils.Info("TrainingAgent: Training process started for job %d", jobID)

	// 5. Read output in real-time
	scanner := bufio.NewScanner(stdout)
	var finalResult map[string]interface{}
	lastLoggedEpoch := -1

	for scanner.Scan() {
		line := scanner.Text()

		// Parse PROGRESS lines
		if strings.HasPrefix(line, "PROGRESS:") {
			jsonStr := strings.TrimPrefix(line, "PROGRESS:")
			var progress map[string]interface{}
			if err := json.Unmarshal([]byte(jsonStr), &progress); err == nil {
				// Update Redis hash (for polling/initial state)
				progressKey := fmt.Sprintf("training:progress:%d", jobID)
				a.redis.HSet(ctx, progressKey, progress)

				// Publish to channel for WebSocket subscribers
				channel := fmt.Sprintf("training:progress:%d", jobID)
				a.redis.Publish(ctx, channel, jsonStr)

				// Update database progress
				epochFloat, _ := progress["epoch"].(float64)
				if hyperparams["epochs"] != nil {
					progressPct := int((epochFloat / float64(hyperparams["epochs"].(float64))) * 100)
					models.UpdateTrainingJobProgress(a.db, jobID, progressPct, int(epochFloat))
				}

				// Insert training_logs once per completed epoch (PRD: 每个 epoch 结束，插入)
				epochInt := int(math.Floor(epochFloat))
				if epochInt > lastLoggedEpoch && epochInt >= 0 {
					loss, _ := toFloat64(progress["loss"])
					accuracy, _ := toFloat64(progress["accuracy"])
					lr, _ := toFloat64(progress["learning_rate"])
					logEntry := &models.TrainingLog{
						JobID:        jobID,
						Epoch:        epochInt,
						Loss:         loss,
						Accuracy:     accuracy,
						LearningRate: lr,
					}
					if err := logEntry.Create(a.db); err == nil {
						lastLoggedEpoch = epochInt
					}
				}
			}
		} else if strings.HasPrefix(line, "{") {
			// Parse final result JSON
			json.Unmarshal([]byte(line), &finalResult)
		}
	}

	// 6. Wait for command to finish
	if err := cmd.Wait(); err != nil {
		utils.Error("TrainingAgent: Training failed: %v", err)
		models.UpdateTrainingJobStatus(a.db, jobID, "failed", err.Error())
		failMsg, _ := json.Marshal(map[string]interface{}{"status": "failed", "error_message": err.Error()})
		a.redis.Publish(ctx, fmt.Sprintf("training:progress:%d", jobID), string(failMsg))
		return err
	}

	// 7. Check final result
	if finalResult == nil || finalResult["status"] != "success" {
		errMsg := "Training failed"
		if finalResult != nil && finalResult["error_message"] != nil {
			errMsg = finalResult["error_message"].(string)
		}
		utils.Error("TrainingAgent: %s", errMsg)
		models.UpdateTrainingJobStatus(a.db, jobID, "failed", errMsg)
		return fmt.Errorf(errMsg)
	}

	// 8. Save model to database
	modelPath := finalResult["model_path"].(string)
	model := &models.Model{
		JobID:     jobID,
		Name:      fmt.Sprintf("Model for job %d", jobID),
		ModelPath: modelPath,
		ModelType: modelType,
		Framework: "pytorch",
	}
	if err := model.Create(a.db); err != nil {
		utils.Error("TrainingAgent: Failed to save model: %v", err)
		return err
	}

	// 9. Update job status to completed
	models.SetTrainingJobCompleted(a.db, jobID)
	// Notify WebSocket subscribers that training finished
	finishMsg, _ := json.Marshal(map[string]interface{}{"status": "completed", "progress": 100, "epoch": hyperparams["epochs"]})
	a.redis.Publish(ctx, fmt.Sprintf("training:progress:%d", jobID), string(finishMsg))
	utils.Info("TrainingAgent: Training completed for job %d, model ID: %d", jobID, model.ID)

	return nil
}

// GetProgress retrieves training progress from Redis
func (a *TrainingAgent) GetProgress(jobID int) (map[string]interface{}, error) {
	ctx := context.Background()
	progressKey := fmt.Sprintf("training:progress:%d", jobID)

	result, err := a.redis.HGetAll(ctx, progressKey).Result()
	if err != nil {
		return nil, fmt.Errorf("failed to get progress: %v", err)
	}

	// Convert to map[string]interface{}
	progress := make(map[string]interface{})
	for k, v := range result {
		progress[k] = v
	}

	return progress, nil
}

// toFloat64 converts progress map value to float64 (JSON numbers are float64; Redis values may be string)
func toFloat64(v interface{}) (float64, bool) {
	if v == nil {
		return 0, false
	}
	switch x := v.(type) {
	case float64:
		return x, true
	case string:
		var f float64
		if _, err := fmt.Sscanf(x, "%f", &f); err == nil {
			return f, true
		}
		return 0, false
	default:
		return 0, false
	}
}
