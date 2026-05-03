package handlers

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"mcp-training-system/internal/config"
	"mcp-training-system/internal/services"
	"mcp-training-system/internal/utils"
)

// SettingsHandler LLM / Agent 相关运行时设置（落盘 + 热更新 AgentStore）。
type SettingsHandler struct {
	store   *config.AgentStore
	path    string
	envBase config.AgentConfig
}

func NewSettingsHandler(store *config.AgentStore, path string, envBase config.AgentConfig) *SettingsHandler {
	return &SettingsHandler{store: store, path: path, envBase: envBase}
}

func (h *SettingsHandler) reloadStoreFromDisk() error {
	f, err := config.LoadLLMSettingsFile(h.path)
	if err != nil {
		return err
	}
	merged := config.MergeEnvAgentWithLLMFile(h.envBase, f)
	h.store.Replace(merged)
	return nil
}

// GetLLMSettings GET /settings/llm
func (h *SettingsHandler) GetLLMSettings(c *gin.Context) {
	f, err := config.LoadLLMSettingsFile(h.path)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": err.Error()})
		return
	}
	effective := config.MergeEnvAgentWithLLMFile(h.envBase, f)

	outProviders := make(map[string]gin.H)
	for id, ent := range f.Providers {
		keySrc := strings.TrimSpace(ent.APIKey)
		masked := ""
		configured := keySrc != ""
		if configured {
			masked = config.MaskAPIKey(keySrc)
		}
		if id == "aliyun_qwen" && !configured && strings.TrimSpace(effective.AliyunDashScopeAPIKey) != "" {
			configured = true
			masked = config.MaskAPIKey(effective.AliyunDashScopeAPIKey)
		}
		outProviders[id] = gin.H{
			"base_url":           ent.BaseURL,
			"model":              ent.Model,
			"api_key_masked":     masked,
			"api_key_configured": configured,
			"extra":              ent.Extra,
		}
	}

	intent := strings.TrimSpace(f.IntentResolverProvider)
	if intent == "" {
		intent = strings.TrimSpace(h.envBase.IntentResolverProvider)
	}
	if intent == "" {
		intent = "rules"
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    200,
		"message": "success",
		"data": gin.H{
			"settings_path":                   h.path,
			"intent_resolver_provider":        intent,
			"effective_intent_resolver":       strings.TrimSpace(effective.IntentResolverProvider),
			"effective_aliyun_base_url":       effective.AliyunDashScopeBaseURL,
			"effective_aliyun_intent_model":   effective.AliyunIntentModel,
			"effective_aliyun_api_configured": strings.TrimSpace(effective.AliyunDashScopeAPIKey) != "",
			"providers":                       outProviders,
			"ui": gin.H{
				"aliyun_qwen": gin.H{
					"base_url_options": config.QwenDashScopeBaseURLOptions,
					"model_options":    config.QwenDashScopeModelOptions,
					"doc_url":          "https://help.aliyun.com/zh/model-studio/developer-reference/use-qwen-by-calling-api",
				},
			},
		},
	})
}

type testQwenDashScopeBody struct {
	APIKey  string `json:"api_key"`
	BaseURL string `json:"base_url"`
	Model   string `json:"model"`
}

type testProviderBody struct {
	Provider string `json:"provider"`
	APIKey   string `json:"api_key"`
	BaseURL  string `json:"base_url"`
	Model    string `json:"model"`
}

// PostTestQwenDashScope POST /agent/llm-settings/test-qwen — 使用请求体或已保存 Key 探测 DashScope 连通性。
func (h *SettingsHandler) PostTestQwenDashScope(c *gin.Context) {
	var body testQwenDashScopeBody
	_ = c.ShouldBindJSON(&body)

	key := strings.TrimSpace(body.APIKey)
	snap := h.store.Snapshot()
	if key == "" {
		key = strings.TrimSpace(snap.AliyunDashScopeAPIKey)
	}
	if key == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "请填写 API Key，或先保存通义配置"})
		return
	}

	base := strings.TrimSpace(body.BaseURL)
	model := strings.TrimSpace(body.Model)
	if base == "" {
		base = strings.TrimSpace(snap.AliyunDashScopeBaseURL)
	}
	if model == "" {
		model = strings.TrimSpace(snap.AliyunIntentModel)
	}
	st, reply, err := services.TestQwenDashScopeConnection(key, base, model)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"code":    502,
			"message": err.Error(),
			"data": gin.H{
				"http_status": st,
				"detail":      reply,
			},
		})
		return
	}
	_ = reply // 成功时不向前端回传模型回复，避免冗长展示与泄露内容
	usedBase := strings.TrimSuffix(strings.TrimSpace(base), "/")
	if usedBase == "" {
		usedBase = "https://dashscope.aliyuncs.com/compatible-mode/v1"
	}
	usedModel := strings.TrimSpace(model)
	if usedModel == "" {
		usedModel = "qwen-turbo"
	}
	c.JSON(http.StatusOK, gin.H{
		"code":    200,
		"message": "success",
		"data": gin.H{
			"http_status":       st,
			"resolved_base_url": usedBase,
			"model":             usedModel,
		},
	})
}

