package config

import "sync"

// AgentStore 保存当前生效的 Agent 配置（可被设置接口热更新）。
type AgentStore struct {
	mu sync.RWMutex
	c  AgentConfig
}

func NewAgentStore(c AgentConfig) *AgentStore {
	return &AgentStore{c: c}
}

// Snapshot 返回一份拷贝，供单次请求内使用。
func (s *AgentStore) Snapshot() AgentConfig {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.c
}

// Replace 全量替换运行时配置。
func (s *AgentStore) Replace(c AgentConfig) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.c = c
}
