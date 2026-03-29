package handlers

import (
	"database/sql"
	"net/http"

	"github.com/gin-gonic/gin"
	"mcp-training-system/internal/services"
)

type AgentHandler struct {
	db *sql.DB
}

func NewAgentHandler(db *sql.DB) *AgentHandler {
	return &AgentHandler{db: db}
}

type PlanAPIRequest struct {
	Goal            string `json:"goal"`
	ModelType       string `json:"model_type"`
	Intent          string `json:"intent"`
	MaterialSource  string `json:"material_source"`
	DataAgentPrompt string `json:"data_agent_prompt"`
	TrainMode       string `json:"train_mode"`
}

func (h *AgentHandler) CreatePlan(c *gin.Context) {
	var req PlanAPIRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 候选数据集（规则版 planner 可用于推荐）
	candidates := make([]services.DatasetCandidate, 0, 10)
	rows, err := h.db.Query(`
		SELECT id, name, status
		FROM datasets
		WHERE status = 'ready'
		ORDER BY created_at DESC
		LIMIT 10
	`)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var d services.DatasetCandidate
			if scanErr := rows.Scan(&d.ID, &d.Name, &d.Status); scanErr == nil {
				candidates = append(candidates, d)
			}
		}
	}

	plan := services.BuildRulePlan(services.PlanRequest{
		Goal:              req.Goal,
		ModelType:         req.ModelType,
		Intent:            req.Intent,
		MaterialSource:    req.MaterialSource,
		DataAgentPrompt:   req.DataAgentPrompt,
		TrainMode:         req.TrainMode,
		DatasetCandidates: candidates,
	})

	c.JSON(http.StatusOK, gin.H{
		"plan": plan,
	})
}

