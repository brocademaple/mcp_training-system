package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

const mcpContextTTL = 24 * time.Hour

type Store struct {
	redis *redis.Client
}

func NewStore(redisClient *redis.Client) *Store {
	return &Store{redis: redisClient}
}

func contextKey(sessionID string) string {
	return fmt.Sprintf("mcp:session:%s", sessionID)
}

// SaveContext stores full MCPContext with 24h TTL.
func (s *Store) SaveContext(ctx MCPContext) error {
	if s == nil || s.redis == nil {
		return errors.New("mcp store is not initialized")
	}
	if ctx.SessionID == "" {
		return errors.New("session_id is required")
	}
	now := time.Now()
	if ctx.CreatedAt.IsZero() {
		ctx.CreatedAt = now
	}
	ctx.UpdatedAt = now

	raw, err := json.Marshal(ctx)
	if err != nil {
		return err
	}
	return s.redis.Set(context.Background(), contextKey(ctx.SessionID), raw, mcpContextTTL).Err()
}

// GetContext reads MCPContext by sessionID.
func (s *Store) GetContext(sessionID string) (*MCPContext, error) {
	if s == nil || s.redis == nil {
		return nil, errors.New("mcp store is not initialized")
	}
	if sessionID == "" {
		return nil, errors.New("session_id is required")
	}
	raw, err := s.redis.Get(context.Background(), contextKey(sessionID)).Bytes()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return nil, nil
		}
		return nil, err
	}
	var ctx MCPContext
	if err := json.Unmarshal(raw, &ctx); err != nil {
		return nil, err
	}
	return &ctx, nil
}

// UpdateContext applies partial updates and refreshes TTL.
func (s *Store) UpdateContext(sessionID string, updates map[string]interface{}) error {
	if s == nil || s.redis == nil {
		return errors.New("mcp store is not initialized")
	}
	if sessionID == "" {
		return errors.New("session_id is required")
	}
	if len(updates) == 0 {
		return nil
	}

	current, err := s.GetContext(sessionID)
	if err != nil {
		return err
	}
	if current == nil {
		current = &MCPContext{
			SessionID: sessionID,
			CreatedAt: time.Now(),
		}
	}

	baseMap := map[string]interface{}{}
	baseRaw, _ := json.Marshal(current)
	_ = json.Unmarshal(baseRaw, &baseMap)

	for k, v := range updates {
		baseMap[k] = v
	}
	baseMap["session_id"] = sessionID
	baseMap["updated_at"] = time.Now()
	if current.CreatedAt.IsZero() {
		baseMap["created_at"] = time.Now()
	}

	nextRaw, err := json.Marshal(baseMap)
	if err != nil {
		return err
	}
	var next MCPContext
	if err := json.Unmarshal(nextRaw, &next); err != nil {
		return err
	}
	if next.CreatedAt.IsZero() {
		next.CreatedAt = time.Now()
	}
	next.UpdatedAt = time.Now()

	return s.SaveContext(next)
}
