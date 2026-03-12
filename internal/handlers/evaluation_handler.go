package handlers

import (
	"database/sql"
	"fmt"
	"path/filepath"

	"github.com/gin-gonic/gin"
	"mcp-training-system/internal/agents"
	"mcp-training-system/internal/models"
)

// EvaluationHandler handles evaluation-related requests
type EvaluationHandler struct {
	db        *sql.DB
	evalAgent *agents.EvaluationAgent
	reportDir string
}

// NewEvaluationHandler creates a new evaluation handler
func NewEvaluationHandler(db *sql.DB, evalAgent *agents.EvaluationAgent, reportDir string) *EvaluationHandler {
	return &EvaluationHandler{
		db:        db,
		evalAgent: evalAgent,
		reportDir: reportDir,
	}
}

// CreateEvaluation creates a new evaluation
func (h *EvaluationHandler) CreateEvaluation(c *gin.Context) {
	var req struct {
		ModelID       int `json:"model_id"`
		TestDatasetID int `json:"test_dataset_id"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"code": 400, "message": "Invalid request"})
		return
	}

	// 立即插入一条占位记录（status=running），列表可马上显示；后台任务完成后更新该记录
	placeholder := &models.Evaluation{
		ModelID:  req.ModelID,
		Accuracy: 0, Precision: 0, Recall: 0, F1Score: 0,
		Status: "running",
	}
	if err := placeholder.Create(h.db); err != nil {
		c.JSON(500, gin.H{"code": 500, "message": fmt.Sprintf("Failed to create evaluation record: %v", err)})
		return
	}
	evalID := placeholder.ID

	// Start evaluation in background; on success update the placeholder
	go func() {
		if err := h.evalAgent.Evaluate(req.ModelID, req.TestDatasetID, evalID); err != nil {
			fmt.Printf("Evaluation failed: %v\n", err)
		}
	}()

	c.JSON(200, gin.H{
		"code":    200,
		"message": "success",
		"data": gin.H{
			"status":       "processing",
			"evaluation_id": evalID,
		},
	})
}

// GetEvaluations returns list of all evaluations
// GET /evaluations
func (h *EvaluationHandler) GetEvaluations(c *gin.Context) {
	list, err := models.GetEvaluationsAll(h.db)
	if err != nil {
		c.JSON(500, gin.H{"code": 500, "message": fmt.Sprintf("Failed to get evaluations: %v", err)})
		return
	}
	c.JSON(200, gin.H{
		"code":    200,
		"message": "success",
		"data":    gin.H{"evaluations": list},
	})
}

// GetEvaluationResult returns evaluation result
func (h *EvaluationHandler) GetEvaluationResult(c *gin.Context) {
	id := c.Param("id")
	var evalID int
	fmt.Sscanf(id, "%d", &evalID)

	eval, err := models.GetEvaluationByID(h.db, evalID)
	if err != nil {
		c.JSON(404, gin.H{"code": 404, "message": "Evaluation not found"})
		return
	}

	c.JSON(200, gin.H{
		"code":    200,
		"message": "success",
		"data":    eval,
	})
}

// DownloadReport serves the evaluation HTML report file
// GET /reports/download/:id  (id = evaluation_id)
func (h *EvaluationHandler) DownloadReport(c *gin.Context) {
	id := c.Param("id")
	var evalID int
	if _, err := fmt.Sscanf(id, "%d", &evalID); err != nil || evalID <= 0 {
		c.JSON(400, gin.H{"code": 400, "message": "Invalid evaluation id"})
		return
	}

	eval, err := models.GetEvaluationByID(h.db, evalID)
	if err != nil {
		c.JSON(404, gin.H{"code": 404, "message": "Evaluation not found"})
		return
	}
	if eval.ReportPath == "" {
		c.JSON(404, gin.H{"code": 404, "message": "Report not available for this evaluation"})
		return
	}

	// Resolve path: reportDir + basename of stored path (e.g. eval_1_123.html)
	fileName := filepath.Base(eval.ReportPath)
	fullPath := filepath.Join(h.reportDir, fileName)
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%q", fileName))
	c.Header("Content-Type", "text/html; charset=utf-8")
	c.File(fullPath)
}
