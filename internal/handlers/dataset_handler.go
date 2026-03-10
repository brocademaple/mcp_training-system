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

	// Create dataset record
	dataset := &models.Dataset{
		UserID:           1, // Default user
		Name:             name,
		Type:             dataType,
		Source:           "local",
		OriginalFilePath: filePath,
		FileSize:         file.Size,
		Status:           "uploading",
	}

	if err := dataset.Create(h.db); err != nil {
		c.JSON(500, gin.H{"code": 500, "message": fmt.Sprintf("Failed to create dataset: %v", err)})
		return
	}

	// Start cleaning in background for CSV files; JSON 则直接标记为 ready（暂不清洗）
	if ext == ".csv" {
		go func(id int) {
			if err := h.dataAgent.CleanData(id); err != nil {
				utils.Error("Failed to clean dataset %d: %v", id, err)
			}
		}(dataset.ID)
	} else {
		if err := models.UpdateDatasetStatus(h.db, dataset.ID, "ready", ""); err != nil {
			utils.Error("Failed to update dataset %d status to ready: %v", dataset.ID, err)
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
		Source:           req.URL,
		OriginalFilePath: savePath,
		FileSize:         written,
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
	if tryPath(dataset.CleanedFilePath) || tryPath(dataset.OriginalFilePath) {
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
