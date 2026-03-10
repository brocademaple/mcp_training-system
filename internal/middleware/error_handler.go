package middleware

import (
	"github.com/gin-gonic/gin"
	"mcp-training-system/internal/utils"
)

// ErrorHandler handles errors
func ErrorHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Next()

		// Check if there are any errors
		if len(c.Errors) > 0 {
			err := c.Errors.Last()
			utils.Error("Request error: %v", err.Err)

			c.JSON(500, gin.H{
				"code":    500,
				"message": err.Err.Error(),
			})
		}
	}
}
