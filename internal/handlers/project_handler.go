package handlers

import (
	"database/sql"
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"mcp-training-system/internal/models"
)

type ProjectHandler struct {
	db *sql.DB
}

func NewProjectHandler(db *sql.DB) *ProjectHandler {
	return &ProjectHandler{db: db}
}

func (h *ProjectHandler) ListProjects(c *gin.Context) {
	list, err := models.ListProjectsByUser(h.db, 1)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"code": 200, "message": "success", "data": gin.H{"projects": []interface{}{}}})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 200, "message": "success", "data": gin.H{"projects": list}})
}

func (h *ProjectHandler) GetProject(c *gin.Context) {
	var id int
	if _, err := fmt.Sscanf(c.Param("id"), "%d", &id); err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "Invalid project id"})
		return
	}
	p, err := models.GetProjectByID(h.db, id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 404, "message": "Project not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 200, "message": "success", "data": p})
}

func (h *ProjectHandler) CreateProject(c *gin.Context) {
	var req struct {
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "Invalid request"})
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "name is required"})
		return
	}

	p := &models.Project{
		UserID:      1,
		Name:        name,
		Description: strings.TrimSpace(req.Description),
		SessionRoot: uuid.New().String(),
	}
	if err := models.CreateProject(h.db, p); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 200, "message": "success", "data": p})
}

func (h *ProjectHandler) PatchProject(c *gin.Context) {
	var id int
	if _, err := fmt.Sscanf(c.Param("id"), "%d", &id); err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "Invalid project id"})
		return
	}
	cur, err := models.GetProjectByID(h.db, id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 404, "message": "Project not found"})
		return
	}
	var req struct {
		Name        *string `json:"name"`
		Description *string `json:"description"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "Invalid request"})
		return
	}
	if req.Name != nil {
		cur.Name = strings.TrimSpace(*req.Name)
	}
	if req.Description != nil {
		cur.Description = strings.TrimSpace(*req.Description)
	}
	if cur.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "name is required"})
		return
	}
	if err := models.UpdateProject(h.db, cur); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 200, "message": "success", "data": cur})
}
