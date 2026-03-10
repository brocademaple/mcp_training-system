package mcp

import (
	"time"

	"github.com/google/uuid"
)

// MCPMessage represents a message in the MCP protocol
type MCPMessage struct {
	ID        string                 `json:"id"`
	Type      string                 `json:"type"` // "request" or "response"
	From      string                 `json:"from"`
	To        string                 `json:"to"`
	Action    string                 `json:"action"`
	Payload   map[string]interface{} `json:"payload"`
	Timestamp time.Time              `json:"timestamp"`
}

// NewRequest creates a new MCP request message
func NewRequest(from, to, action string, payload map[string]interface{}) *MCPMessage {
	return &MCPMessage{
		ID:        uuid.New().String(),
		Type:      "request",
		From:      from,
		To:        to,
		Action:    action,
		Payload:   payload,
		Timestamp: time.Now(),
	}
}

// NewResponse creates a new MCP response message
func NewResponse(from, to, action string, payload map[string]interface{}) *MCPMessage {
	return &MCPMessage{
		ID:        uuid.New().String(),
		Type:      "response",
		From:      from,
		To:        to,
		Action:    action,
		Payload:   payload,
		Timestamp: time.Now(),
	}
}
