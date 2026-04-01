package services

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"mcp-training-system/internal/config"
	"mcp-training-system/internal/utils"
)

const dashScopeChatPath = "/chat/completions"

// 与 intent_registry、前端 Agent 画布、Planner 共用的 intent id
var allowedIntents = []string{
	"sentiment", "topic", "binary", "multiclass", "intent", "ner",
	"summary", "extraction", "rewriting", "matching", "infilling", "alignment", "other",
}

var allowedDomains = []string{
	"General", "Finance", "Medical", "Education", "Legal", "Code", "Research", "ECommerce",
}

// ResolveIntentUnified 按配置选择规则引擎或阿里云通义（DashScope OpenAI 兼容模式）。
func ResolveIntentUnified(goal string, cfg *config.AgentConfig) ResolveResult {
	g := strings.TrimSpace(goal)
	if cfg == nil {
		return ResolveIntentFromGoal(g)
	}
	p := strings.ToLower(strings.TrimSpace(cfg.IntentResolverProvider))
	switch p {
	case "", "rules":
		return ResolveIntentFromGoal(g)
	case "aliyun":
		if strings.TrimSpace(cfg.AliyunDashScopeAPIKey) == "" {
			utils.Info("INTENT_RESOLVER_PROVIDER=aliyun but ALIYUN_DASHSCOPE_API_KEY empty; fallback to rules")
			return ResolveIntentFromGoal(g)
		}
		r, err := resolveIntentDashScope(g, cfg)
		if err != nil {
			utils.Error("DashScope intent resolve failed: %v", err)
			return ResolveIntentFromGoal(g)
		}
		return r
	case "hybrid":
		if strings.TrimSpace(cfg.AliyunDashScopeAPIKey) == "" {
			return ResolveIntentFromGoal(g)
		}
		r, err := resolveIntentDashScope(g, cfg)
		if err != nil {
			utils.Info("DashScope intent resolve failed, fallback rules: %v", err)
			return ResolveIntentFromGoal(g)
		}
		return r
	default:
		utils.Info("unknown INTENT_RESOLVER_PROVIDER=%q, using rules", cfg.IntentResolverProvider)
		return ResolveIntentFromGoal(g)
	}
}

type dashScopeChatRequest struct {
	Model          string              `json:"model"`
	Messages       []dashScopeMsg      `json:"messages"`
	Temperature    float64             `json:"temperature"`
	ResponseFormat *dashScopeRespFmt   `json:"response_format,omitempty"`
}

type dashScopeMsg struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type dashScopeRespFmt struct {
	Type string `json:"type"`
}

type dashScopeChatResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
		Code    string `json:"code"`
	} `json:"error"`
}

type llmIntentPayload struct {
	InferredIntent string   `json:"inferred_intent"`
	TrainMode      string   `json:"train_mode"`
	DomainHint     string   `json:"domain_hint"`
	Confidence     string   `json:"confidence"`
	MatchedTerms   []string `json:"matched_terms"`
	Message        string   `json:"message"`
}

func resolveIntentDashScope(goal string, cfg *config.AgentConfig) (ResolveResult, error) {
	if strings.TrimSpace(goal) == "" {
		return ResolveResult{}, fmt.Errorf("empty goal")
	}
	base := strings.TrimSuffix(strings.TrimSpace(cfg.AliyunDashScopeBaseURL), "/")
	url := base + dashScopeChatPath
	system := dashScopeSystemPrompt()

	body := dashScopeChatRequest{
		Model:       strings.TrimSpace(cfg.AliyunIntentModel),
		Temperature: 0.1,
		Messages: []dashScopeMsg{
			{Role: "system", Content: system},
			{Role: "user", Content: "用户训练目标描述：\n" + goal},
		},
		ResponseFormat: &dashScopeRespFmt{Type: "json_object"},
	}
	if body.Model == "" {
		body.Model = "qwen-turbo"
	}

	raw, err := json.Marshal(body)
	if err != nil {
		return ResolveResult{}, err
	}

	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(raw))
	if err != nil {
		return ResolveResult{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(cfg.AliyunDashScopeAPIKey))

	client := &http.Client{Timeout: 45 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return ResolveResult{}, err
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return ResolveResult{}, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return ResolveResult{}, fmt.Errorf("dashscope http %d: %s", resp.StatusCode, string(respBody))
	}

	var out dashScopeChatResponse
	if err := json.Unmarshal(respBody, &out); err != nil {
		return ResolveResult{}, fmt.Errorf("decode response: %w", err)
	}
	if out.Error != nil && out.Error.Message != "" {
		return ResolveResult{}, fmt.Errorf("dashscope api: %s (%s)", out.Error.Message, out.Error.Code)
	}
	if len(out.Choices) == 0 || strings.TrimSpace(out.Choices[0].Message.Content) == "" {
		return ResolveResult{}, fmt.Errorf("empty choices from dashscope")
	}

	content := strings.TrimSpace(out.Choices[0].Message.Content)
	content = stripJSONFences(content)

	var payload llmIntentPayload
	if err := json.Unmarshal([]byte(content), &payload); err != nil {
		return ResolveResult{}, fmt.Errorf("parse model json: %w; raw=%s", err, truncateForLog(content, 400))
	}

	return normalizeLLMIntent(payload, goal), nil
}

