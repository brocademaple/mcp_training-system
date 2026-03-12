package handlers

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"mcp-training-system/internal/models"
	"mcp-training-system/internal/utils"
)

// SyncHandler 提供从磁盘一次性同步数据集与模型记录的能力
type SyncHandler struct {
	db        *sql.DB
	baseDir   string
	uploadDir string
}

// NewSyncHandler 创建同步处理器。uploadDir 为上传目录绝对或相对路径（如 ./data/uploads）
func NewSyncHandler(db *sql.DB, baseDir, uploadDir string) *SyncHandler {
	return &SyncHandler{db: db, baseDir: baseDir, uploadDir: uploadDir}
}

var jobDirRegexSync = regexp.MustCompile(`^job_(\d+)$`)

// normPath 将路径归一化为相对 baseDir 的斜杠形式，便于去重比较
func normPath(baseDir, p string) string {
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

// SyncFromDisk 一次性同步：先扫描 data/uploads 补全数据集记录，再扫描 data/models 补全模型与训练任务记录。
// POST /sync-from-disk?user_id=1
func (h *SyncHandler) SyncFromDisk(c *gin.Context) {
	userID := 1
	if uid := c.Query("user_id"); uid != "" {
		if parsed, err := strconv.Atoi(uid); err == nil {
			userID = parsed
		}
	}

	datasetsRecovered, err := h.syncDatasetsFromUploadDir(userID)
	if err != nil {
		utils.Error("SyncFromDisk: sync datasets: %v", err)
		c.JSON(500, gin.H{"code": 500, "message": fmt.Sprintf("同步数据集失败: %v", err)})
		return
	}

	modelsRecovered, err := h.syncModelsFromDisk(userID)
	if err != nil {
		utils.Error("SyncFromDisk: sync models: %v", err)
		c.JSON(500, gin.H{"code": 500, "message": fmt.Sprintf("同步模型失败: %v", err)})
		return
	}

	msg := "同步完成"
	if datasetsRecovered > 0 || modelsRecovered > 0 {
		msg = fmt.Sprintf("已恢复 %d 个数据集、%d 个模型（及对应训练任务）", datasetsRecovered, modelsRecovered)
	} else {
		msg = "未发现需要恢复的数据，磁盘与数据库已一致"
	}

	c.JSON(200, gin.H{
		"code":    200,
		"message": "success",
		"data": gin.H{
			"datasets_recovered": datasetsRecovered,
			"models_recovered":   modelsRecovered,
			"message":            msg,
		},
	})
}

// syncDatasetsFromUploadDir 扫描 uploadDir 下文件，对未在 DB 中记录的文件创建数据集记录（status=ready，直接可用）
func (h *SyncHandler) syncDatasetsFromUploadDir(userID int) (int, error) {
	uploadDir := h.uploadDir
	if !filepath.IsAbs(uploadDir) {
		uploadDir = filepath.Join(h.baseDir, uploadDir)
	}
	uploadDir = filepath.Clean(uploadDir)
	info, err := os.Stat(uploadDir)
	if err != nil || !info.IsDir() {
		return 0, nil
	}

	// 已有数据集路径集合（original_file_path / cleaned_file_path）
	existing, err := models.GetDatasetsByUserIDAndUsage(h.db, userID, "")
	if err != nil {
		return 0, err
	}
	pathSet := make(map[string]struct{})
	for _, d := range existing {
		if d.OriginalFilePath.Valid && d.OriginalFilePath.String != "" {
			pathSet[normPath(h.baseDir, d.OriginalFilePath.String)] = struct{}{}
		}
		if d.CleanedFilePath.Valid && d.CleanedFilePath.String != "" {
			pathSet[normPath(h.baseDir, d.CleanedFilePath.String)] = struct{}{}
		}
	}

	entries, err := os.ReadDir(uploadDir)
	if err != nil {
		return 0, err
	}

	recovered := 0
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		ext := strings.ToLower(filepath.Ext(name))
		if ext != ".csv" && ext != ".json" && ext != ".tsv" {
			continue
		}
		absPath := filepath.Join(uploadDir, name)
		relPath, err := filepath.Rel(h.baseDir, absPath)
		if err != nil {
			relPath = filepath.Join("data", "uploads", name)
		}
		relPath = strings.ReplaceAll(relPath, "\\", "/")
		norm := normPath(h.baseDir, relPath)
		if norm == "" {
			norm = relPath
		}
		if _, ok := pathSet[norm]; ok {
			continue
		}

		fileInfo, err := os.Stat(absPath)
		if err != nil {
			continue
		}
		fileSize := fileInfo.Size()
		dataType := "text"
		if ext == ".json" {
			dataType = "text"
		}
		d := &models.Dataset{
			UserID:           userID,
			Name:             name,
			Type:             dataType,
			Usage:            "training",
			Source:           sql.NullString{String: "local", Valid: true},
			OriginalFilePath: sql.NullString{String: relPath, Valid: true},
			FileSize:         sql.NullInt64{Int64: fileSize, Valid: true},
			Status:           "uploading",
		}
		if err := d.Create(h.db); err != nil {
			utils.Error("SyncFromDisk: create dataset for %s: %v", name, err)
			continue
		}
		if err := models.SetDatasetReadyWithPath(h.db, d.ID, relPath); err != nil {
			utils.Error("SyncFromDisk: set ready for dataset %d: %v", d.ID, err)
		}
		pathSet[norm] = struct{}{}
		recovered++
	}
	return recovered, nil
}

// syncModelsFromDisk 与 ModelHandler.RecoverModelsFromDisk 逻辑一致，扫描 data/models 补全 job+model 记录
func (h *SyncHandler) syncModelsFromDisk(userID int) (int, error) {
	modelsDir := filepath.Join(h.baseDir, "data", "models")
	info, err := os.Stat(modelsDir)
	if err != nil || !info.IsDir() {
		return 0, nil
	}

	existing, err := models.GetModelsByUserID(h.db, userID)
	if err != nil {
		return 0, err
	}
	pathSet := make(map[string]struct{})
	for _, m := range existing {
		p := normPath(h.baseDir, m.ModelPath)
		if p != "" {
			pathSet[p] = struct{}{}
		}
	}

	var firstDatasetID int
	err = h.db.QueryRow("SELECT id FROM datasets ORDER BY id ASC LIMIT 1").Scan(&firstDatasetID)
	if err != nil {
		return 0, nil
	}

	entries, err := os.ReadDir(modelsDir)
	if err != nil {
		return 0, err
	}

	recovered := 0
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		name := e.Name()
		if len(jobDirRegexSync.FindStringSubmatch(name)) != 2 {
			continue
		}
		relPath := filepath.Join("data", "models", name)
		absPath := filepath.Join(modelsDir, name)
		if _, err := os.Stat(filepath.Join(absPath, "config.json")); err != nil {
			if _, err2 := os.Stat(filepath.Join(absPath, "model.safetensors")); err2 != nil {
				continue
			}
		}
		norm := normPath(h.baseDir, relPath)
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
			utils.Error("SyncFromDisk: create job for %s: %v", name, err)
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
			utils.Error("SyncFromDisk: create model for %s: %v", name, err)
			continue
		}
		pathSet[norm] = struct{}{}
		recovered++
	}
	return recovered, nil
}
