package handlers

import (
	"database/sql"
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"mcp-training-system/internal/config"
	"mcp-training-system/internal/mcp"
	"mcp-training-system/internal/services"
)

type AgentHandler struct {
	db         *sql.DB
	agentStore *config.AgentStore
	mcpStore   *mcp.Store
}

func NewAgentHandler(db *sql.DB, agentStore *config.AgentStore, mcpStore *mcp.Store) *AgentHandler {
	return &AgentHandler{db: db, agentStore: agentStore, mcpStore: mcpStore}
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
	}, agentCfgPtr(h.agentStore))

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
	sessionID := extractSessionID(c, "")
	ph0 := 0
	if sessionID != "" && h.mcpStore != nil {
		_, _ = h.mcpStore.AppendSessionEvent(sessionID, mcp.SessionEvent{
			Kind:  mcp.SessionEventSystem,
			Phase: &ph0,
			Text:  "状态：任务理解阶段 · 开始解析训练意图（MCP 会话事件已写入 Redis）",
		})
	}
	cfg := h.agentStore.Snapshot()
	r := services.ResolveIntentUnified(strings.TrimSpace(req.Goal), &cfg)
	if sessionID != "" && h.mcpStore != nil {
		reqMsg := mcp.NewRequest("orchestrator", "intent-resolver", "resolve_intent", map[string]interface{}{
			"goal_preview": truncateRunes(strings.TrimSpace(req.Goal), 120),
		})
		respMsg := mcp.NewResponse("intent-resolver", "orchestrator", "resolve_intent", map[string]interface{}{
			"inferred_intent": r.InferredIntent,
			"train_mode":      r.TrainMode,
			"confidence":      r.Confidence,
		})
		h.mcpStore.AppendMCPPair(sessionID, 0, reqMsg, respMsg, "")
		_, _ = h.mcpStore.AppendSessionEvent(sessionID, mcp.SessionEvent{
			Kind:  mcp.SessionEventSystem,
			Phase: &ph0,
			Text: fmt.Sprintf("状态：任务理解完成 · 推断意图=%s 训练模式=%s 置信度=%s",
				r.InferredIntent, r.TrainMode, r.Confidence),
		})
	}
	c.JSON(http.StatusOK, gin.H{"result": r})
}

func truncateRunes(s string, max int) string {
	s = strings.TrimSpace(s)
	if max <= 0 || s == "" {
		return s
	}
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max]) + "…"
}

func agentCfgPtr(store *config.AgentStore) *config.AgentConfig {
	if store == nil {
		return nil
	}
	c := store.Snapshot()
	return &c
}
