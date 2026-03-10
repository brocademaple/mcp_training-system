package handlers

import (
	"database/sql"
	"fmt"
	"strconv"

	"github.com/gin-gonic/gin"
	"mcp-training-system/internal/agents"
	"mcp-training-system/internal/models"
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
		DatasetID   int                    `json:"dataset_id"`
		ModelType   string                 `json:"model_type"`
		Hyperparams map[string]interface{} `json:"hyperparams"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"code": 400, "message": "Invalid request"})
		return
	}

	// Create training job
	job := &models.TrainingJob{
		UserID:      1, // Default user
		DatasetID:   req.DatasetID,
		ModelType:   req.ModelType,
		Hyperparams: req.Hyperparams,
		Status:      "queued",
		TotalEpochs: int(req.Hyperparams["epochs"].(float64)),
	}

	if err := job.Create(h.db); err != nil {
		c.JSON(500, gin.H{"code": 500, "message": fmt.Sprintf("Failed to create job: %v", err)})
		return
	}

	// Start training in background
	go func() {
		if err := h.trainingAgent.Train(job.ID); err != nil {
			fmt.Printf("Training failed for job %d: %v\n", job.ID, err)
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

// GetJobs returns training jobs list for the default user
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
	c.JSON(200, gin.H{
		"code":    200,
		"message": "success",
		"data":    gin.H{"jobs": jobs},
	})
}

// GetJobStatus returns training job status
func (h *TrainingHandler) GetJobStatus(c *gin.Context) {
	id := c.Param("id")
	var jobID int
	fmt.Sscanf(id, "%d", &jobID)

	job, err := models.GetTrainingJobByID(h.db, jobID)
	if err != nil {
		c.JSON(404, gin.H{"code": 404, "message": "Job not found"})
		return
	}

	// Get progress from Redis
	progress, _ := h.trainingAgent.GetProgress(jobID)

	c.JSON(200, gin.H{
		"code":    200,
		"message": "success",
		"data": gin.H{
			"id":            job.ID,
			"status":        job.Status,
			"progress":      job.Progress,
			"current_epoch": job.CurrentEpoch,
			"total_epochs":  job.TotalEpochs,
			"redis_progress": progress,
		},
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
