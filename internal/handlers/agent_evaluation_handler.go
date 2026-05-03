package handlers

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"
	"mcp-training-system/internal/mcp"
	"mcp-training-system/internal/models"
	"mcp-training-system/internal/services"
)

// GetEvaluationAdvice returns Evaluation Agent explanation + optimization suggestions.
// GET /agent/evaluations/:id/advice
func (h *EvaluationHandler) GetEvaluationAdvice(c *gin.Context) {
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

	sessionID := extractSessionID(c, "")
	ph3 := 3
	if sessionID != "" && h.mcpStore != nil {
		_, _ = h.mcpStore.AppendSessionEvent(sessionID, mcp.SessionEvent{
			Kind:  mcp.SessionEventSystem,
			Phase: &ph3,
			Text:  fmt.Sprintf("状态：结果分析阶段 · 请求 Evaluation Agent 解释（eval_id=%d）", evalID),
		})
		exReq := mcp.NewRequest("orchestrator", "evaluation-agent", "explain_evaluation", map[string]interface{}{
			"evaluation_id": float64(evalID),
			"model_id":      float64(eval.ModelID),
		})
		_, _ = h.mcpStore.AppendSessionEvent(sessionID, mcp.SessionEvent{
			Kind:  mcp.SessionEventMCP,
			Phase: &ph3,
			MCP:   mcp.MCPWireFromMessage(exReq),
		})
	}

	input := h.buildEvaluationAdviceInput(eval)
	advice := buildRuleEvaluationAdvice(input)
	advice["evaluation_id"] = evalID
	advice["explanation_source"] = "rule"

	explainer := services.NewAgentExplainerFromEnv()
	if explainer != nil && explainer.Enabled() {
		if llmOut, llmErr := explainer.ExplainEvaluation(input); llmErr == nil {
			mergeEvaluationAdviceWithLLM(advice, llmOut)
			advice["explanation_source"] = "llm+rule"
		} else {
			advice["llm_error"] = llmErr.Error()
		}
	}

	if raw, mErr := json.Marshal(advice); mErr == nil {
		_ = models.UpdateEvaluationAgentAdvice(h.db, evalID, raw)
	}

	if sessionID != "" && h.mcpStore != nil {
		ph3b := 3
		exResp := mcp.NewResponse("evaluation-agent", "orchestrator", "explain_evaluation", map[string]interface{}{
			"evaluation_id":       float64(evalID),
			"effect":              advice["effect"],
			"explanation_source":  advice["explanation_source"],
			"summary_len":         len(asString(advice["summary"])),
		})
		_, _ = h.mcpStore.AppendSessionEvent(sessionID, mcp.SessionEvent{
			Kind:  mcp.SessionEventMCP,
			Phase: &ph3b,
			MCP:   mcp.MCPWireFromMessage(exResp),
		})
		_, _ = h.mcpStore.AppendSessionEvent(sessionID, mcp.SessionEvent{
			Kind:  mcp.SessionEventSystem,
			Phase: &ph3b,
			Text:  "状态：结果分析完成 · Evaluation Agent 建议已写入评估记录",
		})
	}

	c.JSON(200, gin.H{"code": 200, "message": "success", "data": advice})
}

func (h *EvaluationHandler) buildEvaluationAdviceInput(eval *models.Evaluation) map[string]interface{} {
	input := map[string]interface{}{
		"evaluation": map[string]interface{}{
			"id":        eval.ID,
			"model_id":  eval.ModelID,
			"status":    eval.Status,
			"accuracy":  eval.Accuracy,
			"precision": eval.Precision,
			"recall":    eval.Recall,
			"f1_score":  eval.F1Score,
			"metrics":   eval.Metrics,
		},
	}

	model, err := models.GetModelByID(h.db, eval.ModelID)
	if err != nil || model == nil {
		return input
	}

	logs, _ := models.GetTrainingLogsByJobID(h.db, model.JobID)
	firstLoss, lastLoss, bestAcc := lossAndAccSummary(logs)

	datasetRows := 0
	job, jErr := models.GetTrainingJobByID(h.db, model.JobID)
	if jErr == nil && job != nil && job.DatasetID != nil {
		_ = h.db.QueryRow("SELECT COALESCE(row_count, 0) FROM datasets WHERE id = $1", *job.DatasetID).Scan(&datasetRows)
	}

	input["training_signals"] = map[string]interface{}{
		"job_id":         model.JobID,
		"log_count":      len(logs),
		"first_loss":     firstLoss,
		"last_loss":      lastLoss,
		"best_train_acc": bestAcc,
		"dataset_rows":   datasetRows,
	}
	return input
}

