package agents

import (
	"bufio"
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

	"github.com/redis/go-redis/v9"
	"mcp-training-system/internal/models"
	"mcp-training-system/internal/utils"
)

// TrainingAgent handles model training operations
type TrainingAgent struct {
	db       *sql.DB
	redis    *redis.Client
	executor *utils.PythonExecutor
	baseDir  string // 项目根目录，用于解析相对路径的 model_path 并计算模型大小
	// running 用于取消：jobID -> *exec.Cmd，Train 结束时删除
	running sync.Map
}

// NewTrainingAgent creates a new training agent. baseDir 用于解析训练脚本返回的相对 model_path（如 ./data/models/job_1）。
func NewTrainingAgent(db *sql.DB, redisClient *redis.Client, executor *utils.PythonExecutor, baseDir string) *TrainingAgent {
	if baseDir == "" {
		baseDir = "."
	}
	return &TrainingAgent{
		db:       db,
		redis:    redisClient,
		executor: executor,
		baseDir:  baseDir,
	}
}

// Train executes a training job
func (a *TrainingAgent) Train(jobID int) error {
	ctx := context.Background()
	utils.Info("TrainingAgent: Starting training for job %d", jobID)

	// 1. Query job and dataset information（dataset_id 可能为 NULL：原数据集已删除，仅保留任务与模型记录）
	var datasetIDNull sql.NullInt64
	var modelType string
	var hyperparamsJSON []byte
	err := a.db.QueryRow(`
		SELECT dataset_id, model_type, hyperparams
		FROM training_jobs WHERE id = $1
	`, jobID).Scan(&datasetIDNull, &modelType, &hyperparamsJSON)
	if err != nil {
		utils.Error("TrainingAgent: Failed to query job: %v", err)
		return fmt.Errorf("failed to query job: %v", err)
	}
	if !datasetIDNull.Valid {
		return fmt.Errorf("原数据集已删除，无法重新训练该任务；模型已保留，可继续用于评估")
	}
	datasetID := int(datasetIDNull.Int64)

	// Parse hyperparams
	var hyperparams map[string]interface{}
	if err := json.Unmarshal(hyperparamsJSON, &hyperparams); err != nil {
		return fmt.Errorf("failed to parse hyperparams: %v", err)
	}
	hyperparams["job_id"] = jobID

	// 2. Get dataset file path: 优先用清洗后路径，若未走清洗（如 JSON 直接 ready）则用原始路径
	var cleanedPath, originalPath sql.NullString
	err = a.db.QueryRow(
		"SELECT cleaned_file_path, original_file_path FROM datasets WHERE id = $1",
		datasetID,
	).Scan(&cleanedPath, &originalPath)
	if err != nil {
		utils.Error("TrainingAgent: Failed to query dataset: %v", err)
		return fmt.Errorf("failed to query dataset: %v", err)
	}
	datasetPath := ""
	if cleanedPath.Valid && cleanedPath.String != "" {
		datasetPath = cleanedPath.String
	} else if originalPath.Valid && originalPath.String != "" {
		datasetPath = originalPath.String
	}
	if datasetPath == "" {
		return fmt.Errorf("dataset has no cleaned file path (status not ready)")
	}

	// 3. Update job status to running
	models.SetTrainingJobStarted(a.db, jobID)
	utils.Info("TrainingAgent: Job %d status updated to running", jobID)

	// 4. Prepare Python command（Windows 下优先使用 .env 中的 PYTHON_PATH，避免找不到 py 导致 9009）
	hyperparamsJSON, _ = json.Marshal(hyperparams)
	pyName, pyArgs := a.executor.CommandArgs("training/train_text_clf.py", datasetPath, string(hyperparamsJSON))
	cmd := exec.Command(pyName, pyArgs...)
	// 强制 Python 子进程 stdout/stderr 使用 UTF-8，避免 Windows 下中文过程日志乱码
	cmd.Env = append(os.Environ(), "PYTHONIOENCODING=utf-8")

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		utils.Error("TrainingAgent: Failed to get stdout pipe: %v", err)
		models.UpdateTrainingJobStatus(a.db, jobID, "failed", err.Error())
		return err
	}
	var stderrBuf bytes.Buffer
	cmd.Stderr = &stderrBuf

	if err := cmd.Start(); err != nil {
		utils.Error("TrainingAgent: Failed to start training: %v", err)
		models.UpdateTrainingJobStatus(a.db, jobID, "failed", err.Error())
		return err
	}
	a.running.Store(jobID, cmd)
	defer a.running.Delete(jobID)

	utils.Info("TrainingAgent: Training process started for job %d", jobID)

	// 5. Read output in real-time
	scanner := bufio.NewScanner(stdout)
	var finalResult map[string]interface{}
	lastLoggedEpoch := -1

	for scanner.Scan() {
		line := scanner.Text()

		// 过程日志：写入 Redis 列表供弹窗拉取，并推送 WebSocket 实时更新
		if strings.HasPrefix(line, "LOG:") {
			msg := strings.TrimSpace(strings.TrimPrefix(line, "LOG:"))
			logKey := fmt.Sprintf("training:log:%d", jobID)
			a.redis.RPush(ctx, logKey, msg)
			a.redis.LTrim(ctx, logKey, -200, -1) // 只保留最近 200 条
			logPayload, _ := json.Marshal(map[string]string{"type": "log", "line": msg})
			a.redis.Publish(ctx, fmt.Sprintf("training:progress:%d", jobID), string(logPayload))
			continue
		}

		// Parse PROGRESS lines
		if strings.HasPrefix(line, "PROGRESS:") {
			jsonStr := strings.TrimPrefix(line, "PROGRESS:")
			var progress map[string]interface{}
			if err := json.Unmarshal([]byte(jsonStr), &progress); err == nil {
				// Update Redis hash (for polling/GetJobStatus/弹窗刷新)；HSet 需要 field-value 对，且 Redis 值为字符串
				progressKey := fmt.Sprintf("training:progress:%d", jobID)
				for k, v := range progress {
					var s string
					switch x := v.(type) {
					case float64:
						s = strconv.FormatFloat(x, 'f', -1, 64)
					case string:
						s = x
					case int:
						s = strconv.Itoa(x)
					case nil:
						continue
					default:
						s = fmt.Sprintf("%v", v)
					}
					a.redis.HSet(ctx, progressKey, k, s)
				}

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
		// 若已被用户取消，不再覆盖为 failed
		if cur, _ := models.GetTrainingJobByID(a.db, jobID); cur != nil && cur.Status == "cancelled" {
			return nil
		}
		errMsg := err.Error()
		// Python 异常时会先向 stdout 打印 {"status":"error","error_message":"..."}，优先用该内容作为失败原因
		if finalResult != nil {
			if em, ok := finalResult["error_message"].(string); ok && em != "" {
				errMsg = em
			}
		}
		if stderr := strings.TrimSpace(stderrBuf.String()); stderr != "" && !strings.Contains(errMsg, stderr) {
			errMsg = errMsg + "; stderr: " + stderr
		}
		utils.Error("TrainingAgent: Training failed: %s", errMsg)
		models.UpdateTrainingJobStatus(a.db, jobID, "failed", errMsg)
		failMsg, _ := json.Marshal(map[string]interface{}{"status": "failed", "error_message": errMsg})
		a.redis.Publish(ctx, fmt.Sprintf("training:progress:%d", jobID), string(failMsg))
		return fmt.Errorf("%s", errMsg)
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

	// 8. Save model to database（计算模型目录大小供前端「大小」列展示）
	modelPath := finalResult["model_path"].(string)
	absPath := modelPath
	if !filepath.IsAbs(modelPath) {
		absPath = filepath.Join(a.baseDir, modelPath)
	}
	absPath = filepath.Clean(absPath)
	modelSize := int64(0)
	if size, err := utils.GetDirSize(absPath); err == nil {
		modelSize = size
		utils.Info("TrainingAgent: Model dir size computed: %d bytes (%s)", modelSize, absPath)
	} else {
		utils.Error("TrainingAgent: GetDirSize failed for %q: %v (model_size will be 0)", absPath, err)
	}
	model := &models.Model{
		JobID:     jobID,
		Name:      fmt.Sprintf("Model for job %d", jobID),
		ModelPath: modelPath,
		ModelSize: modelSize,
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

// GetRecentLogs 返回该任务最近的过程日志（训练脚本输出的 LOG: 行），供前端详情面板展示
func (a *TrainingAgent) GetRecentLogs(jobID int) ([]string, error) {
	ctx := context.Background()
	key := fmt.Sprintf("training:log:%d", jobID)
	result, err := a.redis.LRange(ctx, key, 0, -1).Result()
	if err != nil {
		return nil, err
	}
	return result, nil
}

// CancelJob 终止正在运行的训练进程，并将任务标为已取消（仅对 status=running 有效）
func (a *TrainingAgent) CancelJob(jobID int) error {
	ctx := context.Background()
	v, ok := a.running.Load(jobID)
	if !ok {
		return fmt.Errorf("任务未在运行，无法取消")
	}
	cmd, ok := v.(*exec.Cmd)
	if !ok || cmd.Process == nil {
		return fmt.Errorf("任务未在运行，无法取消")
	}
	if err := cmd.Process.Kill(); err != nil {
		return fmt.Errorf("终止进程失败: %v", err)
	}
	_ = models.UpdateTrainingJobStatus(a.db, jobID, "cancelled", "用户取消")
	cancelMsg, _ := json.Marshal(map[string]interface{}{"status": "cancelled", "error_message": "用户取消"})
	a.redis.Publish(ctx, fmt.Sprintf("training:progress:%d", jobID), string(cancelMsg))
	utils.Info("TrainingAgent: Job %d cancelled by user", jobID)
	return nil
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
