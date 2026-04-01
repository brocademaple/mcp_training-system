package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"mcp-training-system/internal/registry"
)

// RegistryHandler 返回任务/方法/领域注册表（供经典版与 Agent 版下拉）。
type RegistryHandler struct{}

func NewRegistryHandler() *RegistryHandler {
	return &RegistryHandler{}
}

func (h *RegistryHandler) GetBundle(c *gin.Context) {
	b := registry.Get()
	if b == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "registry not loaded"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"task_registry":   b.Task,
		"method_registry": b.Method,
		"domain_registry": b.Domain,
	})
}
