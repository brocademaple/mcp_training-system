package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/redis/go-redis/v9"
)

var wsUpgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

// TrainingWSHandler handles WebSocket connections for training progress
type TrainingWSHandler struct {
	redis *redis.Client
}

// NewTrainingWSHandler creates a new WebSocket handler for training progress
func NewTrainingWSHandler(redisClient *redis.Client) *TrainingWSHandler {
	return &TrainingWSHandler{redis: redisClient}
}

// Serve upgrades the connection and streams progress from Redis pubsub
func (h *TrainingWSHandler) Serve(c *gin.Context) {
	id := c.Param("id")
	jobID, err := strconv.Atoi(id)
	if err != nil || jobID <= 0 {
		c.JSON(400, gin.H{"code": 400, "message": "Invalid job id"})
		return
	}

	conn, err := wsUpgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	channel := fmt.Sprintf("training:progress:%d", jobID)
	ctx := context.Background()
	pubsub := h.redis.Subscribe(ctx, channel)
	defer pubsub.Close()

	// Send current progress from Redis hash once on connect (optional initial state)
	if cur, err := h.redis.HGetAll(ctx, channel).Result(); err == nil && len(cur) > 0 {
		curJSON, _ := json.Marshal(cur)
		_ = conn.WriteMessage(websocket.TextMessage, curJSON)
	}

	ch := pubsub.Channel()
	conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	for {
		select {
		case msg, ok := <-ch:
			if !ok {
				return
			}
			if err := conn.WriteMessage(websocket.TextMessage, []byte(msg.Payload)); err != nil {
				return
			}
			// If this is a terminal status, stop after sending
			if strings.Contains(msg.Payload, `"status":"completed"`) || strings.Contains(msg.Payload, `"status":"failed"`) || strings.Contains(msg.Payload, `"status":"cancelled"`) {
				return
			}
		}
	}
}
