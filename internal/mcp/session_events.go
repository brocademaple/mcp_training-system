package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

const maxSessionEvents = 500

// SessionEventKind 与会话事件流展示对齐：系统状态、用户操作、MCP 消息（真实经 Redis 持久化）。
type SessionEventKind string

const (
	SessionEventSystem SessionEventKind = "system"
	SessionEventUser   SessionEventKind = "user"
	SessionEventMCP    SessionEventKind = "mcp"
)

// SessionWireMCP 为 MCPMessage 的精简可序列化视图，供前端流式展示。
type SessionWireMCP struct {
	Type           string `json:"type"`
	From           string `json:"from"`
	To             string `json:"to"`
	Action         string `json:"action"`
	PayloadPreview string `json:"payload_preview,omitempty"`
}

// SessionEvent 单条会话事件（Redis List 元素）。
type SessionEvent struct {
	Seq   int64              `json:"seq"`
	TS    time.Time          `json:"ts"`
	Kind  SessionEventKind   `json:"kind"`
	Phase *int               `json:"phase,omitempty"`
	Text  string             `json:"text,omitempty"`
	MCP   *SessionWireMCP    `json:"mcp,omitempty"`
}

func eventsListKey(sessionID string) string {
	return fmt.Sprintf("mcp:session:%s:events", sessionID)
}

func eventsSeqKey(sessionID string) string {
	return fmt.Sprintf("mcp:session:%s:event_seq", sessionID)
}

// AppendSessionEvent 追加一条事件并返回分配的全局序号。
func (s *Store) AppendSessionEvent(sessionID string, ev SessionEvent) (int64, error) {
	if s == nil || s.redis == nil {
		return 0, errors.New("mcp store is not initialized")
	}
	sid := strings.TrimSpace(sessionID)
	if sid == "" {
		return 0, errors.New("session_id is required")
	}
	ctx := context.Background()
	seq, err := s.redis.Incr(ctx, eventsSeqKey(sid)).Result()
	if err != nil {
		return 0, err
	}
	ev.Seq = seq
	if ev.TS.IsZero() {
		ev.TS = time.Now()
	}
	raw, err := json.Marshal(ev)
	if err != nil {
		return 0, err
	}
	pipe := s.redis.Pipeline()
	pipe.RPush(ctx, eventsListKey(sid), raw)
	pipe.LTrim(ctx, eventsListKey(sid), -maxSessionEvents, -1)
	pipe.Expire(ctx, eventsListKey(sid), mcpContextTTL)
	pipe.Expire(ctx, eventsSeqKey(sid), mcpContextTTL)
	_, err = pipe.Exec(ctx)
	return seq, err
}

// ListSessionEventsAfter 返回序号大于 afterSeq 的事件（按 seq 升序）。
func (s *Store) ListSessionEventsAfter(sessionID string, afterSeq int64) ([]SessionEvent, error) {
	if s == nil || s.redis == nil {
		return nil, errors.New("mcp store is not initialized")
	}
	sid := strings.TrimSpace(sessionID)
	if sid == "" {
		return nil, errors.New("session_id is required")
	}
	ctx := context.Background()
	raws, err := s.redis.LRange(ctx, eventsListKey(sid), 0, -1).Result()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return nil, nil
		}
		return nil, err
	}
	out := make([]SessionEvent, 0, len(raws))
	for _, raw := range raws {
		var ev SessionEvent
		if json.Unmarshal([]byte(raw), &ev) != nil {
			continue
		}
		if ev.Seq > afterSeq {
			out = append(out, ev)
		}
	}
	return out, nil
}

// AppendMCPPair 写入 MCP request/response 各一条（与 Coordinator 语义对齐的轻量审计）。
func (s *Store) AppendMCPPair(sessionID string, phase int, req *MCPMessage, resp *MCPMessage, errMsg string) {
	if s == nil || req == nil {
		return
	}
	ph := phase
	prev := payloadPreview(req.Payload)
	_, _ = s.AppendSessionEvent(sessionID, SessionEvent{
		Kind:  SessionEventMCP,
		Phase: &ph,
		MCP: &SessionWireMCP{
			Type:           req.Type,
			From:           req.From,
			To:             req.To,
			Action:         req.Action,
			PayloadPreview: prev,
		},
	})
	if resp != nil {
		rp := payloadPreview(resp.Payload)
		_, _ = s.AppendSessionEvent(sessionID, SessionEvent{
			Kind:  SessionEventMCP,
			Phase: &ph,
			MCP: &SessionWireMCP{
				Type:           resp.Type,
				From:           resp.From,
				To:             resp.To,
				Action:         resp.Action,
				PayloadPreview: rp,
			},
		})
	} else if errMsg != "" {
		_, _ = s.AppendSessionEvent(sessionID, SessionEvent{
			Kind:  SessionEventSystem,
			Phase: &ph,
			Text:  "MCP 响应异常：" + errMsg,
		})
	}
}

// MCPWireFromMessage 将 MCPMessage 转为会话事件中的精简 MCP 字段。
func MCPWireFromMessage(msg *MCPMessage) *SessionWireMCP {
	if msg == nil {
		return nil
	}
	return &SessionWireMCP{
		Type:           msg.Type,
		From:           msg.From,
		To:             msg.To,
		Action:         msg.Action,
		PayloadPreview: payloadPreview(msg.Payload),
	}
}

func payloadPreview(m map[string]interface{}) string {
	if len(m) == 0 {
		return ""
	}
	raw, err := json.Marshal(m)
	if err != nil {
		return ""
	}
	s := string(raw)
	if len(s) > 400 {
		return s[:400] + "…"
	}
	return s
}
