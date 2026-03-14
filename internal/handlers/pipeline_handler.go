package handlers

import (
	"database/sql"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"mcp-training-system/internal/mcp"
)

type PipelineHandler struct {
	db          *sql.DB
	coordinator *mcp.Coordinator
}

func NewPipelineHandler(db *sql.DB, coordinator *mcp.Coordinator) *PipelineHandler {
	return &PipelineHandler{
		db:          db,
		coordinator: coordinator,
	}
}

type CreatePipelineRequest struct {
	DatasetID   int                    `json:"dataset_id" binding:"required"`
	TrainConfig map[string]interface{} `json:"train_config"`
}

func (h *PipelineHandler) CreatePipeline(c *gin.Context) {
	var req CreatePipelineRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.TrainConfig == nil {
		req.TrainConfig = map[string]interface{}{"model_type": "random_forest"}
	}

	pipeline, err := h.coordinator.RunPipeline(req.DatasetID, req.TrainConfig)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, pipeline)
}

func (h *PipelineHandler) GetPipelineStatus(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid pipeline id"})
		return
	}

	pipeline, err := h.coordinator.GetPipelineStatus(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "pipeline not found"})
		return
	}

	c.JSON(http.StatusOK, pipeline)
}

func (h *PipelineHandler) ListPipelines(c *gin.Context) {
	rows, err := h.db.Query(`
		SELECT id, session_id, dataset_id, status, current_step, job_id, model_id, eval_id, error_msg, created_at, updated_at
		FROM pipeline_instances ORDER BY created_at DESC LIMIT 100
	`)
	if err != nil {
		// 表未创建或查询失败时统一返回 200 空列表，避免 500 导致前端反复报错（流水线历史功能可后续完善）
		c.JSON(http.StatusOK, []interface{}{})
		return
	}
	defer rows.Close()

	var pipelines []map[string]interface{}
	for rows.Next() {
		var id, datasetID int
		var jobID, modelID, evalID sql.NullInt64
		var sessionID, status, currentStep string
		var errorMsg sql.NullString
		var createdAt, updatedAt interface{}

		if err := rows.Scan(&id, &sessionID, &datasetID, &status, &currentStep, &jobID, &modelID, &evalID, &errorMsg, &createdAt, &updatedAt); err != nil {
			continue
		}

		errorMsgVal := ""
		if errorMsg.Valid {
			errorMsgVal = errorMsg.String
		}
		p := map[string]interface{}{
			"id":           id,
			"session_id":   sessionID,
			"dataset_id":   datasetID,
			"status":       status,
			"current_step": currentStep,
			"error_msg":    errorMsgVal,
			"created_at":   createdAt,
			"updated_at":   updatedAt,
		}
		if jobID.Valid {
			p["job_id"] = jobID.Int64
		}
		if modelID.Valid {
			p["model_id"] = modelID.Int64
		}
		if evalID.Valid {
			p["eval_id"] = evalID.Int64
		}
		pipelines = append(pipelines, p)
	}

	c.JSON(http.StatusOK, pipelines)
}
