package handlers

import (
	"strings"

	"github.com/gin-gonic/gin"
)

func extractSessionID(c *gin.Context, preferred string) string {
	if s := strings.TrimSpace(preferred); s != "" {
		return s
	}
	if s := strings.TrimSpace(c.GetHeader("X-Session-ID")); s != "" {
		return s
	}
	if s := strings.TrimSpace(c.PostForm("session_id")); s != "" {
		return s
	}
	if s := strings.TrimSpace(c.Query("session_id")); s != "" {
		return s
	}
	return ""
}
