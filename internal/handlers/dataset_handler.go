package handlers

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

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

	// Create dataset record (nullable fields use NullString/NullInt64 for DB)
	dataset := &models.Dataset{
		UserID:           1,
		Name:             name,
		Type:             dataType,
		Source:           nullString("local"),
		OriginalFilePath: sql.NullString{String: filePath, Valid: true},
		FileSize:         nullInt64(file.Size),
		Status:           "uploading",
	}

	if err := dataset.Create(h.db); err != nil {
		c.JSON(500, gin.H{"code": 500, "message": fmt.Sprintf("Failed to create dataset: %v", err)})
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
// POST /datasets/from-url  Body: JSON { "name": "...", "url": "https://...", "type": "text", "column_map": {"tweet":"text"} }
func (h *DatasetHandler) ImportFromURL(c *gin.Context) {
	var req struct {
		Name      string            `json:"name"`
		URL       string            `json:"url"`
		Type      string            `json:"type"`
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

	utils.Info("Importing dataset from URL: %s", req.URL)

	filename := fmt.Sprintf("dataset_%d.csv", utils.GetTimestamp())
	savePath := filepath.Join(h.uploadDir, filename)
	written, err := utils.FetchURLToFile(req.URL, savePath, 100*1024*1024)
	if err != nil {
		c.JSON(400, gin.H{"code": 400, "message": fmt.Sprintf("Failed to fetch URL: %v", err)})
		return
	}

	if len(req.ColumnMap) > 0 {
		if err := utils.RenameCSVColumns(savePath, req.ColumnMap); err != nil {
			os.Remove(savePath)
			c.JSON(400, gin.H{"code": 400, "message": fmt.Sprintf("Failed to rename columns: %v", err)})
			return
		}
	}

	dataset := &models.Dataset{
		UserID:           1,
		Name:             req.Name,
		Type:             req.Type,
		Source:           sql.NullString{String: req.URL, Valid: true},
		OriginalFilePath: sql.NullString{String: savePath, Valid: true},
		FileSize:         nullInt64(written),
		Status:           "uploading",
	}
	if err := dataset.Create(h.db); err != nil {
		c.JSON(500, gin.H{"code": 500, "message": fmt.Sprintf("Failed to create dataset: %v", err)})
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

// GetDatasets returns all datasets
func (h *DatasetHandler) GetDatasets(c *gin.Context) {
	datasets, err := models.GetDatasetsByUserID(h.db, 1) // Default user
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

// SplitDataset 从已有数据集按比例划分出训练集与测试集，创建两条新数据集记录并触发清洗
// POST /datasets/:id/split  Body: { "train_ratio": 0.8 }  (可选，默认 0.8)
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
	trainRatio := "0.8"
	onlyTest := false
	if body := struct {
		TrainRatio float64 `json:"train_ratio"`
		OnlyTest   bool    `json:"only_test"`
	}{}; c.ShouldBindJSON(&body) == nil {
		if body.TrainRatio > 0 && body.TrainRatio < 1 {
			trainRatio = fmt.Sprintf("%.2f", body.TrainRatio)
		}
		onlyTest = body.OnlyTest
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
	trainName := baseName + "-训练集"
	testName := baseName + "-测试集"
	userID := 1
	if dataset.UserID > 0 {
		userID = dataset.UserID
	}

	var trainDS *models.Dataset
	if !onlyTest {
		trainDS = &models.Dataset{
			UserID:            userID,
			Name:              trainName,
			Type:              dataset.Type,
			Source:            dataset.Source,
			OriginalFilePath:  sql.NullString{String: result.TrainPath, Valid: true},
			FileSize:          sql.NullInt64{Int64: 0, Valid: false},
			Status:            "uploading",
		}
		if err := trainDS.Create(h.db); err != nil {
			c.JSON(500, gin.H{"code": 500, "message": fmt.Sprintf("创建训练集记录失败: %v", err)})
			return
		}
	}
	testDS := &models.Dataset{
		UserID:            userID,
		Name:              testName,
		Type:              dataset.Type,
		Source:            dataset.Source,
		OriginalFilePath:  sql.NullString{String: result.TestPath, Valid: true},
		FileSize:          sql.NullInt64{Int64: 0, Valid: false},
		Status:            "uploading",
	}
	if err := testDS.Create(h.db); err != nil {
		c.JSON(500, gin.H{"code": 500, "message": fmt.Sprintf("创建测试集记录失败: %v", err)})
		return
	}

	if !onlyTest && trainDS != nil {
		go func() {
			_ = h.dataAgent.CleanData(trainDS.ID)
		}()
	}
	go func() {
		_ = h.dataAgent.CleanData(testDS.ID)
	}()

	respData := gin.H{
		"test_dataset_id": testDS.ID,
		"test_count":      result.TestCount,
	}
	if !onlyTest && trainDS != nil {
		respData["train_dataset_id"] = trainDS.ID
		respData["train_count"] = result.TrainCount
	}
	c.JSON(200, gin.H{
		"code":    200,
		"message": "success",
		"data":    respData,
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
