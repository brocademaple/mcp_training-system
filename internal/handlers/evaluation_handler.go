package handlers

import (
	"database/sql"
	"errors"
	"fmt"
	"path/filepath"
	"time"

	"github.com/gin-gonic/gin"
	"mcp-training-system/internal/agents"
	"mcp-training-system/internal/models"
	"mcp-training-system/internal/utils"
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
		Name:     fmt.Sprintf("评估-模型%d-%s", req.ModelID, time.Now().Format("20060102-150405")),
		Accuracy: 0, Precision: 0, Recall: 0, F1Score: 0,
		Status: "running",
	}
	if err := placeholder.Create(h.db); err != nil {
		c.JSON(500, gin.H{"code": 500, "message": fmt.Sprintf("Failed to create evaluation record: %v", err)})
		return
	}
	evalID := placeholder.ID

	// Start evaluation in background; on success update the placeholder. panic 时也把状态改为失败，避免一直停在「评估中」
	go func() {
		defer func() {
			if r := recover(); r != nil {
				fmt.Printf("Evaluation panic: %v\n", r)
				_ = models.UpdateEvaluationStatus(h.db, evalID, "failed", fmt.Sprintf("评估进程异常: %v", r))
			}
		}()
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
		if errors.Is(err, sql.ErrNoRows) {
			c.JSON(404, gin.H{"code": 404, "message": "Evaluation not found"})
			return
		}
		c.JSON(500, gin.H{"code": 500, "message": fmt.Sprintf("查询失败（请确认已执行迁移 007）：%v", err)})
		return
	}

	c.JSON(200, gin.H{
		"code":    200,
		"message": "success",
		"data":    eval,
	})
}

// CancelEvaluation 将进行中的评估标记为已取消（仅 status=running 可取消）
// POST /evaluations/:id/cancel
func (h *EvaluationHandler) CancelEvaluation(c *gin.Context) {
	id := c.Param("id")
	var evalID int
	if _, err := fmt.Sscanf(id, "%d", &evalID); err != nil || evalID <= 0 {
		c.JSON(400, gin.H{"code": 400, "message": "Invalid evaluation id"})
		return
	}
	var currentStatus string
	err := h.db.QueryRow("SELECT COALESCE(status,'') FROM evaluations WHERE id = $1", evalID).Scan(&currentStatus)
	if err != nil {
		c.JSON(404, gin.H{"code": 404, "message": "Evaluation not found"})
		return
	}
	if currentStatus != "running" {
		c.JSON(400, gin.H{"code": 400, "message": "仅能取消「评估中」的任务"})
		return
	}
	if err := models.UpdateEvaluationStatus(h.db, evalID, "cancelled", "用户取消"); err != nil {
		c.JSON(500, gin.H{"code": 500, "message": fmt.Sprintf("取消失败: %v", err)})
		return
	}
	c.JSON(200, gin.H{"code": 200, "message": "success", "data": gin.H{"status": "cancelled"}})
}

// DeleteEvaluation 删除评估记录
// DELETE /evaluations/:id
func (h *EvaluationHandler) DeleteEvaluation(c *gin.Context) {
	id := c.Param("id")
	var evalID int
	if _, err := fmt.Sscanf(id, "%d", &evalID); err != nil || evalID <= 0 {
		c.JSON(400, gin.H{"code": 400, "message": "Invalid evaluation id"})
		return
	}
	if err := models.DeleteEvaluation(h.db, evalID); err != nil {
		c.JSON(500, gin.H{"code": 500, "message": fmt.Sprintf("删除失败: %v", err)})
		return
	}
	c.JSON(200, gin.H{"code": 200, "message": "success"})
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

// PreviewReport 内嵌展示评估报告（与 DownloadReport 同源，仅 Content-Disposition 为 inline 便于 iframe 展示）
// GET /reports/preview/:id
func (h *EvaluationHandler) PreviewReport(c *gin.Context) {
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

	fileName := filepath.Base(eval.ReportPath)
	fullPath := filepath.Join(h.reportDir, fileName)
	c.Header("Content-Disposition", "inline")
	c.Header("Content-Type", "text/html; charset=utf-8")
	c.File(fullPath)
}

// GetEvaluationInsight 返回评估失败原因洞察：根据 error_message 解析出问题归类、摘要与建议操作
// GET /evaluations/:id/insight
func (h *EvaluationHandler) GetEvaluationInsight(c *gin.Context) {
	id := c.Param("id")
	var evalID int
	if _, err := fmt.Sscanf(id, "%d", &evalID); err != nil || evalID <= 0 {
		c.JSON(400, gin.H{"code": 400, "message": "Invalid evaluation id"})
		return
	}

	eval, err := models.GetEvaluationByID(h.db, evalID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			c.JSON(404, gin.H{"code": 404, "message": "Evaluation not found"})
			return
		}
		c.JSON(500, gin.H{"code": 500, "message": fmt.Sprintf("查询失败: %v", err)})
		return
	}

	raw := eval.ErrorMessage
	insight := utils.InsightFromErrorMessage(raw)
	c.JSON(200, gin.H{
		"code":    200,
		"message": "success",
		"data": gin.H{
			"raw_message": raw,
			"insight": gin.H{
				"category":    insight.Category,
				"summary":     insight.Summary,
				"suggestions": insight.Suggestions,
			},
		},
	})
}
