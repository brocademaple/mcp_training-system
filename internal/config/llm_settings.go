package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

const llmSettingsFileVersion = 1

// LLMProviderEntry 单个模型厂商的 API 配置（持久化到本地 JSON）。
type LLMProviderEntry struct {
	APIKey  string            `json:"api_key"`
	BaseURL string            `json:"base_url"`
	Model   string            `json:"model"`
	Extra   map[string]string `json:"extra,omitempty"`
}

// LLMSettingsFile 持久化结构；非阿里云字段目前仅保存，供后续扩展调用。
type LLMSettingsFile struct {
	Version                int                          `json:"version"`
	IntentResolverProvider string                       `json:"intent_resolver_provider"`
	Providers              map[string]LLMProviderEntry `json:"providers"`
}

// DefaultLLMSettingsFile 返回带默认占位与推荐 Base URL / 模型的初始结构。
func DefaultLLMSettingsFile() *LLMSettingsFile {
	return &LLMSettingsFile{
		Version:                llmSettingsFileVersion,
		IntentResolverProvider: "",
		Providers: map[string]LLMProviderEntry{
			"aliyun_qwen": {
				BaseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
				Model:   "qwen-turbo",
			},
			"openai": {
				BaseURL: "https://api.openai.com/v1",
				Model:   "gpt-4o-mini",
			},
			"azure_openai": {
				BaseURL: "",
				Model:   "",
				Extra: map[string]string{
					"deployment":  "",
					"api_version": "2024-02-15-preview",
				},
			},
			"anthropic": {
				BaseURL: "https://api.anthropic.com",
				Model:   "claude-3-5-haiku-20241022",
			},
			"google_gemini": {
				BaseURL: "https://generativelanguage.googleapis.com",
				Model:   "gemini-1.5-flash",
			},
			"deepseek": {
				BaseURL: "https://api.deepseek.com/v1",
				Model:   "deepseek-chat",
			},
			"zhipu_glm": {
				BaseURL: "https://open.bigmodel.cn/api/paas/v4",
				Model:   "glm-4-flash",
			},
			"volcengine_doubao": {
				BaseURL: "",
				Model:   "",
			},
			"moonshot": {
				BaseURL: "https://api.moonshot.cn/v1",
				Model:   "moonshot-v1-8k",
			},
		},
	}
}

// LoadLLMSettingsFile 读取设置文件；不存在则返回默认结构（不写盘）。
func LoadLLMSettingsFile(path string) (*LLMSettingsFile, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return DefaultLLMSettingsFile(), nil
		}
		return nil, err
	}
	var f LLMSettingsFile
	if err := json.Unmarshal(b, &f); err != nil {
		return nil, err
	}
	if f.Version == 0 {
		f.Version = llmSettingsFileVersion
	}
	if f.Providers == nil {
		f.Providers = make(map[string]LLMProviderEntry)
	}
	// 合并缺省项，避免前端 Tabs 缺 key
	mergeProviderDefaults(&f, DefaultLLMSettingsFile())
	return &f, nil
}

func mergeProviderDefaults(dst *LLMSettingsFile, defaults *LLMSettingsFile) {
	for id, def := range defaults.Providers {
		cur, ok := dst.Providers[id]
		if !ok {
			dst.Providers[id] = def
			continue
		}
		if strings.TrimSpace(cur.BaseURL) == "" {
			cur.BaseURL = def.BaseURL
		}
		if strings.TrimSpace(cur.Model) == "" {
			cur.Model = def.Model
		}
		if len(def.Extra) > 0 {
			if cur.Extra == nil {
				cur.Extra = make(map[string]string)
			}
			for k, v := range def.Extra {
				if _, exists := cur.Extra[k]; !exists {
					cur.Extra[k] = v
				}
			}
		}
		dst.Providers[id] = cur
	}
}

// SaveLLMSettingsFile 原子写入设置文件。
func SaveLLMSettingsFile(path string, f *LLMSettingsFile) error {
	if f.Version == 0 {
		f.Version = llmSettingsFileVersion
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(f, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// MergeEnvAgentWithLLMFile 以环境变量中的 Agent 为底，用文件中的非空项覆盖（用于运行时生效配置）。
func MergeEnvAgentWithLLMFile(env AgentConfig, f *LLMSettingsFile) AgentConfig {
	out := env
	if f == nil {
		return out
	}
	if p := strings.TrimSpace(f.IntentResolverProvider); p != "" {
		out.IntentResolverProvider = strings.ToLower(p)
	}
	if e, ok := f.Providers["aliyun_qwen"]; ok {
		if strings.TrimSpace(e.APIKey) != "" {
			out.AliyunDashScopeAPIKey = strings.TrimSpace(e.APIKey)
		}
		if strings.TrimSpace(e.BaseURL) != "" {
			out.AliyunDashScopeBaseURL = stringsTrimRightSlash(strings.TrimSpace(e.BaseURL))
		}
		if strings.TrimSpace(e.Model) != "" {
			out.AliyunIntentModel = strings.TrimSpace(e.Model)
		}
	}
	return out
}

// MaskAPIKey 脱敏展示 API Key。
func MaskAPIKey(k string) string {
	k = strings.TrimSpace(k)
	if k == "" {
		return ""
	}
	if len(k) <= 8 {
		return "********"
	}
	return k[:3] + "..." + k[len(k)-4:]
}