// PostTestProviderConnectivity POST /agent/llm-settings/test-provider
// 对 OpenAI 兼容厂商进行最小 /chat/completions 探测（通义、DeepSeek、智谱、豆包、Moonshot 等）。
func (h *SettingsHandler) PostTestProviderConnectivity(c *gin.Context) {
	var body testProviderBody
	_ = c.ShouldBindJSON(&body)

	provider := strings.TrimSpace(body.Provider)
	if provider == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "provider is required"})
		return
	}

	settingsFile, err := config.LoadLLMSettingsFile(h.path)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": err.Error()})
		return
	}
	row := settingsFile.Providers[provider]
	snap := h.store.Snapshot()

	key := strings.TrimSpace(body.APIKey)
	if key == "" {
		key = strings.TrimSpace(row.APIKey)
	}
	if provider == "aliyun_qwen" && key == "" {
		key = strings.TrimSpace(snap.AliyunDashScopeAPIKey)
	}
	if key == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "请填写 API Key，或先保存对应厂商配置"})
		return
	}

	base := strings.TrimSpace(body.BaseURL)
	if base == "" {
		base = strings.TrimSpace(row.BaseURL)
	}
	model := strings.TrimSpace(body.Model)
	if model == "" {
		model = strings.TrimSpace(row.Model)
	}

	st, detail, testErr := services.TestQwenDashScopeConnection(key, base, model)
	if testErr != nil {
		c.JSON(http.StatusOK, gin.H{
			"code":    502,
			"message": testErr.Error(),
			"data": gin.H{
				"http_status": st,
				"detail":      detail,
			},
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"code":    200,
		"message": "success",
		"data": gin.H{
			"http_status":       st,
			"detail":            detail,
			"resolved_base_url": strings.TrimSpace(base),
			"model":             strings.TrimSpace(model),
		},
	})
}

type llmProviderPatch struct {
	APIKey  *string           `json:"api_key"`
	BaseURL *string           `json:"base_url"`
	Model   *string           `json:"model"`
	Extra   map[string]string `json:"extra"`
}

type llmSettingsPutRequest struct {
	IntentResolverProvider *string                     `json:"intent_resolver_provider"`
	Providers              map[string]llmProviderPatch `json:"providers"`
}

// PutLLMSettings PUT /settings/llm
func (h *SettingsHandler) PutLLMSettings(c *gin.Context) {
	var req llmSettingsPutRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": err.Error()})
		return
	}

	cur, err := config.LoadLLMSettingsFile(h.path)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": err.Error()})
		return
	}
	if req.IntentResolverProvider != nil {
		if p := strings.TrimSpace(*req.IntentResolverProvider); p != "" {
			cur.IntentResolverProvider = strings.ToLower(p)
		}
	}
	for id, patch := range req.Providers {
		prev := cur.Providers[id]
		if patch.APIKey != nil {
			prev.APIKey = strings.TrimSpace(*patch.APIKey)
		}
		if patch.BaseURL != nil {
			prev.BaseURL = strings.TrimSpace(*patch.BaseURL)
		}
		if patch.Model != nil {
			prev.Model = strings.TrimSpace(*patch.Model)
		}
		if len(patch.Extra) > 0 {
			if prev.Extra == nil {
				prev.Extra = make(map[string]string)
			}
			for k, v := range patch.Extra {
				prev.Extra[k] = v
			}
		}
		cur.Providers[id] = prev
	}

	if err := config.SaveLLMSettingsFile(h.path, cur); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": err.Error()})
		return
	}
	if err := h.reloadStoreFromDisk(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": err.Error()})
		return
	}
	utils.Info("LLM settings updated at %s (intent=%s)", h.path, cur.IntentResolverProvider)
	c.JSON(http.StatusOK, gin.H{"code": 200, "message": "success"})
}
