package handlers

import (
	"database/sql"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"mcp-training-system/internal/config"
	"mcp-training-system/internal/services"
)

type AgentHandler struct {
	db       *sql.DB
	agentCfg *config.AgentConfig
}

func NewAgentHandler(db *sql.DB, agentCfg *config.AgentConfig) *AgentHandler {
	return &AgentHandler{db: db, agentCfg: agentCfg}
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
	}, h.agentCfg)

	c.JSON(http.StatusOK, gin.H{
		"plan": plan,
	})
}

type resolveIntentRequest struct {
	Goal string `json:"goal"`
}

// ResolveIntent POST /agent/resolve-intent — 规则引擎推断任务类型、训练方式与领域建议。
func (h *AgentHandler) ResolveIntent(c *gin.Context) {
	var req resolveIntentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	r := services.ResolveIntentUnified(strings.TrimSpace(req.Goal), h.agentCfg)
	c.JSON(http.StatusOK, gin.H{"result": r})
}
