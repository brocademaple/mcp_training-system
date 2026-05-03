package services

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// TestQwenDashScopeConnection 调用 DashScope OpenAI 兼容 /chat/completions 做连通性探测。
// 使用极短输入与 max_tokens=1，尽量降低输出侧 token 消耗（主要校验鉴权与路由是否可用）。
func TestQwenDashScopeConnection(apiKey, baseURL, model string) (httpStatus int, detail string, err error) {
	key := strings.TrimSpace(apiKey)
	if key == "" {
		return 0, "", fmt.Errorf("api_key 为空")
	}
	base := strings.TrimSuffix(strings.TrimSpace(baseURL), "/")
	if base == "" {
		base = "https://dashscope.aliyuncs.com/compatible-mode/v1"
	}
	url := base + "/chat/completions"
	m := strings.TrimSpace(model)
	if m == "" {
		m = "qwen-turbo"
	}

	body := map[string]interface{}{
		"model": m,
		"messages": []map[string]string{
			{"role": "user", "content": "."},
		},
		"max_tokens":  1,
		"temperature": 0,
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return 0, "", err
	}

	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(raw))
	if err != nil {
		return 0, "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+key)

	client := &http.Client{Timeout: 25 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return 0, "", err
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return resp.StatusCode, "", err
	}
	snippet := string(respBody)
	if len(snippet) > 500 {
		snippet = snippet[:500] + "…"
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return resp.StatusCode, snippet, fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	var out struct {
		Error *struct {
			Message string `json:"message"`
			Code    string `json:"code"`
		} `json:"error"`
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(respBody, &out); err != nil {
		return resp.StatusCode, snippet, fmt.Errorf("解析响应: %w", err)
	}
	if out.Error != nil && out.Error.Message != "" {
		return resp.StatusCode, snippet, fmt.Errorf("%s (%s)", out.Error.Message, out.Error.Code)
	}
	if len(out.Choices) == 0 {
		return resp.StatusCode, snippet, fmt.Errorf("无 choices 返回")
	}
	return resp.StatusCode, strings.TrimSpace(out.Choices[0].Message.Content), nil
}
