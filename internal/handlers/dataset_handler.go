package handlers

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
	"mcp-training-system/internal/agents"
	"mcp-training-system/internal/models"
	"mcp-training-system/internal/utils"
)

// nullString returns sql.NullString for a non-empty s; empty s becomes Valid=false.
func nullString(s string) sql.NullString {
	return sql.NullString{String: s, Valid: s != ""}
}

func nullInt64(n int64) sql.NullInt64 {
	return sql.NullInt64{Int64: n, Valid: true}
}

// DatasetHandler handles dataset-related requests
type DatasetHandler struct {
	db        *sql.DB
	dataAgent *agents.DataAgent
	uploadDir string
}

// NewDatasetHandler creates a new dataset handler
func NewDatasetHandler(db *sql.DB, dataAgent *agents.DataAgent, uploadDir string) *DatasetHandler {
	return &DatasetHandler{
		db:        db,
		dataAgent: dataAgent,
		uploadDir: uploadDir,
	}
}

// UploadDataset handles dataset upload
func (h *DatasetHandler) UploadDataset(c *gin.Context) {
	// Get form data
	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(400, gin.H{"code": 400, "message": "No file uploaded"})
		return
	}

	name := c.PostForm("name")
	dataType := c.PostForm("type")

	// Validate file type
	ext := filepath.Ext(file.Filename)
	if ext != ".csv" && ext != ".json" {
		c.JSON(400, gin.H{"code": 400, "message": "Only CSV and JSON files are allowed"})
		return
	}

	// Validate file size (max 100MB)
	if file.Size > 100*1024*1024 {
		c.JSON(400, gin.H{"code": 400, "message": "File size exceeds 100MB"})
		return
	}

	utils.Info("Uploading dataset: %s, size: %d bytes", file.Filename, file.Size)

	// Open uploaded file
	src, err := file.Open()
	if err != nil {
		c.JSON(500, gin.H{"code": 500, "message": "Failed to open file"})
		return
	}
	defer src.Close()

	// Save file
	filename := fmt.Sprintf("dataset_%d%s", utils.GetTimestamp(), ext)
	filePath, err := utils.SaveUploadedFile(src, filename, h.uploadDir)
	if err != nil {
		c.JSON(500, gin.H{"code": 500, "message": fmt.Sprintf("Failed to save file: %v", err)})
		return
	}

	usage := c.PostForm("usage")
	if usage != "training" && usage != "test" {
		usage = "training"
	}
	// Create dataset record (nullable fields use NullString/NullInt64 for DB)
	dataset := &models.Dataset{
		UserID:           1,
		Name:             name,
		Type:             dataType,
		Usage:            usage,
		Source:           nullString("local"),
		OriginalFilePath: sql.NullString{String: filePath, Valid: true},
		FileSize:         nullInt64(file.Size),
		Status:           "uploading",
	}

	if err := dataset.Create(h.db); err != nil {
		msg := fmt.Sprintf("Failed to create dataset: %v", err)
		if strings.Contains(err.Error(), "usage") && strings.Contains(err.Error(), "does not exist") {
			msg = "数据库缺少 usage 列，请先执行迁移 008。PowerShell: Get-Content internal/database/migrations/008_add_dataset_usage.sql | docker exec -i postgres-mcp-training psql -U mcp_user -d mcp_training"
		}
		c.JSON(500, gin.H{"code": 500, "message": msg})
		return
	}

	// Start cleaning in background for CSV files; JSON 等非 CSV 直接以原文件作为可训练路径并标记为 ready
	if ext == ".csv" {
		go func(id int) {
			if err := h.dataAgent.CleanData(id); err != nil {
				utils.Error("Failed to clean dataset %d: %v", id, err)
			}
		}(dataset.ID)
	} else {
		if err := models.SetDatasetReadyWithPath(h.db, dataset.ID, filePath); err != nil {
			utils.Error("Failed to set dataset %d ready with path: %v", dataset.ID, err)
		}
	}

	c.JSON(200, gin.H{
		"code":    200,
		"message": "success",
		"data": gin.H{
			"dataset_id": dataset.ID,
			"status":     "uploading",
		},
	})
}