func dashScopeSystemPrompt() string {
	return `你是「MCP Training System」里的训练意图解析模块。该系统通过 Agent 编排数据清洗、模型训练与评估流水线；用户会用自然语言描述想训练的模型与场景。

你的任务：根据用户描述，输出**严格 JSON 对象**（不要 markdown、不要代码块），字段如下：
- inferred_intent: 字符串，必须是下列之一：
  sentiment, topic, binary, multiclass, intent, ner, summary, extraction, rewriting, matching, infilling, alignment, other
- train_mode: 字符串，仅 classic_clf 或 sft_lora
  · classic_clf：文本分类、主题/二分类/多分类、对话意图分类、NER/序列标注等判别式任务（BERT 分类头或 token 分类路线）
  · sft_lora：摘要/生成/改写、结构化信息抽取为文本或 JSON、偏好对齐（DPO/RLHF）、填空推理、复杂指令遵循等生成式或 SFT 路线
- domain_hint: 字符串，必须是下列之一（英文，首字母大写风格）：
  General, Finance, Medical, Education, Legal, Code, Research, ECommerce
- confidence: 字符串，high / medium / low
- matched_terms: 字符串数组，从用户原文中提取的关键短语（可含中文，3～8 个为宜）
- message: 字符串，一句中文，向用户说明你的推断与建议（适合直接展示在 Web UI）

推断原则（结合本系统）：
1) 外卖/电商评论、商品评价常与 ECommerce；金融/医疗/教育/法律/代码/论文场景对应各自 domain。
2) 用户提到「小模型」「轻量」「部署」不改变 intent，可在 message 中提示仍可选 classic_clf 或量化部署。
3) 「实体识别」「NER」「人名地名」→ ner；「情感」「正负向」→ sentiment；「DPO」「偏好对齐」→ alignment + sft_lora。
4) 不确定时 inferred_intent 用 other 或最接近的类，confidence 用 low，message 建议用户补充数据列或任务形式。`
}

func normalizeLLMIntent(p llmIntentPayload, goal string) ResolveResult {
	_ = goal
	intent := strings.TrimSpace(p.InferredIntent)
	if !isAllowedIntent(intent) {
		intent = "other"
	}
	spec := getTaskSpecByIntent(intent)
	tm := strings.TrimSpace(p.TrainMode)
	if tm != "sft_lora" && tm != "classic_clf" {
		tm = spec.DefaultTrainMode
	}
	if tm != "sft_lora" && tm != "classic_clf" {
		tm = "classic_clf"
	}
	// 与 Planner / 脚本路由一致：对齐、摘要、抽取等不宜落在纯分类头路径
	if intent == "alignment" || intent == "summary" || intent == "extraction" {
		if tm == "classic_clf" {
			tm = "sft_lora"
		}
	}

	domain := normalizeDomainHint(p.DomainHint)

	conf := strings.ToLower(strings.TrimSpace(p.Confidence))
	if conf != "high" && conf != "medium" && conf != "low" {
		conf = "medium"
	}

	terms := make([]string, 0, len(p.MatchedTerms))
	seen := map[string]struct{}{}
	for _, t := range p.MatchedTerms {
		t = strings.TrimSpace(t)
		if t == "" {
			continue
		}
		key := strings.ToLower(t)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		terms = append(terms, t)
	}

	msg := strings.TrimSpace(p.Message)
	if msg == "" {
		msg = fmt.Sprintf("已解析为「%s」任务，领域「%s」，建议训练范式「%s」。", labelIntent(intent), domain, trainModeLabel(tm))
	}

	return ResolveResult{
		InferredIntent:    intent,
		TrainMode:         tm,
		DomainHint:        domain,
		Confidence:        conf,
		MatchedTerms:      terms,
		MatchedPatternIDs: []string{"dashscope"},
		Message:           msg,
	}
}

func isAllowedIntent(s string) bool {
	for _, a := range allowedIntents {
		if s == a {
			return true
		}
	}
	return false
}

func normalizeDomainHint(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return "General"
	}
	low := strings.ToLower(s)
	aliases := map[string]string{
		"general": "General", "finance": "Finance", "medical": "Medical",
		"education": "Education", "legal": "Legal", "code": "Code",
		"research": "Research", "ecommerce": "ECommerce", "e-commerce": "ECommerce",
		"电商": "ECommerce", "通用": "General",
	}
	if canon, ok := aliases[low]; ok {
		return canon
	}
	for _, a := range allowedDomains {
		if strings.EqualFold(s, a) {
			return a
		}
	}
	return "General"
}

func stripJSONFences(s string) string {
	s = strings.TrimSpace(s)
	if strings.HasPrefix(s, "```") {
		s = strings.TrimPrefix(s, "```")
		s = strings.TrimPrefix(s, "json")
		s = strings.TrimSpace(s)
		if i := strings.LastIndex(s, "```"); i >= 0 {
			s = strings.TrimSpace(s[:i])
		}
	}
	return strings.TrimSpace(s)
}

func truncateForLog(s string, max int) string {
	runes := []rune(s)
	if len(runes) <= max {
		return s
	}
	return string(runes[:max]) + "…"
}
