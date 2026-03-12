package handlers

import (
	"archive/zip"
	"database/sql"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

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

// jobDirRegex 匹配 data/models 下的 job_<数字> 目录名
var jobDirRegex = regexp.MustCompile(`^job_(\d+)$`)

// RecoverModelsFromDisk 扫描 data/models 下的 job_* 目录，对磁盘上存在但数据库无记录的模型补写 training_job + model 记录，使界面能再次列出。
// POST /models/recover-from-disk?user_id=1
func (h *ModelHandler) RecoverModelsFromDisk(c *gin.Context) {
	userID := 1
	if uid := c.Query("user_id"); uid != "" {
		if parsed, err := strconv.Atoi(uid); err == nil {
			userID = parsed
		}
	}

	modelsDir := filepath.Join(h.baseDir, "data", "models")
	info, err := os.Stat(modelsDir)
	if err != nil || !info.IsDir() {
		c.JSON(200, gin.H{"code": 200, "message": "success", "data": gin.H{"recovered": 0, "message": "data/models 目录不存在或不可读"}})
		return
	}

	// 已有模型路径集合（归一化后比较）
	existing, err := models.GetModelsByUserID(h.db, userID)
	if err != nil {
		c.JSON(500, gin.H{"code": 500, "message": fmt.Sprintf("获取已有模型列表失败: %v", err)})
		return
	}
	pathSet := make(map[string]struct{})
	for _, m := range existing {
		p := normModelPath(h.baseDir, m.ModelPath)
		if p != "" {
			pathSet[p] = struct{}{}
		}
	}

	// 需要有一个有效的 dataset_id（training_jobs 外键）
	var firstDatasetID int
	err = h.db.QueryRow("SELECT id FROM datasets ORDER BY id ASC LIMIT 1").Scan(&firstDatasetID)
	if err != nil {
		c.JSON(400, gin.H{"code": 400, "message": "无法恢复：请先至少创建一个数据集，再使用「从磁盘恢复」"})
		return
	}

	entries, err := os.ReadDir(modelsDir)
	if err != nil {
		c.JSON(500, gin.H{"code": 500, "message": fmt.Sprintf("读取 data/models 目录失败: %v", err)})
		return
	}

	recovered := 0
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		name := e.Name()
		sub := jobDirRegex.FindStringSubmatch(name)
		if len(sub) != 2 {
			continue
		}
		relPath := filepath.Join("data", "models", name)
		absPath := filepath.Join(modelsDir, name)
		if _, err := os.Stat(filepath.Join(absPath, "config.json")); err != nil {
			if _, err2 := os.Stat(filepath.Join(absPath, "model.safetensors")); err2 != nil {
				continue
			}
		}
		norm := normModelPath(h.baseDir, relPath)
		if norm == "" {
			continue
		}
		if _, ok := pathSet[norm]; ok {
			continue
		}

		dsID := firstDatasetID
		job := &models.TrainingJob{
			UserID:       userID,
			DatasetID:    &dsID,
			Name:         "恢复的任务 (" + name + ")",
			ModelType:    "text_classification",
			Hyperparams:  map[string]interface{}{},
			Status:       "completed",
			TotalEpochs:  0,
		}
		if err := job.Create(h.db); err != nil {
			utils.Error("RecoverModelsFromDisk: create job for %s: %v", name, err)
			continue
		}
		modelSize := int64(0)
		if size, err := utils.GetDirSize(absPath); err == nil {
			modelSize = size
		}
		model := &models.Model{
			JobID:     job.ID,
			Name:      fmt.Sprintf("Model for job %s", name),
			ModelPath: relPath,
			ModelSize: modelSize,
			ModelType: "text_classification",
			Framework: "pytorch",
		}
		if err := model.Create(h.db); err != nil {
			utils.Error("RecoverModelsFromDisk: create model for %s: %v", name, err)
			continue
		}
		pathSet[norm] = struct{}{}
		recovered++
	}

	c.JSON(200, gin.H{
		"code":    200,
		"message": "success",
		"data":    gin.H{"recovered": recovered, "message": fmt.Sprintf("已从 data/models 恢复 %d 个模型记录", recovered)},
	})
}

func normModelPath(baseDir, p string) string {
	p = filepath.Clean(p)
	if p == "." {
		return ""
	}
	if filepath.IsAbs(p) {
		rel, err := filepath.Rel(baseDir, p)
		if err != nil {
			return p
		}
		p = rel
	}
	p = filepath.Clean(p)
	return strings.TrimPrefix(strings.ReplaceAll(p, "\\", "/"), "./")
}