// ImportFromURL creates a dataset by fetching CSV from a URL (crawl/import from link)
// POST /datasets/from-url  Body: JSON { "name": "...", "url": "https://...", "type": "text", "usage": "training"|"test", "column_map": {...} }
func (h *DatasetHandler) ImportFromURL(c *gin.Context) {
	var req struct {
		Name      string            `json:"name"`
		URL       string            `json:"url"`
		Type      string            `json:"type"`
		Usage     string            `json:"usage"`
		ColumnMap map[string]string `json:"column_map"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"code": 400, "message": "Invalid request: name, url, type required"})
		return
	}
	if req.Name == "" || req.URL == "" {
		c.JSON(400, gin.H{"code": 400, "message": "name and url are required"})
		return
	}
	if req.Type == "" {
		req.Type = "text"
	}
	if req.Usage != "training" && req.Usage != "test" {
		req.Usage = "training"
	}

	utils.Info("Importing dataset from URL: %s", req.URL)

	// 按 URL 路径保留扩展名（.csv / .tsv），便于清洗与列重命名逻辑区分
	ext := filepath.Ext(req.URL)
	if ext != ".csv" && ext != ".tsv" {
		ext = ".csv"
	}
	filename := fmt.Sprintf("dataset_%d%s", utils.GetTimestamp(), ext)
	savePath := filepath.Join(h.uploadDir, filename)
	written, err := utils.FetchURLToFile(req.URL, savePath, 100*1024*1024)
	if err != nil {
		c.JSON(400, gin.H{"code": 400, "message": fmt.Sprintf("拉取失败: %v", err)})
		return
	}

	if len(req.ColumnMap) > 0 && ext == ".csv" {
		if err := utils.RenameCSVColumns(savePath, req.ColumnMap); err != nil {
			os.Remove(savePath)
			c.JSON(400, gin.H{"code": 400, "message": fmt.Sprintf("列重命名失败: %v", err)})
			return
		}
	}

	dataset := &models.Dataset{
		UserID:           1,
		Name:             req.Name,
		Type:             req.Type,
		Usage:            req.Usage,
		Source:           sql.NullString{String: req.URL, Valid: true},
		OriginalFilePath: sql.NullString{String: savePath, Valid: true},
		FileSize:         nullInt64(written),
		Status:           "uploading",
	}
	if err := dataset.Create(h.db); err != nil {
		utils.Error("Create dataset failed (from URL): %v", err)
		msg := fmt.Sprintf("创建数据集记录失败: %v", err)
		if strings.Contains(err.Error(), "usage") && strings.Contains(err.Error(), "does not exist") {
			msg = "数据库缺少 usage 列，请先执行迁移 008。PowerShell: Get-Content internal/database/migrations/008_add_dataset_usage.sql | docker exec -i postgres-mcp-training psql -U mcp_user -d mcp_training"
		}
		c.JSON(500, gin.H{"code": 500, "message": msg})
		return
	}

	go func() {
		if err := h.dataAgent.CleanData(dataset.ID); err != nil {
			utils.Error("Failed to clean dataset %d (from URL): %v", dataset.ID, err)
		}
	}()

	c.JSON(200, gin.H{
		"code":    200,
		"message": "success",
		"data": gin.H{
			"dataset_id": dataset.ID,
			"status":     "uploading",
		},
	})
}

// GetDatasets returns datasets, optionally filtered by usage (query param usage=training|test)
func (h *DatasetHandler) GetDatasets(c *gin.Context) {
	usage := c.Query("usage")
	datasets, err := models.GetDatasetsByUserIDAndUsage(h.db, 1, usage)
	if err != nil {
		c.JSON(500, gin.H{"code": 500, "message": fmt.Sprintf("Failed to get datasets: %v", err)})
		return
	}

	c.JSON(200, gin.H{
		"code":    200,
		"message": "success",
		"data": gin.H{
			"total":    len(datasets),
			"datasets": datasets,
		},
	})
}

// GetDatasetDetail returns dataset details
func (h *DatasetHandler) GetDatasetDetail(c *gin.Context) {
	id := c.Param("id")
	var datasetID int
	fmt.Sscanf(id, "%d", &datasetID)

	dataset, err := models.GetDatasetByID(h.db, datasetID)
	if err != nil {
		c.JSON(404, gin.H{"code": 404, "message": "Dataset not found"})
		return
	}

	c.JSON(200, gin.H{
		"code":    200,
		"message": "success",
		"data":    dataset,
	})
}

// GetDatasetPreview returns the first N rows of the dataset CSV for display in the UI.
// GET /datasets/:id/preview?limit=100
func (h *DatasetHandler) GetDatasetPreview(c *gin.Context) {
	id := c.Param("id")
	var datasetID int
	if _, err := fmt.Sscanf(id, "%d", &datasetID); err != nil {
		c.JSON(400, gin.H{"code": 400, "message": "Invalid dataset id"})
		return
	}

	dataset, err := models.GetDatasetByID(h.db, datasetID)
	if err != nil || dataset == nil {
		c.JSON(404, gin.H{"code": 404, "message": "Dataset not found"})
		return
	}

	var filePath string
	tryPath := func(p string) bool {
		if p == "" {
			return false
		}
		if _, e := os.Stat(p); e == nil {
			filePath = p
			return true
		}
		under := filepath.Join(h.uploadDir, filepath.Base(p))
		if _, e := os.Stat(under); e == nil {
			filePath = under
			return true
		}
		return false
	}
	cleanedOK := dataset.CleanedFilePath.Valid && tryPath(dataset.CleanedFilePath.String)
	origOK := dataset.OriginalFilePath.Valid && tryPath(dataset.OriginalFilePath.String)
	if cleanedOK || origOK {
		// filePath set
	} else {
		c.JSON(404, gin.H{"code": 404, "message": "Dataset file not found on disk"})
		return
	}

	limit := 100
	if l := c.Query("limit"); l != "" {
		if n, _ := fmt.Sscanf(l, "%d", &limit); n == 1 && limit > 0 && limit <= 1000 {
			// use limit
		} else {
			limit = 100
		}
	}

	columns, rows, err := utils.ReadFilePreview(filePath, limit)
	if err != nil {
		c.JSON(500, gin.H{"code": 500, "message": fmt.Sprintf("Failed to read CSV: %v", err)})
		return
	}

	c.JSON(200, gin.H{
		"code":    200,
		"message": "success",
		"data": gin.H{
			"columns": columns,
			"rows":    rows,
			"total":   len(rows),
		},
	})
}

// RetryCleanDataset re-runs data cleaning for a dataset that is in "error" state.
// POST /datasets/:id/retry-clean
func (h *DatasetHandler) RetryCleanDataset(c *gin.Context) {
	id := c.Param("id")
	var datasetID int
	if _, err := fmt.Sscanf(id, "%d", &datasetID); err != nil {
		c.JSON(400, gin.H{"code": 400, "message": "Invalid dataset id"})
		return
	}
	dataset, err := models.GetDatasetByID(h.db, datasetID)
	if err != nil || dataset == nil {
		c.JSON(404, gin.H{"code": 404, "message": "Dataset not found"})
		return
	}
	if dataset.Status != "error" {
		c.JSON(400, gin.H{"code": 400, "message": "Only datasets in error state can retry clean"})
		return
	}
	if !dataset.OriginalFilePath.Valid || dataset.OriginalFilePath.String == "" {
		c.JSON(400, gin.H{"code": 400, "message": "Dataset has no original file to clean"})
		return
	}
	// Mark as processing, then run clean in background
	if _, err := h.db.Exec("UPDATE datasets SET status = 'processing', error_message = NULL, updated_at = NOW() WHERE id = $1", datasetID); err != nil {
		c.JSON(500, gin.H{"code": 500, "message": fmt.Sprintf("Failed to update status: %v", err)})
		return
	}
	go func() {
		if err := h.dataAgent.CleanData(datasetID); err != nil {
			utils.Error("Retry clean failed for dataset %d: %v", datasetID, err)
		}
	}()
	c.JSON(200, gin.H{"code": 200, "message": "success", "data": gin.H{"status": "processing"}})
}

// SplitDataset 从已有（已清洗）训练集按比例划分出测试集，仅生成一条测试集记录且直接可用
// POST /datasets/:id/split  Body: { "train_ratio": 0.8 }  (即测试集比例 = 1 - train_ratio)
func (h *DatasetHandler) SplitDataset(c *gin.Context) {
	id := c.Param("id")
	var datasetID int
	if _, err := fmt.Sscanf(id, "%d", &datasetID); err != nil {
		c.JSON(400, gin.H{"code": 400, "message": "Invalid dataset id"})
		return
	}
	dataset, err := models.GetDatasetByID(h.db, datasetID)
	if err != nil || dataset == nil {
		c.JSON(404, gin.H{"code": 404, "message": "Dataset not found"})
		return
	}
	if dataset.Status != "ready" {
		c.JSON(400, gin.H{"code": 400, "message": "仅支持从「清洗完成」的数据集划分，请先完成该数据集的清洗"})
		return
	}
	trainRatio := "0.8"
	if body := struct {
		TrainRatio float64 `json:"train_ratio"`
	}{}; c.ShouldBindJSON(&body) == nil && body.TrainRatio > 0 && body.TrainRatio < 1 {
		trainRatio = fmt.Sprintf("%.2f", body.TrainRatio)
	}

	var inputPath string
	tryPath := func(p string) bool {
		if p == "" {
			return false
		}
		if _, e := os.Stat(p); e == nil {
			inputPath = p
			return true
		}
		under := filepath.Join(h.uploadDir, filepath.Base(p))
		if _, e := os.Stat(under); e == nil {
			inputPath = under
			return true
		}
		return false
	}
	if dataset.CleanedFilePath.Valid && tryPath(dataset.CleanedFilePath.String) {
	} else if dataset.OriginalFilePath.Valid && tryPath(dataset.OriginalFilePath.String) {
	} else {
		c.JSON(400, gin.H{"code": 400, "message": "Dataset file not found on disk"})
		return
	}

	result, err := h.dataAgent.SplitDataset(inputPath, trainRatio, h.uploadDir)
	if err != nil {
		c.JSON(400, gin.H{"code": 400, "message": fmt.Sprintf("划分失败: %v", err)})
		return
	}

	baseName := dataset.Name
	if baseName == "" {
		baseName = fmt.Sprintf("数据集%d", datasetID)
	}
	testName := baseName + "-测试集"
	userID := 1
	if dataset.UserID > 0 {
		userID = dataset.UserID
	}

	testDS := &models.Dataset{
		UserID:            userID,
		Name:              testName,
		Type:              dataset.Type,
		Usage:             "test",
		Source:            dataset.Source,
		OriginalFilePath:  sql.NullString{String: result.TestPath, Valid: true},
		FileSize:          sql.NullInt64{Int64: 0, Valid: false},
		Status:            "uploading",
	}
	if err := testDS.Create(h.db); err != nil {
		c.JSON(500, gin.H{"code": 500, "message": fmt.Sprintf("创建测试集记录失败: %v", err)})
		return
	}

	// 划分结果与源数据同格式，直接标记为可用，不跑清洗
	columnCount := 0
	if dataset.ColumnCount.Valid {
		columnCount = int(dataset.ColumnCount.Int64)
	}
	_, _ = h.db.Exec(`
		UPDATE datasets SET cleaned_file_path = $1, row_count = $2, column_count = $3, status = 'ready', updated_at = NOW() WHERE id = $4
	`, result.TestPath, result.TestCount, columnCount, testDS.ID)

	c.JSON(200, gin.H{
		"code":    200,
		"message": "success",
		"data": gin.H{
			"test_dataset_id": testDS.ID,
			"test_count":      result.TestCount,
		},
	})
}

// DeleteDataset deletes a dataset by ID (record only; files may remain on disk).
// DELETE /datasets/:id
func (h *DatasetHandler) DeleteDataset(c *gin.Context) {
	id := c.Param("id")
	var datasetID int
	if _, err := fmt.Sscanf(id, "%d", &datasetID); err != nil {
		c.JSON(400, gin.H{"code": 400, "message": "Invalid dataset id"})
		return
	}
	res, err := h.db.Exec("DELETE FROM datasets WHERE id = $1", datasetID)
	if err != nil {
		c.JSON(500, gin.H{"code": 500, "message": fmt.Sprintf("Failed to delete: %v", err)})
		return
	}
	rows, _ := res.RowsAffected()
	// 幂等：记录不存在时也返回 200，避免前端因缓存或已删除而报 404
	if rows == 0 {
		c.JSON(200, gin.H{"code": 200, "message": "success"})
		return
	}
	c.JSON(200, gin.H{"code": 200, "message": "success"})
}
