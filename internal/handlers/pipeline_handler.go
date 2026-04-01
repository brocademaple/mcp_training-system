package handlers

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"

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
	DatasetID       int                    `json:"dataset_id" binding:"required"`
	TrainConfig     map[string]interface{} `json:"train_config"`
	DataAgentPrompt string                 `json:"data_agent_prompt"` // 用户在前端设定的 Data Agent 规划偏好（规模/语言/领域等），写入 prompt 驱动 Data Agent
	PlanID          string                 `json:"plan_id"`            // 可选：来自 /agent/plan 的计划 ID
	PlanPayload     map[string]interface{} `json:"plan_payload"`       // 可选：执行时采用的计划 payload 摘要
	RunSpec         map[string]interface{} `json:"run_spec"`           // 可选：整条流水线的 RunSpec（与训练任务一致结构）
	AgentFlow       string                 `json:"agent_flow"`         // 可选：前端 Agent 画布所选流程 full_pipeline | train_only | evaluate_only（编排扩展用）
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

	if s := strings.TrimSpace(req.AgentFlow); s != "" {
		log.Printf("CreatePipeline: agent_flow=%s dataset_id=%d", s, req.DatasetID)
	}
	if strings.EqualFold(strings.TrimSpace(req.AgentFlow), "evaluate_only") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "evaluate_only 请使用 POST /api/v1/evaluations 发起评估，勿创建训练流水线"})
		return
	}

	planSummary := ""
	if req.PlanPayload != nil {
		if b, err := json.Marshal(req.PlanPayload); err == nil {
			planSummary = string(b)
		}
	}

	var runSpecBytes []byte
	if req.RunSpec != nil {
		runSpecBytes, _ = json.Marshal(req.RunSpec)
		if req.TrainConfig != nil {
			req.TrainConfig["run_spec"] = req.RunSpec
		} else {
			req.TrainConfig = map[string]interface{}{"run_spec": req.RunSpec}
		}
	}

	pipeline, err := h.coordinator.RunPipeline(req.DatasetID, req.TrainConfig, req.DataAgentPrompt, req.PlanID, planSummary, runSpecBytes, req.AgentFlow)
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
		SELECT id, session_id, dataset_id, status, current_step,
			COALESCE(orchestration_state,'') AS orchestration_state,
			COALESCE(failure_code,'') AS failure_code,
			job_id, model_id, eval_id, error_msg, data_agent_prompt, plan_id, plan_summary, created_at, updated_at
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
		var sessionID, status, currentStep, orchState, failCode string
		var errorMsg, dataAgentPrompt, planID, planSummary sql.NullString
		var createdAt, updatedAt interface{}

		if err := rows.Scan(&id, &sessionID, &datasetID, &status, &currentStep, &orchState, &failCode, &jobID, &modelID, &evalID, &errorMsg, &dataAgentPrompt, &planID, &planSummary, &createdAt, &updatedAt); err != nil {
			continue
		}

		errorMsgVal := ""
		if errorMsg.Valid {
			errorMsgVal = errorMsg.String
		}
		dataAgentPromptVal := ""
		if dataAgentPrompt.Valid {
			dataAgentPromptVal = dataAgentPrompt.String
		}
		planIDVal := ""
		if planID.Valid {
			planIDVal = planID.String
		}
		planSummaryVal := ""
		if planSummary.Valid {
			planSummaryVal = planSummary.String
		}
		p := map[string]interface{}{
			"id":                 id,
			"session_id":         sessionID,
			"dataset_id":         datasetID,
			"status":             status,
			"current_step":       currentStep,
			"orchestration_state": orchState,
			"failure_code":       failCode,
			"error_msg":          errorMsgVal,
			"data_agent_prompt":  dataAgentPromptVal,
			"plan_id":            planIDVal,
			"plan_summary":       planSummaryVal,
			"created_at":         createdAt,
			"updated_at":         updatedAt,
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
