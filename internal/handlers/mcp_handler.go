package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"mcp-training-system/internal/mcp"
)

type MCPHandler struct {
	store *mcp.Store
}

func NewMCPHandler(store *mcp.Store) *MCPHandler {
	return &MCPHandler{store: store}
}

// GetSessionContext returns one session MCPContext.
//
// Input:
// - Path param: session_id
// - Route: GET /mcp/session/:session_id
//
// Output:
//
//	{
//	  "code": 200,
//	  "message": "success",
//	  "data": { ...MCPContext... }
//	}
// GetSessionContext 返回会话上下文。扩展 Skill 驱动流程时，可在此或相邻路由增加「按 session 解析应加载的 skill 列表 / MCP 资源」能力；占位定义见 skills/SKILL_REGISTRY.yaml。
func (h *MCPHandler) GetSessionContext(c *gin.Context) {
	if h == nil || h.store == nil {
		c.JSON(500, gin.H{"code": 500, "message": "MCP store not initialized"})
		return
	}
	sessionID := strings.TrimSpace(c.Param("session_id"))
	if sessionID == "" {
		c.JSON(400, gin.H{"code": 400, "message": "session_id is required"})
		return
	}
	ctx, err := h.store.GetContext(sessionID)
	if err != nil {
		c.JSON(500, gin.H{"code": 500, "message": err.Error()})
		return
	}
	if ctx == nil {
		c.JSON(404, gin.H{"code": 404, "message": "session not found"})
		return
	}
	c.JSON(200, gin.H{"code": 200, "message": "success", "data": ctx})
}

// GetSessionEvents GET /mcp/session/:session_id/events?after=0
// 返回 Redis 中持久化的会话事件流（含 MCP 消息），供 Agent 工作台轮询拉取。
func (h *MCPHandler) GetSessionEvents(c *gin.Context) {
	if h == nil || h.store == nil {
		c.JSON(500, gin.H{"code": 500, "message": "MCP store not initialized"})
		return
	}
	sessionID := strings.TrimSpace(c.Param("session_id"))
	if sessionID == "" {
		c.JSON(400, gin.H{"code": 400, "message": "session_id is required"})
		return
	}
	after := int64(0)
	if v := strings.TrimSpace(c.Query("after")); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			after = n
		}
	}
	events, err := h.store.ListSessionEventsAfter(sessionID, after)
	if err != nil {
		c.JSON(500, gin.H{"code": 500, "message": err.Error()})
		return
	}
	maxSeq := after
	for _, ev := range events {
		if ev.Seq > maxSeq {
			maxSeq = ev.Seq
		}
	}
	c.JSON(200, gin.H{
		"code":    200,
		"message": "success",
		"data": gin.H{
			"events":     events,
			"next_after": maxSeq,
		},
	})
}

type postUserSessionEventBody struct {
	Phase   int    `json:"phase"`
	Message string `json:"message"`
}

// PostUserSessionEvent POST /mcp/session/:session_id/events/user
// 记录用户侧操作（须与请求头 X-Session-ID 一致，防止跨会话写入）。
func (h *MCPHandler) PostUserSessionEvent(c *gin.Context) {
	if h == nil || h.store == nil {
		c.JSON(500, gin.H{"code": 500, "message": "MCP store not initialized"})
		return
	}
	sessionID := strings.TrimSpace(c.Param("session_id"))
	if sessionID == "" {
		c.JSON(400, gin.H{"code": 400, "message": "session_id is required"})
		return
	}
	headerSID := strings.TrimSpace(c.GetHeader("X-Session-ID"))
	if headerSID == "" || headerSID != sessionID {
		c.JSON(http.StatusForbidden, gin.H{"code": 403, "message": "X-Session-ID must match session_id"})
		return
	}
	var body postUserSessionEventBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(400, gin.H{"code": 400, "message": err.Error()})
		return
	}
	msg := strings.TrimSpace(body.Message)
	if msg == "" {
		c.JSON(400, gin.H{"code": 400, "message": "message is required"})
		return
	}
	if len(msg) > 2000 {
		msg = msg[:2000]
	}
	ph := body.Phase
	seq, err := h.store.AppendSessionEvent(sessionID, mcp.SessionEvent{
		Kind:  mcp.SessionEventUser,
		Phase: &ph,
		Text:  msg,
	})
	if err != nil {
		c.JSON(500, gin.H{"code": 500, "message": err.Error()})
		return
	}
	c.JSON(200, gin.H{"code": 200, "message": "success", "data": gin.H{"seq": seq}})
}

// StreamSessionEvents SSE: GET /mcp/session/:session_id/events/stream?after=0
// 实时推送会话事件，前端无需轮询。
func (h *MCPHandler) StreamSessionEvents(c *gin.Context) {
	if h == nil || h.store == nil {
		c.JSON(500, gin.H{"code": 500, "message": "MCP store not initialized"})
		return
	}
	sessionID := strings.TrimSpace(c.Param("session_id"))
	if sessionID == "" {
		c.JSON(400, gin.H{"code": 400, "message": "session_id is required"})
		return
	}
	after := int64(0)
	if v := strings.TrimSpace(c.Query("after")); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			after = n
		}
	}

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")

	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		c.JSON(500, gin.H{"code": 500, "message": "streaming unsupported"})
		return
	}

	ticker := time.NewTicker(1200 * time.Millisecond)
	defer ticker.Stop()

	send := func(events []mcp.SessionEvent, nextAfter int64) error {
		payload := map[string]interface{}{
			"events":      events,
			"next_after":  nextAfter,
			"session_id":  sessionID,
			"server_time": time.Now().UTC(),
		}
		raw, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		if _, err := fmt.Fprintf(c.Writer, "event: session-events\ndata: %s\n\n", raw); err != nil {
			return err
		}
		flusher.Flush()
		return nil
	}

	for {
		select {
		case <-c.Request.Context().Done():
			return
		case <-ticker.C:
			events, err := h.store.ListSessionEventsAfter(sessionID, after)
			if err != nil {
				_ = send(nil, after)
				continue
			}
			if len(events) == 0 {
				_, _ = fmt.Fprint(c.Writer, ": keepalive\n\n")
				flusher.Flush()
				continue
			}
			next := after
			for _, ev := range events {
				if ev.Seq > next {
					next = ev.Seq
				}
			}
			if err := send(events, next); err != nil {
				return
			}
			after = next
		}
	}
}
