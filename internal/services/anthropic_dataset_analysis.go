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

const anthropicDatasetSystemPrompt = `You are a machine learning data analyst. Analyze the provided CSV data sample and return a JSON object only, no explanation. The JSON must have these fields:
{
  "domain": "one of: general, finance, medical, legal, ecommerce, other",
  "task_type": "one of: text_classification, text_generation, named_entity_recognition, summarization, sentiment_analysis, other",
  "input_form": "one of: text, multimodal",
  "label_column": "column name that contains labels, or null if not found",
  "text_column": "column name that contains input text",
  "num_classes": number of unique values in label column if classification, else null,
  "confidence": 0.0 to 1.0,
  "reasoning": "one sentence in Chinese explaining why you made this judgment"
}`

// DatasetAIAnalysis is the normalized analysis payload returned to frontend and saved in DB.
type DatasetAIAnalysis struct {
	Domain      string  `json:"domain"`
	TaskType    string  `json:"task_type"`
	InputForm   string  `json:"input_form"`
	LabelColumn *string `json:"label_column"`
	TextColumn  string  `json:"text_column"`
	NumClasses  *int    `json:"num_classes"`
	Confidence  float64 `json:"confidence"`
	Reasoning   string  `json:"reasoning"`
}

type anthropicMessageRequest struct {
	Model       string  `json:"model"`
	MaxTokens   int     `json:"max_tokens"`
	System      string  `json:"system"`
	Temperature float64 `json:"temperature"`
	Messages    []struct {
		Role    string `json:"role"`
		Content string `json:"content"`
	} `json:"messages"`
}

type anthropicMessageResponse struct {
	Content []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} `json:"content"`
	Error *struct {
		Type    string `json:"type"`
		Message string `json:"message"`
	} `json:"error"`
}

// AnthropicDatasetAnalyzer calls Anthropic Messages API for dataset analysis.
type AnthropicDatasetAnalyzer struct {
	apiKey string
	model  string
	url    string
	client *http.Client
}

func NewAnthropicDatasetAnalyzer() *AnthropicDatasetAnalyzer {
	model := strings.TrimSpace(os.Getenv("ANTHROPIC_MODEL"))
	if model == "" {
		model = "claude-3-5-sonnet-latest"
	}
	return &AnthropicDatasetAnalyzer{
		apiKey: strings.TrimSpace(os.Getenv("ANTHROPIC_API_KEY")),
		model:  model,
		url:    "https://api.anthropic.com/v1/messages",
		client: &http.Client{Timeout: 45 * time.Second},
	}
}

func (a *AnthropicDatasetAnalyzer) Enabled() bool {
	return strings.TrimSpace(a.apiKey) != ""
}

func (a *AnthropicDatasetAnalyzer) AnalyzeCSVSample(headers []string, rows []map[string]string) (*DatasetAIAnalysis, error) {
	if !a.Enabled() {
		return nil, fmt.Errorf("ANTHROPIC_API_KEY is empty")
	}

	payload := map[string]interface{}{
		"headers": headers,
		"rows":    rows,
	}
	payloadBytes, _ := json.Marshal(payload)
	userPrompt := fmt.Sprintf("Analyze this CSV sample:\n%s", string(payloadBytes))

	reqBody := anthropicMessageRequest{
		Model:       a.model,
		MaxTokens:   512,
		System:      anthropicDatasetSystemPrompt,
		Temperature: 0,
		Messages: []struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		}{
			{Role: "user", Content: userPrompt},
		},
	}
	raw, err := json.Marshal(reqBody)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequest(http.MethodPost, a.url, bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", a.apiKey)
	req.Header.Set("anthropic-version", "2023-06-01")

	resp, err := a.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("anthropic http %d: %s", resp.StatusCode, string(respBytes))
	}

	var parsed anthropicMessageResponse
	if err := json.Unmarshal(respBytes, &parsed); err != nil {
		return nil, fmt.Errorf("decode anthropic response: %w", err)
	}
	if parsed.Error != nil && parsed.Error.Message != "" {
		return nil, fmt.Errorf("anthropic api: %s", parsed.Error.Message)
	}

	text := extractAnthropicText(parsed.Content)
	if text == "" {
		return nil, fmt.Errorf("empty anthropic response content")
	}
	jsonText := normalizeJSONText(text)

	var result DatasetAIAnalysis
	if err := json.Unmarshal([]byte(jsonText), &result); err != nil {
		return nil, fmt.Errorf("parse analysis json failed: %w; raw=%s", err, truncateText(jsonText, 500))
	}

	normalizeDatasetAnalysis(&result)
	return &result, nil
}

func extractAnthropicText(blocks []struct {
	Type string `json:"type"`
	Text string `json:"text"`
}) string {
	for _, b := range blocks {
		if strings.TrimSpace(b.Text) != "" {
			return strings.TrimSpace(b.Text)
		}
	}
	return ""
}

func normalizeJSONText(content string) string {
	s := strings.TrimSpace(content)
	if strings.HasPrefix(s, "```") {
		s = strings.TrimPrefix(s, "```")
		s = strings.TrimPrefix(s, "json")
		s = strings.TrimSpace(s)
		if idx := strings.LastIndex(s, "```"); idx >= 0 {
			s = strings.TrimSpace(s[:idx])
		}
	}

	start := strings.Index(s, "{")
	end := strings.LastIndex(s, "}")
	if start >= 0 && end > start {
		return strings.TrimSpace(s[start : end+1])
	}
	return s
}

func truncateText(s string, max int) string {
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max]) + "..."
}

func normalizeDatasetAnalysis(a *DatasetAIAnalysis) {
	a.Domain = oneOf(strings.ToLower(strings.TrimSpace(a.Domain)), "general", []string{
		"general", "finance", "medical", "legal", "ecommerce", "other",
	})
	a.TaskType = oneOf(strings.ToLower(strings.TrimSpace(a.TaskType)), "other", []string{
		"text_classification", "text_generation", "named_entity_recognition", "summarization", "sentiment_analysis", "other",
	})
	a.InputForm = oneOf(strings.ToLower(strings.TrimSpace(a.InputForm)), "text", []string{"text", "multimodal"})
	a.TextColumn = strings.TrimSpace(a.TextColumn)
	if a.TextColumn == "" {
		a.TextColumn = "text"
	}
	if a.LabelColumn != nil {
		v := strings.TrimSpace(*a.LabelColumn)
		if v == "" || strings.EqualFold(v, "null") {
			a.LabelColumn = nil
		} else {
			a.LabelColumn = &v
		}
	}
	if a.NumClasses != nil && *a.NumClasses < 0 {
		a.NumClasses = nil
	}
	if a.Confidence < 0 {
		a.Confidence = 0
	}
	if a.Confidence > 1 {
		a.Confidence = 1
	}
	a.Reasoning = strings.TrimSpace(a.Reasoning)
	if a.Reasoning == "" {
		a.Reasoning = "根据字段命名和样本值分布做出的初步判断。"
	}
}

func oneOf(v string, fallback string, allowed []string) string {
	for _, item := range allowed {
		if item == v {
			return v
		}
	}
	return fallback
}