func buildRuleEvaluationAdvice(input map[string]interface{}) map[string]interface{} {
	eval := asMap(input["evaluation"])
	signals := asMap(input["training_signals"])

	accuracy := asFloat(eval["accuracy"])
	precision := asFloat(eval["precision"])
	recall := asFloat(eval["recall"])
	f1 := asFloat(eval["f1_score"])
	rocAUC := asFloat(asMap(eval["metrics"])["roc_auc"])
	datasetRows := asInt(signals["dataset_rows"])
	firstLoss := asFloat(signals["first_loss"])
	lastLoss := asFloat(signals["last_loss"])

	effect := "fair"
	if f1 >= 0.80 && accuracy >= 0.85 {
		effect = "good"
	} else if f1 < 0.60 || accuracy < 0.65 {
		effect = "poor"
	}

	issues := make([]string, 0, 6)
	recs := make([]string, 0, 6)

	if f1 < 0.60 || accuracy < 0.65 {
		issues = append(issues, "当前指标偏低，模型泛化能力不足")
		recs = append(recs, "优先回查数据清洗与标签质量，避免脏数据直接进入训练。")
	}
	if precision > 0 && recall > 0 && absFloat(precision-recall) > 0.15 {
		issues = append(issues, "Precision/Recall 差距较大，可能存在类别不平衡")
		recs = append(recs, "尝试类别加权或重采样，重点提升弱势类别召回。")
	}
	if datasetRows > 0 && datasetRows < 200 {
		issues = append(issues, "训练数据规模偏小")
		recs = append(recs, "补充数据量并保持训练/评估分布一致，再进行对比实验。")
	}
	if firstLoss > 0 && lastLoss > 0 && lastLoss > firstLoss*1.05 {
		issues = append(issues, "训练后期 loss 未下降，可能训练不稳定")
		recs = append(recs, "先降低学习率或减少训练轮数，观察 loss 曲线再决定下一轮策略。")
	}
	if rocAUC > 0 && rocAUC < 0.65 {
		issues = append(issues, "ROC-AUC 偏低，类别区分能力不足")
		recs = append(recs, "检查特征表达与标签定义，必要时细化标签体系。")
	}

	if len(issues) == 0 {
		issues = append(issues, "当前未发现明显结构性问题")
		recs = append(recs, "保持当前配置，建议做一次小幅参数扫查验证稳定性。")
	}
	recs = dedupLimit(recs, 3)

	summary := "模型效果中等，建议继续做数据与训练配置微调。"
	switch effect {
	case "good":
		summary = "模型效果较好，可进入小流量验证阶段。"
	case "poor":
		summary = "模型效果一般偏低，建议优先处理数据与任务定义问题。"
	}

	return map[string]interface{}{
		"effect":          effect,
		"summary":         summary,
		"possible_issues": issues,
		"recommendations": recs,
		"signals": map[string]interface{}{
			"accuracy":     accuracy,
			"precision":    precision,
			"recall":       recall,
			"f1_score":     f1,
			"roc_auc":      rocAUC,
			"dataset_rows": datasetRows,
			"first_loss":   firstLoss,
			"last_loss":    lastLoss,
		},
	}
}

func mergeEvaluationAdviceWithLLM(base map[string]interface{}, llm map[string]interface{}) {
	if v := strings.TrimSpace(asString(llm["effect"])); v != "" {
		base["effect"] = strings.ToLower(v)
	}
	if v := strings.TrimSpace(asString(llm["summary"])); v != "" {
		base["summary"] = v
	}
	if v := toStringSlice(llm["possible_issues"]); len(v) > 0 {
		base["possible_issues"] = v
	}
	if v := toStringSlice(llm["recommendations"]); len(v) > 0 {
		base["recommendations"] = dedupLimit(v, 4)
	}
}

func lossAndAccSummary(logs []*models.TrainingLog) (firstLoss float64, lastLoss float64, bestAcc float64) {
	if len(logs) == 0 {
		return 0, 0, 0
	}
	firstLoss = logs[0].Loss
	lastLoss = logs[len(logs)-1].Loss
	bestAcc = 0
	for _, l := range logs {
		if l.Accuracy > bestAcc {
			bestAcc = l.Accuracy
		}
	}
	return
}

func asMap(v interface{}) map[string]interface{} {
	out := map[string]interface{}{}
	switch m := v.(type) {
	case map[string]interface{}:
		for k, vv := range m {
			out[k] = vv
		}
	}
	return out
}

func asString(v interface{}) string {
	if s, ok := v.(string); ok {
		return s
	}
	return fmt.Sprintf("%v", v)
}

func asFloat(v interface{}) float64 {
	switch x := v.(type) {
	case float64:
		return x
	case float32:
		return float64(x)
	case int:
		return float64(x)
	case int64:
		return float64(x)
	case string:
		var parsed float64
		if _, err := fmt.Sscanf(strings.TrimSpace(x), "%f", &parsed); err == nil {
			return parsed
		}
	}
	return 0
}

func asInt(v interface{}) int {
	switch x := v.(type) {
	case int:
		return x
	case int64:
		return int(x)
	case float64:
		return int(x)
	case float32:
		return int(x)
	case string:
		var parsed int
		if _, err := fmt.Sscanf(strings.TrimSpace(x), "%d", &parsed); err == nil {
			return parsed
		}
	}
	return 0
}

func toStringSlice(v interface{}) []string {
	out := []string{}
	switch xs := v.(type) {
	case []string:
		for _, item := range xs {
			s := strings.TrimSpace(item)
			if s != "" {
				out = append(out, s)
			}
		}
	case []interface{}:
		for _, item := range xs {
			s := strings.TrimSpace(asString(item))
			if s != "" {
				out = append(out, s)
			}
		}
	}
	return out
}

func dedupLimit(in []string, max int) []string {
	if max <= 0 {
		return []string{}
	}
	seen := map[string]struct{}{}
	out := make([]string, 0, max)
	for _, item := range in {
		s := strings.TrimSpace(item)
		if s == "" {
			continue
		}
		k := strings.ToLower(s)
		if _, ok := seen[k]; ok {
			continue
		}
		seen[k] = struct{}{}
		out = append(out, s)
		if len(out) >= max {
			break
		}
	}
	return out
}

func absFloat(v float64) float64 {
	if v < 0 {
		return -v
	}
	return v
}
