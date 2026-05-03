package services

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

const dashscopeChatCompletionsPath = "/chat/completions"

type AgentExplainer struct {
	apiKey  string
	baseURL string
	model   string
	client  *http.Client
}

type agentExplainRequest struct {
	Model          string            `json:"model"`
	Messages       []agentExplainMsg `json:"messages"`
	Temperature    float64           `json:"temperature"`
	ResponseFormat *agentResponseFmt `json:"response_format,omitempty"`
}

type agentExplainMsg struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type agentResponseFmt struct {
	Type string `json:"type"`
}

type agentExplainResponse struct {
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

func NewAgentExplainerFromEnv() *AgentExplainer {
	baseURL := strings.TrimRight(strings.TrimSpace(os.Getenv("ALIYUN_DASHSCOPE_BASE_URL")), "/")
	if baseURL == "" {
		baseURL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
	}
	model := strings.TrimSpace(os.Getenv("ALIYUN_INTENT_MODEL"))
	if model == "" {
		model = "qwen-turbo"
	}

	return &AgentExplainer{
		apiKey:  strings.TrimSpace(os.Getenv("ALIYUN_DASHSCOPE_API_KEY")),
		baseURL: baseURL,
		model:   model,
		client:  &http.Client{Timeout: 45 * time.Second},
	}
}

func (e *AgentExplainer) Enabled() bool {
	return e != nil && strings.TrimSpace(e.apiKey) != ""
}

func (e *AgentExplainer) ExplainDataReport(input map[string]interface{}) (map[string]interface{}, error) {
	system := `你是训练系统中的 Data Agent 解释器。请基于输入的结构化数据分析结果，输出严格 JSON：
{
  "task_type": "text_classification|named_entity_recognition|summarization|text_generation|sentiment_analysis|other",
  "confidence": 0-1,
  "trainability": "high|medium|low",
  "reliability": "high|medium|low",
  "summary": "一句中文总结",
  "issues": ["问题1", "问题2"],
  "recommendations": ["建议1", "建议2", "建议3"]
}
规则：
1) 只基于输入字段，不编造外部数据。
2) summary 与 recommendations 用中文。
3) 若不确定，降低 confidence 并写明问题。`
	return e.explainJSON(system, input)
}

func (e *AgentExplainer) ExplainEvaluation(input map[string]interface{}) (map[string]interface{}, error) {
	system := `你是训练系统中的 Evaluation Agent。请基于指标和训练信号输出严格 JSON：
{
  "effect": "good|fair|poor",
  "summary": "当前效果简述（中文）",
  "possible_issues": ["问题1", "问题2"],
  "recommendations": ["建议1", "建议2", "建议3"]
}
要求：
1) 不要自动调参，不要承诺自动修复。
2) 建议要可执行且简洁。
3) 若指标缺失，要明确指出数据不足。`
	return e.explainJSON(system, input)
}

func (e *AgentExplainer) explainJSON(system string, payload map[string]interface{}) (map[string]interface{}, error) {
	if !e.Enabled() {
		return nil, fmt.Errorf("explainer disabled: missing ALIYUN_DASHSCOPE_API_KEY")
	}

	rawPayload, _ := json.Marshal(payload)
	reqBody := agentExplainRequest{
		Model:       e.model,
		Temperature: 0.1,
		Messages: []agentExplainMsg{
			{Role: "system", Content: system},
			{Role: "user", Content: "输入:\n" + string(rawPayload)},
		},
		ResponseFormat: &agentResponseFmt{Type: "json_object"},
	}

	bodyBytes, err := json.Marshal(reqBody)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequest(http.MethodPost, e.baseURL+dashscopeChatCompletionsPath, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+e.apiKey)

	resp, err := e.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("dashscope http %d: %s", resp.StatusCode, string(respBytes))
	}

	var out agentExplainResponse
	if err := json.Unmarshal(respBytes, &out); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	if out.Error != nil && strings.TrimSpace(out.Error.Message) != "" {
		return nil, fmt.Errorf("dashscope api: %s (%s)", out.Error.Message, out.Error.Code)
	}
	if len(out.Choices) == 0 {
		return nil, fmt.Errorf("empty choices")
	}

	content := strings.TrimSpace(out.Choices[0].Message.Content)
	content = stripAgentJSONFences(content)

	parsed := make(map[string]interface{})
	if err := json.Unmarshal([]byte(content), &parsed); err != nil {
		return nil, fmt.Errorf("parse model json: %w; raw=%s", err, truncateForLog(content, 300))
	}

	return parsed, nil
}

func stripAgentJSONFences(s string) string {
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
