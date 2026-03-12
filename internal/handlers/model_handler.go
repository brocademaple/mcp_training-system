package handlers

import (
	"archive/zip"
	"database/sql"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"

	"github.com/gin-gonic/gin"
	"mcp-training-system/internal/models"
	"mcp-training-system/internal/utils"
)

// ModelHandler handles model-related requests
type ModelHandler struct {
	db      *sql.DB
	baseDir string
}

// NewModelHandler creates a new model handler
func NewModelHandler(db *sql.DB, baseDir string) *ModelHandler {
	return &ModelHandler{
		db:      db,
		baseDir: baseDir,
	}
}

// GetModels returns models for the given user (default user_id=1)
// GET /models?user_id=1
func (h *ModelHandler) GetModels(c *gin.Context) {
	userID := 1
	if uid := c.Query("user_id"); uid != "" {
		if parsed, err := strconv.Atoi(uid); err == nil {
			userID = parsed
		}
	}

	list, err := models.GetModelsByUserID(h.db, userID)
	if err != nil {
		c.JSON(500, gin.H{"code": 500, "message": fmt.Sprintf("Failed to get models: %v", err)})
		return
	}

	// 对 model_size 为 0 的已有记录，按磁盘目录补算并回写，便于前端正确展示
	for _, m := range list {
		if m.ModelSize > 0 {
			continue
		}
		absPath := m.ModelPath
		if !filepath.IsAbs(absPath) {
			absPath = filepath.Join(h.baseDir, absPath)
		}
		absPath = filepath.Clean(absPath)
		if size, err := utils.GetDirSize(absPath); err == nil && size > 0 {
			_ = models.UpdateModelSize(h.db, m.ID, size)
			m.ModelSize = size
		}
	}

	c.JSON(200, gin.H{
		"code":    200,
		"message": "success",
		"data": gin.H{
			"models": list,
		},
	})
}

// DownloadModel streams the model as a zip file
// GET /models/:id/download
// Model on disk is a directory (e.g. ./data/models/job_1); we zip it and stream as model_<id>.zip
func (h *ModelHandler) DownloadModel(c *gin.Context) {
	id := c.Param("id")
	var modelID int
	if _, err := fmt.Sscanf(id, "%d", &modelID); err != nil {
		c.JSON(400, gin.H{"code": 400, "message": "Invalid model id"})
		return
	}

	model, err := models.GetModelByID(h.db, modelID)
	if err != nil || model == nil {
		c.JSON(404, gin.H{"code": 404, "message": "Model not found"})
		return
	}

	// Resolve model path (may be relative like ./data/models/job_1)
	modelPath := model.ModelPath
	if !filepath.IsAbs(modelPath) {
		modelPath = filepath.Join(h.baseDir, modelPath)
	}
	modelPath = filepath.Clean(modelPath)

	info, err := os.Stat(modelPath)
	if err != nil {
		c.JSON(404, gin.H{"code": 404, "message": "Model file not found on disk"})
		return
	}

	// If it's a single file, serve it directly (e.g. .pth)
	if !info.IsDir() {
		c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filepath.Base(modelPath)))
		c.Header("Content-Type", "application/octet-stream")
		c.File(modelPath)
		return
	}

	// Directory: zip and stream
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=model_%d.zip", modelID))
	c.Header("Content-Type", "application/zip")
	c.Header("Transfer-Encoding", "chunked")

	zw := zip.NewWriter(c.Writer)
	defer zw.Close()

	baseName := filepath.Base(modelPath)
	err = filepath.Walk(modelPath, func(path string, fi os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		rel, err := filepath.Rel(modelPath, path)
		if err != nil {
			return err
		}
		zipName := filepath.Join(baseName, rel)
		if fi.IsDir() {
			zipName += "/"
			_, err := zw.Create(zipName)
			return err
		}
		w, err := zw.Create(zipName)
		if err != nil {
			return err
		}
		f, err := os.Open(path)
		if err != nil {
			return err
		}
		defer f.Close()
		_, err = io.Copy(w, f)
		return err
	})

	if err != nil {
		if !c.Writer.Written() {
			c.JSON(500, gin.H{"code": 500, "message": fmt.Sprintf("Failed to zip model: %v", err)})
		}
		return
	}
}
