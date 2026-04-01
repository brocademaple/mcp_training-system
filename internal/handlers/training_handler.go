package handlers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strconv"

	"github.com/gin-gonic/gin"
	"mcp-training-system/internal/agents"
	"mcp-training-system/internal/models"
	"mcp-training-system/internal/registry"
	"mcp-training-system/internal/services"
)

// TrainingHandler handles training-related requests
type TrainingHandler struct {
	db            *sql.DB
	trainingAgent *agents.TrainingAgent
}

// NewTrainingHandler creates a new training handler
func NewTrainingHandler(db *sql.DB, trainingAgent *agents.TrainingAgent) *TrainingHandler {
	return &TrainingHandler{
		db:            db,
		trainingAgent: trainingAgent,
	}
}

// CreateJob creates a new training job
func (h *TrainingHandler) CreateJob(c *gin.Context) {
	var req struct {
		Name        string                 `json:"name"`
		DatasetID   int                    `json:"dataset_id"`
		ModelType   string                 `json:"model_type"`
		Hyperparams map[string]interface{} `json:"hyperparams"`
		RunSpec     map[string]interface{} `json:"run_spec"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"code": 400, "message": "Invalid request"})
		return
	}

	if req.Hyperparams == nil {
		req.Hyperparams = map[string]interface{}{}
	}

	var runSpecJSON []byte
	if req.RunSpec != nil {
		rsBytes, _ := json.Marshal(req.RunSpec)
		rs, err := models.ParseRunSpec(rsBytes)
		if err != nil {
			c.JSON(400, gin.H{"code": 400, "message": "invalid run_spec: " + err.Error()})
			return
		}
		services.MergeMethodDefaults(rs)
		services.ApplyDomainToRunSpec(rs)
		if b := registry.Get(); b != nil {
			if err := b.ValidateRunSpec(rs.SemanticTask.Family, rs.TrainingMethod.Name); err != nil {
				c.JSON(400, gin.H{"code": 400, "message": err.Error()})
				return
			}
		}
		req.Hyperparams = models.MergeRunSpecIntoHyperparams(req.Hyperparams, rs)
		req.ModelType = models.ExecutionModelType(rs)
		runSpecJSON, _ = models.RunSpecToJSON(rs)
	}

	// 安全解析 epochs，避免类型断言 panic（前端可能传 float64 或缺失）
	epochs := 3
	if v, ok := req.Hyperparams["epochs"]; ok && v != nil {
		switch n := v.(type) {
		case float64:
			epochs = int(n)
		case int:
			epochs = n
		case int64:
			epochs = int(n)
		}
	}
	if epochs < 1 {
		epochs = 1
	}
	req.Hyperparams["epochs"] = float64(epochs)

	datasetID := req.DatasetID
	job := &models.TrainingJob{
		UserID:      1, // Default user
		Name:        req.Name,
		DatasetID:   &datasetID,
		ModelType:   req.ModelType,
		Hyperparams: req.Hyperparams,
		Status:      "queued",
		TotalEpochs: epochs,
	}
	if len(runSpecJSON) > 0 {
		job.RunSpec = runSpecJSON
	}

	if err := job.Create(h.db); err != nil {
		c.JSON(500, gin.H{"code": 500, "message": fmt.Sprintf("Failed to create job: %v", err)})
		return
	}

	// Start training in background；若 Train 返回错误（如数据集未就绪、Python 启动失败），将任务标为失败并写入原因
	go func() {
		if err := h.trainingAgent.Train(job.ID); err != nil {
			fmt.Printf("Training failed for job %d: %v\n", job.ID, err)
			_ = models.UpdateTrainingJobStatus(h.db, job.ID, "failed", err.Error())
		}
	}()

	c.JSON(200, gin.H{
		"code":    200,
		"message": "success",
		"data": gin.H{
			"job_id": job.ID,
			"status": "queued",
		},
	})
}

// checkQueuedJobDatasetReady 检查排队中任务对应的数据集是否已就绪（有可训练路径：清洗后或原始）；若不就绪则将该任务标为失败并写入原因
func (h *TrainingHandler) checkQueuedJobDatasetReady(job *models.TrainingJob) {
	if job == nil || job.Status != "queued" {
		return
	}
	if job.DatasetID == nil {
		_ = models.UpdateTrainingJobStatus(h.db, job.ID, "failed", "原数据集已删除，无法开始训练")
		return
	}
	var status string
	var cleanedPath, originalPath sql.NullString
	err := h.db.QueryRow(
		"SELECT status, cleaned_file_path, original_file_path FROM datasets WHERE id = $1",
		*job.DatasetID,
	).Scan(&status, &cleanedPath, &originalPath)
	if err != nil {
		_ = models.UpdateTrainingJobStatus(h.db, job.ID, "failed", "dataset not found")
		return
	}
	hasPath := (cleanedPath.Valid && cleanedPath.String != "") || (originalPath.Valid && originalPath.String != "")
	if status != "ready" || !hasPath {
		msg := "dataset has no cleaned file path (status not ready)"
		_ = models.UpdateTrainingJobStatus(h.db, job.ID, "failed", msg)
	}
}

// GetJobs returns training jobs list for the default user. 对仍为「排队中」的任务做一次就绪检查，若数据集未就绪则自动标为失败并返回最新列表，实现即时更新。
// GET /training/jobs?user_id=1
func (h *TrainingHandler) GetJobs(c *gin.Context) {
	userID := 1
	if uid := c.Query("user_id"); uid != "" {
		if p, err := strconv.Atoi(uid); err == nil {
			userID = p
		}
	}
	jobs, err := models.GetTrainingJobsByUserID(h.db, userID)
	if err != nil {
		c.JSON(500, gin.H{"code": 500, "message": fmt.Sprintf("Failed to get jobs: %v", err)})
		return
	}
	// 对每个仍为 queued 的任务检查数据集是否就绪，避免历史任务一直显示「排队中」
	for _, j := range jobs {
		h.checkQueuedJobDatasetReady(j)
	}
	// 若有状态被修正，重新拉取列表以返回最新状态
	jobs, err = models.GetTrainingJobsByUserID(h.db, userID)
	if err != nil {
		c.JSON(500, gin.H{"code": 500, "message": fmt.Sprintf("Failed to get jobs: %v", err)})
		return
	}
	c.JSON(200, gin.H{
		"code":    200,
		"message": "success",
		"data":    gin.H{"jobs": jobs},
	})
}

// GetJobStatus returns training job status. 若任务仍为「排队中」会先做一次就绪检查，可能被修正为失败并返回最新状态与 error_message。
func (h *TrainingHandler) GetJobStatus(c *gin.Context) {
	id := c.Param("id")
	var jobID int
	if _, err := fmt.Sscanf(id, "%d", &jobID); err != nil || jobID <= 0 {
		c.JSON(400, gin.H{"code": 400, "message": "Invalid job id"})
		return
	}

	job, err := models.GetTrainingJobByID(h.db, jobID)
	if err != nil {
		c.JSON(404, gin.H{"code": 404, "message": "Job not found"})
		return
	}

	h.checkQueuedJobDatasetReady(job)
	// 可能已被标为失败，重新拉取以返回最新状态
	job, err = models.GetTrainingJobByID(h.db, jobID)
	if err != nil {
		c.JSON(500, gin.H{"code": 500, "message": "Failed to re-fetch job"})
		return
	}

	progress, _ := h.trainingAgent.GetProgress(jobID)
	logLines, _ := h.trainingAgent.GetRecentLogs(jobID)
	if logLines == nil {
		logLines = []string{}
	}

	errMsg := ""
	if job.ErrorMessage != nil {
		errMsg = *job.ErrorMessage
	}
	data := gin.H{
		"id":             job.ID,
		"name":           job.Name,
		"status":         job.Status,
		"progress":       job.Progress,
		"current_epoch": job.CurrentEpoch,
		"total_epochs":   job.TotalEpochs,
		"error_message":  errMsg,
		"redis_progress": progress,
		"log_lines":       logLines,
		"model_type":     job.ModelType,
		"hyperparams":    job.Hyperparams,
	}
	if len(job.RunSpec) > 0 {
		var rsObj interface{}
		if json.Unmarshal(job.RunSpec, &rsObj) == nil {
			data["run_spec"] = rsObj
		}
	}
	if eff := job.EffectiveRunSpec(); eff != nil {
		b, _ := json.Marshal(eff)
		var effObj interface{}
		_ = json.Unmarshal(b, &effObj)
		data["effective_run_spec"] = effObj
	}
	c.JSON(200, gin.H{
		"code":    200,
		"message": "success",
		"data":    data,
	})
}

// GetJobLogs returns training logs (per-epoch loss/accuracy) for a job
// GET /training/jobs/:id/logs
func (h *TrainingHandler) GetJobLogs(c *gin.Context) {
	id := c.Param("id")
	var jobID int
	if _, err := fmt.Sscanf(id, "%d", &jobID); err != nil || jobID <= 0 {
		c.JSON(400, gin.H{"code": 400, "message": "Invalid job id"})
		return
	}

	// Verify job exists
	if _, err := models.GetTrainingJobByID(h.db, jobID); err != nil {
		c.JSON(404, gin.H{"code": 404, "message": "Job not found"})
		return
	}

	logs, err := models.GetTrainingLogsByJobID(h.db, jobID)
	if err != nil {
		c.JSON(500, gin.H{"code": 500, "message": fmt.Sprintf("Failed to get logs: %v", err)})
		return
	}

	c.JSON(200, gin.H{
		"code":    200,
		"message": "success",
		"data":    gin.H{"logs": logs},
	})
}

// RestartJob 重启训练：仅允许对已结束（failed/completed）的任务操作，重置状态后重新跑 Train
// POST /training/jobs/:id/restart
func (h *TrainingHandler) RestartJob(c *gin.Context) {
	id := c.Param("id")
	var jobID int
	if _, err := fmt.Sscanf(id, "%d", &jobID); err != nil || jobID <= 0 {
		c.JSON(400, gin.H{"code": 400, "message": "Invalid job id"})
		return
	}
	job, err := models.GetTrainingJobByID(h.db, jobID)
	if err != nil {
		c.JSON(404, gin.H{"code": 404, "message": "Job not found"})
		return
	}
	if job.Status != "failed" && job.Status != "completed" && job.Status != "running" && job.Status != "cancelled" {
		c.JSON(400, gin.H{"code": 400, "message": "只能重启已失败、已完成、已取消或进行中的任务"})
		return
	}
	if err := models.ResetJobForRestart(h.db, jobID); err != nil {
		c.JSON(500, gin.H{"code": 500, "message": fmt.Sprintf("Failed to reset job: %v", err)})
		return
	}
	go func() {
		if err := h.trainingAgent.Train(jobID); err != nil {
			fmt.Printf("Training failed for job %d: %v\n", jobID, err)
			_ = models.UpdateTrainingJobStatus(h.db, jobID, "failed", err.Error())
		}
	}()
	c.JSON(200, gin.H{"code": 200, "message": "success", "data": gin.H{"job_id": jobID, "status": "queued"}})
}

// CancelJob 取消正在运行的训练任务
// POST /training/jobs/:id/cancel
func (h *TrainingHandler) CancelJob(c *gin.Context) {
	id := c.Param("id")
	var jobID int
	if _, err := fmt.Sscanf(id, "%d", &jobID); err != nil || jobID <= 0 {
		c.JSON(400, gin.H{"code": 400, "message": "Invalid job id"})
		return
	}
	if _, err := models.GetTrainingJobByID(h.db, jobID); err != nil {
		c.JSON(404, gin.H{"code": 404, "message": "Job not found"})
		return
	}
	if err := h.trainingAgent.CancelJob(jobID); err != nil {
		c.JSON(400, gin.H{"code": 400, "message": err.Error()})
		return
	}
	c.JSON(200, gin.H{"code": 200, "message": "success", "data": gin.H{"job_id": jobID, "status": "cancelled"}})
}

// DeleteJob 删除训练任务
// DELETE /training/jobs/:id
func (h *TrainingHandler) DeleteJob(c *gin.Context) {
	id := c.Param("id")
	var jobID int
	if _, err := fmt.Sscanf(id, "%d", &jobID); err != nil || jobID <= 0 {
		c.JSON(400, gin.H{"code": 400, "message": "Invalid job id"})
		return
	}
	if _, err := models.GetTrainingJobByID(h.db, jobID); err != nil {
		c.JSON(404, gin.H{"code": 404, "message": "Job not found"})
		return
	}
	if err := models.DeleteTrainingJob(h.db, jobID); err != nil {
		c.JSON(500, gin.H{"code": 500, "message": fmt.Sprintf("Failed to delete: %v", err)})
		return
	}
	c.JSON(200, gin.H{"code": 200, "message": "success"})
}

// GetRawLogs returns raw training logs from Redis
// GET /training/jobs/:id/raw-logs
func (h *TrainingHandler) GetRawLogs(c *gin.Context) {
	id := c.Param("id")
	var jobID int
	if _, err := fmt.Sscanf(id, "%d", &jobID); err != nil || jobID <= 0 {
		c.JSON(400, gin.H{"code": 400, "message": "Invalid job id"})
		return
	}
	logs, err := h.trainingAgent.GetRecentLogs(jobID)
	if err != nil || logs == nil {
		logs = []string{}
	}
	c.JSON(200, gin.H{"code": 200, "message": "success", "data": gin.H{"logs": logs}})
}
