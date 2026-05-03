package handlers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"mcp-training-system/internal/agents"
	"mcp-training-system/internal/mcp"
	"mcp-training-system/internal/models"
	"mcp-training-system/internal/services"
	"mcp-training-system/internal/utils"
)

func nullString(s string) sql.NullString {
	return sql.NullString{String: s, Valid: strings.TrimSpace(s) != ""}
}

func nullInt64(n int64) sql.NullInt64 {
	return sql.NullInt64{Int64: n, Valid: true}
}

// DatasetHandler handles dataset-related requests.
type DatasetHandler struct {
	db        *sql.DB
	dataAgent *agents.DataAgent
	uploadDir string
	analyzer  *services.AnthropicDatasetAnalyzer
	mcpStore  *mcp.Store
}

// NewDatasetHandler creates a new dataset handler.
func NewDatasetHandler(db *sql.DB, dataAgent *agents.DataAgent, uploadDir string, mcpStore *mcp.Store) *DatasetHandler {
	return &DatasetHandler{
		db:        db,
		dataAgent: dataAgent,
		uploadDir: uploadDir,
		analyzer:  services.NewAnthropicDatasetAnalyzer(),
		mcpStore:  mcpStore,
	}
}

// UploadDataset uploads one dataset file.
//
// Input (multipart/form-data):
// - file: uploaded file (.csv/.json)
// - name: dataset display name
// - type: dataset type (e.g. text)
// - usage: training|test (optional, default training)
//
// Output:
//
//	{
//	  "code": 200,
//	  "message": "success",
//	  "data": {
//	    "dataset_id": 123,
//	    "status": "uploading",
//	    "ai_analysis": {...} | null,
//	    "analysis_error": "..." // optional, when AI analyze failed
//	  }
//	}
func (h *DatasetHandler) UploadDataset(c *gin.Context) {
	sessionID := extractSessionID(c, "")

	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(400, gin.H{"code": 400, "message": "No file uploaded"})
		return
	}

	name := strings.TrimSpace(c.PostForm("name"))
	if name == "" {
		name = file.Filename
	}
	dataType := strings.TrimSpace(c.PostForm("type"))
	if dataType == "" {
		dataType = "text"
	}

	ext := strings.ToLower(filepath.Ext(file.Filename))
	if ext != ".csv" && ext != ".json" {
		c.JSON(400, gin.H{"code": 400, "message": "Only CSV and JSON files are allowed"})
		return
	}
	if file.Size > 100*1024*1024 {
		c.JSON(400, gin.H{"code": 400, "message": "File size exceeds 100MB"})
		return
	}

	src, err := file.Open()
	if err != nil {
		c.JSON(500, gin.H{"code": 500, "message": "Failed to open file"})
		return
	}
	defer src.Close()

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
			msg = "Database column usage is missing, please run migration 008"
		}
		c.JSON(500, gin.H{"code": 500, "message": msg})
		return
	}

	var aiAnalysis *services.DatasetAIAnalysis
	analysisError := ""
	if ext == ".csv" {
		columns, rows, err := utils.ReadCSVPreview(filePath, 10)
		if err != nil {
			analysisError = fmt.Sprintf("failed to read csv preview: %v", err)
		} else if len(columns) == 0 {
			analysisError = "csv header is empty"
		} else if h.analyzer == nil || !h.analyzer.Enabled() {
			analysisError = "ANTHROPIC_API_KEY is not configured"
		} else {
			analysis, err := h.analyzer.AnalyzeCSVSample(columns, rows)
			if err != nil {
				analysisError = err.Error()
			} else {
				raw, _ := json.Marshal(analysis)
				if err := models.UpdateDatasetAIAnalysis(h.db, dataset.ID, raw); err != nil {
					analysisError = fmt.Sprintf("failed to save ai analysis: %v", err)
				} else {
					aiAnalysis = analysis
				}
			}
		}
	}

	if ext == ".csv" {
		go func(id int) {
			if err := h.dataAgent.CleanData(id, ""); err != nil {
				utils.Error("Failed to clean dataset %d: %v", id, err)
			}
		}(dataset.ID)
	} else {
		if err := models.SetDatasetReadyWithPath(h.db, dataset.ID, filePath); err != nil {
			utils.Error("Failed to set dataset %d ready with path: %v", dataset.ID, err)
		}
	}

	respData := gin.H{
		"dataset_id":  dataset.ID,
		"status":      "uploading",
		"ai_analysis": aiAnalysis,
	}
	if sessionID != "" && h.mcpStore != nil {
		labelColumn := ""
		textColumn := ""
		numClasses := 0
		taskType := ""
		domain := ""
		if aiAnalysis != nil {
			taskType = aiAnalysis.TaskType
			domain = aiAnalysis.Domain
			if aiAnalysis.LabelColumn != nil {
				labelColumn = *aiAnalysis.LabelColumn
			}
			textColumn = aiAnalysis.TextColumn
			if aiAnalysis.NumClasses != nil {
				numClasses = *aiAnalysis.NumClasses
			}
		}
		_ = h.mcpStore.SaveContext(mcp.MCPContext{
			SessionID:   sessionID,
			DatasetID:   int64(dataset.ID),
			TaskType:    taskType,
			Domain:      domain,
			LabelColumn: labelColumn,
			TextColumn:  textColumn,
			NumClasses:  numClasses,
			Confirmed:   false,
		})
		respData["session_id"] = sessionID
	}
	if analysisError != "" {
		respData["analysis_error"] = analysisError
	}

	c.JSON(200, gin.H{
		"code":    200,
		"message": "success",
		"data":    respData,
	})
}

// ImportFromURL creates a dataset by fetching CSV/TSV from a URL.
// POST /datasets/from-url
// Body: { "name":"...", "url":"https://...", "type":"text", "usage":"training|test", "column_map": { "old":"new" } }
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
	if strings.TrimSpace(req.Name) == "" || strings.TrimSpace(req.URL) == "" {
		c.JSON(400, gin.H{"code": 400, "message": "name and url are required"})
		return
	}
	if strings.TrimSpace(req.Type) == "" {
		req.Type = "text"
	}
	if req.Usage != "training" && req.Usage != "test" {
		req.Usage = "training"
	}

	ext := strings.ToLower(filepath.Ext(req.URL))
	if ext != ".csv" && ext != ".tsv" {
		ext = ".csv"
	}

	filename := fmt.Sprintf("dataset_%d%s", utils.GetTimestamp(), ext)
	savePath := filepath.Join(h.uploadDir, filename)
	written, err := utils.FetchURLToFile(req.URL, savePath, 100*1024*1024)
	if err != nil {
		c.JSON(400, gin.H{"code": 400, "message": fmt.Sprintf("Fetch URL failed: %v", err)})
		return
	}
	if len(req.ColumnMap) > 0 && ext == ".csv" {
		if err := utils.RenameCSVColumns(savePath, req.ColumnMap); err != nil {
			_ = os.Remove(savePath)
			c.JSON(400, gin.H{"code": 400, "message": fmt.Sprintf("Rename columns failed: %v", err)})
			return
		}
	}

	dataset := &models.Dataset{
		UserID:           1,
		Name:             strings.TrimSpace(req.Name),
		Type:             strings.TrimSpace(req.Type),
		Usage:            req.Usage,
		Source:           sql.NullString{String: strings.TrimSpace(req.URL), Valid: true},
		OriginalFilePath: sql.NullString{String: savePath, Valid: true},
		FileSize:         nullInt64(written),
		Status:           "uploading",
	}
	if err := dataset.Create(h.db); err != nil {
		msg := fmt.Sprintf("Failed to create dataset: %v", err)
		if strings.Contains(err.Error(), "usage") && strings.Contains(err.Error(), "does not exist") {
			msg = "Database column usage is missing, please run migration 008"
		}
		c.JSON(500, gin.H{"code": 500, "message": msg})
		return
	}

	go func(id int) {
		if err := h.dataAgent.CleanData(id, ""); err != nil {
			utils.Error("Failed to clean dataset %d (from URL): %v", id, err)
		}
	}(dataset.ID)

	c.JSON(200, gin.H{
		"code":    200,
		"message": "success",
		"data": gin.H{
			"dataset_id": dataset.ID,
			"status":     "uploading",
		},
	})
}

// GetDatasets returns datasets optionally filtered by usage=training|test.
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

// GetDatasetDetail returns dataset details.
func (h *DatasetHandler) GetDatasetDetail(c *gin.Context) {
	var datasetID int
	if _, err := fmt.Sscanf(c.Param("id"), "%d", &datasetID); err != nil {
		c.JSON(400, gin.H{"code": 400, "message": "Invalid dataset id"})
		return
	}
	dataset, err := models.GetDatasetByID(h.db, datasetID)
	if err != nil || dataset == nil {
		c.JSON(404, gin.H{"code": 404, "message": "Dataset not found"})
		return
	}
	c.JSON(200, gin.H{"code": 200, "message": "success", "data": dataset})
}

// GetDatasetPreview returns first N rows for preview.
// GET /datasets/:id/preview?limit=100
func (h *DatasetHandler) GetDatasetPreview(c *gin.Context) {
	var datasetID int
	if _, err := fmt.Sscanf(c.Param("id"), "%d", &datasetID); err != nil {
		c.JSON(400, gin.H{"code": 400, "message": "Invalid dataset id"})
		return
	}
	dataset, err := models.GetDatasetByID(h.db, datasetID)
	if err != nil || dataset == nil {
		c.JSON(404, gin.H{"code": 404, "message": "Dataset not found"})
		return
	}

	filePath, ok := h.resolveDatasetPath(dataset)
	if !ok {
		c.JSON(404, gin.H{"code": 404, "message": "Dataset file not found on disk"})
		return
	}

	limit := 100
	if l := strings.TrimSpace(c.Query("limit")); l != "" {
		var parsed int
		if _, err := fmt.Sscanf(l, "%d", &parsed); err == nil && parsed > 0 && parsed <= 1000 {
			limit = parsed
		}
	}
	columns, rows, err := utils.ReadFilePreview(filePath, limit)
	if err != nil {
		c.JSON(500, gin.H{"code": 500, "message": fmt.Sprintf("Failed to read file preview: %v", err)})
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

// AnalyzeDataset calls Data Agent to analyze a cleaned dataset.
// POST /datasets/:id/analyze
func (h *DatasetHandler) AnalyzeDataset(c *gin.Context) {
	var datasetID int
	if _, err := fmt.Sscanf(c.Param("id"), "%d", &datasetID); err != nil {
		c.JSON(400, gin.H{"code": 400, "message": "Invalid dataset id"})
		return
	}
	dataset, err := models.GetDatasetByID(h.db, datasetID)
	if err != nil || dataset == nil {
		c.JSON(404, gin.H{"code": 404, "message": "Dataset not found"})
		return
	}
	if dataset.Status != "ready" {
		c.JSON(400, gin.H{"code": 400, "message": "Only ready datasets can be analyzed"})
		return
	}
	result, err := h.dataAgent.AnalyzeData(datasetID)
	if err != nil {
		c.JSON(400, gin.H{"code": 400, "message": err.Error()})
		return
	}
	c.JSON(200, gin.H{"code": 200, "message": "success", "data": result})
}

// ConfirmDatasetAnalysis confirms/corrects AI inferred task info.
//
// Input:
// POST /datasets/:id/confirm-analysis
//
//	{
//	  "confirmed_task_type": "text_classification|text_generation|named_entity_recognition|summarization|sentiment_analysis|other",
//	  "confirmed_domain": "general|finance|medical|legal|ecommerce|other"
//	}
//
// Output:
//
//	{
//	  "code": 200,
//	  "message": "success",
//	  "data": {
//	    "dataset_id": 123,
//	    "confirmed_task_type": "...",
//	    "confirmed_domain": "..."
//	  }
//	}
func (h *DatasetHandler) ConfirmDatasetAnalysis(c *gin.Context) {
	var datasetID int
	if _, err := fmt.Sscanf(c.Param("id"), "%d", &datasetID); err != nil {
		c.JSON(400, gin.H{"code": 400, "message": "Invalid dataset id"})
		return
	}

	var req struct {
		ConfirmedTaskType string `json:"confirmed_task_type"`
		ConfirmedDomain   string `json:"confirmed_domain"`
		SessionID         string `json:"session_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"code": 400, "message": "Invalid request body"})
		return
	}
	req.ConfirmedTaskType = strings.ToLower(strings.TrimSpace(req.ConfirmedTaskType))
	req.ConfirmedDomain = strings.ToLower(strings.TrimSpace(req.ConfirmedDomain))
	req.SessionID = strings.TrimSpace(req.SessionID)
	if !isAllowedTaskType(req.ConfirmedTaskType) {
		c.JSON(400, gin.H{"code": 400, "message": "Invalid confirmed_task_type"})
		return
	}
	if !isAllowedDomain(req.ConfirmedDomain) {
		c.JSON(400, gin.H{"code": 400, "message": "Invalid confirmed_domain"})
		return
	}

	dataset, err := models.GetDatasetByID(h.db, datasetID)
	if err != nil || dataset == nil {
		c.JSON(404, gin.H{"code": 404, "message": "Dataset not found"})
		return
	}

	merged := map[string]interface{}{}
	if len(dataset.AIAnalysis) > 0 {
		_ = json.Unmarshal(dataset.AIAnalysis, &merged)
	}
	merged["confirmed_task_type"] = req.ConfirmedTaskType
	merged["confirmed_domain"] = req.ConfirmedDomain
	merged["confirmed_at"] = time.Now().Format(time.RFC3339)

	raw, err := json.Marshal(merged)
	if err != nil {
		c.JSON(500, gin.H{"code": 500, "message": fmt.Sprintf("Failed to encode confirmed analysis: %v", err)})
		return
	}
	if err := models.UpdateDatasetAIAnalysis(h.db, datasetID, raw); err != nil {
		c.JSON(500, gin.H{"code": 500, "message": fmt.Sprintf("Failed to save confirmed analysis: %v", err)})
		return
	}
	sessionID := extractSessionID(c, req.SessionID)
	if sessionID != "" && h.mcpStore != nil {
		labelColumn := ""
		textColumn := ""
		numClasses := 0
		var parsed services.DatasetAIAnalysis
		if len(dataset.AIAnalysis) > 0 {
			_ = json.Unmarshal(dataset.AIAnalysis, &parsed)
			if parsed.LabelColumn != nil {
				labelColumn = *parsed.LabelColumn
			}
			textColumn = parsed.TextColumn
			if parsed.NumClasses != nil {
				numClasses = *parsed.NumClasses
			}
		}
		_ = h.mcpStore.UpdateContext(sessionID, map[string]interface{}{
			"dataset_id":   int64(datasetID),
			"task_type":    req.ConfirmedTaskType,
			"domain":       req.ConfirmedDomain,
			"label_column": labelColumn,
			"text_column":  textColumn,
			"num_classes":  numClasses,
			"confirmed":    true,
		})
	}

	c.JSON(200, gin.H{
		"code":    200,
		"message": "success",
		"data": gin.H{
			"dataset_id":          datasetID,
			"confirmed_task_type": req.ConfirmedTaskType,
			"confirmed_domain":    req.ConfirmedDomain,
			"session_id":          sessionID,
		},
	})
}

// RetryCleanDataset retries cleaning for dataset in error state.
// POST /datasets/:id/retry-clean
func (h *DatasetHandler) RetryCleanDataset(c *gin.Context) {
	var datasetID int
	if _, err := fmt.Sscanf(c.Param("id"), "%d", &datasetID); err != nil {
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
	if _, err := h.db.Exec(`UPDATE datasets SET status='processing', error_message=NULL, updated_at=NOW() WHERE id=$1`, datasetID); err != nil {
		c.JSON(500, gin.H{"code": 500, "message": fmt.Sprintf("Failed to update status: %v", err)})
		return
	}
	go func(id int) {
		if err := h.dataAgent.CleanData(id, ""); err != nil {
			utils.Error("Retry clean failed for dataset %d: %v", id, err)
		}
	}(datasetID)
	c.JSON(200, gin.H{"code": 200, "message": "success", "data": gin.H{"status": "processing"}})
}

// SplitDataset splits a ready dataset into train/test by ratio and creates a test dataset record.
// POST /datasets/:id/split body: { "train_ratio": 0.8 }
func (h *DatasetHandler) SplitDataset(c *gin.Context) {
	var datasetID int
	if _, err := fmt.Sscanf(c.Param("id"), "%d", &datasetID); err != nil {
		c.JSON(400, gin.H{"code": 400, "message": "Invalid dataset id"})
		return
	}
	dataset, err := models.GetDatasetByID(h.db, datasetID)
	if err != nil || dataset == nil {
		c.JSON(404, gin.H{"code": 404, "message": "Dataset not found"})
		return
	}
	if dataset.Status != "ready" {
		c.JSON(400, gin.H{"code": 400, "message": "Only ready datasets can be split"})
		return
	}

	trainRatio := "0.8"
	var req struct {
		TrainRatio float64 `json:"train_ratio"`
	}
	if c.ShouldBindJSON(&req) == nil && req.TrainRatio > 0 && req.TrainRatio < 1 {
		trainRatio = fmt.Sprintf("%.2f", req.TrainRatio)
	}

	inputPath, ok := h.resolveDatasetPath(dataset)
	if !ok {
		c.JSON(400, gin.H{"code": 400, "message": "Dataset file not found on disk"})
		return
	}

	result, err := h.dataAgent.SplitDataset(inputPath, trainRatio, h.uploadDir)
	if err != nil {
		c.JSON(400, gin.H{"code": 400, "message": fmt.Sprintf("Split dataset failed: %v", err)})
		return
	}

	baseName := strings.TrimSpace(dataset.Name)
	if baseName == "" {
		baseName = fmt.Sprintf("dataset_%d", datasetID)
	}
	testName := baseName + "-test"
	userID := dataset.UserID
	if userID <= 0 {
		userID = 1
	}

	testDS := &models.Dataset{
		UserID:           userID,
		Name:             testName,
		Type:             dataset.Type,
		Usage:            "test",
		Source:           dataset.Source,
		OriginalFilePath: sql.NullString{String: result.TestPath, Valid: true},
		FileSize:         sql.NullInt64{Valid: false},
		Status:           "uploading",
	}
	if err := testDS.Create(h.db); err != nil {
		c.JSON(500, gin.H{"code": 500, "message": fmt.Sprintf("Failed to create test dataset: %v", err)})
		return
	}

	columnCount := 0
	if dataset.ColumnCount.Valid {
		columnCount = int(dataset.ColumnCount.Int64)
	}
	_, _ = h.db.Exec(`
		UPDATE datasets
		SET cleaned_file_path = $1, row_count = $2, column_count = $3, status = 'ready',
		    derived_from_dataset_id = $5, updated_at = NOW()
		WHERE id = $4
	`, result.TestPath, result.TestCount, columnCount, testDS.ID, datasetID)

	c.JSON(200, gin.H{
		"code":    200,
		"message": "success",
		"data": gin.H{
			"test_dataset_id": testDS.ID,
			"test_count":      result.TestCount,
		},
	})
}

// DeleteDataset deletes one dataset record by ID.
// DELETE /datasets/:id
func (h *DatasetHandler) DeleteDataset(c *gin.Context) {
	var datasetID int
	if _, err := fmt.Sscanf(c.Param("id"), "%d", &datasetID); err != nil {
		c.JSON(400, gin.H{"code": 400, "message": "Invalid dataset id"})
		return
	}
	res, err := h.db.Exec("DELETE FROM datasets WHERE id = $1", datasetID)
	if err != nil {
		c.JSON(500, gin.H{"code": 500, "message": fmt.Sprintf("Failed to delete: %v", err)})
		return
	}
	if rows, _ := res.RowsAffected(); rows == 0 {
		c.JSON(200, gin.H{"code": 200, "message": "success"})
		return
	}
	c.JSON(200, gin.H{"code": 200, "message": "success"})
}

// UpdateDatasetName updates dataset name.
// PATCH /datasets/:id body: { "name": "new name" }
func (h *DatasetHandler) UpdateDatasetName(c *gin.Context) {
	var datasetID int
	if _, err := fmt.Sscanf(c.Param("id"), "%d", &datasetID); err != nil {
		c.JSON(400, gin.H{"code": 400, "message": "Invalid dataset id"})
		return
	}
	var req struct {
		Name string `json:"name"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"code": 400, "message": "Invalid request body"})
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		c.JSON(400, gin.H{"code": 400, "message": "Name cannot be empty"})
		return
	}
	if err := models.UpdateDatasetName(h.db, datasetID, name); err != nil {
		c.JSON(500, gin.H{"code": 500, "message": fmt.Sprintf("Failed to update name: %v", err)})
		return
	}
	c.JSON(200, gin.H{"code": 200, "message": "success"})
}

// BulkDeleteDatasets deletes datasets in batch.
// POST /datasets/bulk-delete body: { "ids": [1,2,3] }
func (h *DatasetHandler) BulkDeleteDatasets(c *gin.Context) {
	var req struct {
		IDs []int `json:"ids"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || len(req.IDs) == 0 {
		c.JSON(400, gin.H{"code": 400, "message": "ids is required"})
		return
	}
	deleted := 0
	for _, id := range req.IDs {
		res, err := h.db.Exec("DELETE FROM datasets WHERE id = $1", id)
		if err != nil {
			continue
		}
		if n, _ := res.RowsAffected(); n > 0 {
			deleted++
		}
	}
	c.JSON(200, gin.H{"code": 200, "message": "success", "data": gin.H{"deleted": deleted}})
}

func (h *DatasetHandler) resolveDatasetPath(dataset *models.Dataset) (string, bool) {
	tryPath := func(pathValue string) (string, bool) {
		p := strings.TrimSpace(pathValue)
		if p == "" {
			return "", false
		}
		if _, err := os.Stat(p); err == nil {
			return p, true
		}
		underUpload := filepath.Join(h.uploadDir, filepath.Base(p))
		if _, err := os.Stat(underUpload); err == nil {
			return underUpload, true
		}
		return "", false
	}

	if dataset.CleanedFilePath.Valid {
		if p, ok := tryPath(dataset.CleanedFilePath.String); ok {
			return p, true
		}
	}
	if dataset.OriginalFilePath.Valid {
		if p, ok := tryPath(dataset.OriginalFilePath.String); ok {
			return p, true
		}
	}
	return "", false
}

func isAllowedTaskType(v string) bool {
	switch v {
	case "text_classification", "text_generation", "named_entity_recognition", "summarization", "sentiment_analysis", "other":
		return true
	default:
		return false
	}
}

func isAllowedDomain(v string) bool {
	switch v {
	case "general", "finance", "medical", "legal", "ecommerce", "other":
		return true
	default:
		return false
	}
}

// AnalyzeDatasetForAgent runs Data Agent full analysis chain for Agent 版：
// deterministic script + template matching + optional LLM explanation.
// POST /agent/datasets/:id/analyze
func (h *DatasetHandler) AnalyzeDatasetForAgent(c *gin.Context) {
	var datasetID int
	if _, err := fmt.Sscanf(c.Param("id"), "%d", &datasetID); err != nil {
		c.JSON(400, gin.H{"code": 400, "message": "Invalid dataset id"})
		return
	}
	dataset, err := models.GetDatasetByID(h.db, datasetID)
	if err != nil || dataset == nil {
		c.JSON(404, gin.H{"code": 404, "message": "Dataset not found"})
		return
	}
	if dataset.Status != "ready" {
		c.JSON(400, gin.H{"code": 400, "message": "Only ready datasets can be analyzed"})
		return
	}

	sessionID := extractSessionID(c, "")
	ph1 := 1
	if sessionID != "" && h.mcpStore != nil {
		_, _ = h.mcpStore.AppendSessionEvent(sessionID, mcp.SessionEvent{
			Kind:  mcp.SessionEventSystem,
			Phase: &ph1,
			Text:  fmt.Sprintf("状态：数据分析阶段 · 开始对数据集 #%d 执行 Data Agent 分析链", datasetID),
		})
	}

	reqMsg := mcp.NewRequest("orchestrator", "data-agent", "analyze_data", map[string]interface{}{
		"dataset_id": float64(datasetID),
	})
	report, err := h.dataAgent.BuildDataReport(datasetID)
	if err != nil {
		if sessionID != "" && h.mcpStore != nil {
			respErr := mcp.NewResponse("data-agent", "orchestrator", "analyze_data", map[string]interface{}{
				"status": "error",
				"error":  err.Error(),
			})
			h.mcpStore.AppendMCPPair(sessionID, 1, reqMsg, respErr, err.Error())
		}
		c.JSON(400, gin.H{"code": 400, "message": err.Error()})
		return
	}
	if sessionID != "" && h.mcpStore != nil {
		tt, _ := report["task_type"].(string)
		tb, _ := report["trainability"].(string)
		respOk := mcp.NewResponse("data-agent", "orchestrator", "analyze_data", map[string]interface{}{
			"status":         "success",
			"dataset_id":     float64(datasetID),
			"task_type":      tt,
			"trainability":   tb,
		})
		h.mcpStore.AppendMCPPair(sessionID, 1, reqMsg, respOk, "")
		_, _ = h.mcpStore.AppendSessionEvent(sessionID, mcp.SessionEvent{
			Kind:  mcp.SessionEventSystem,
			Phase: &ph1,
			Text:  "状态：数据分析完成 · Data Agent 报告已写入数据集记录",
		})
	}

	if raw, mErr := json.Marshal(report); mErr == nil {
		_ = models.UpdateDatasetAgentDataReport(h.db, datasetID, raw)
	}

	c.JSON(200, gin.H{"code": 200, "message": "success", "data": report})
}

// GetDatasetAgentReport returns saved Agent Data report without re-analysis.
// GET /agent/datasets/:id/report
func (h *DatasetHandler) GetDatasetAgentReport(c *gin.Context) {
	var datasetID int
	if _, err := fmt.Sscanf(c.Param("id"), "%d", &datasetID); err != nil {
		c.JSON(400, gin.H{"code": 400, "message": "Invalid dataset id"})
		return
	}

	dataset, err := models.GetDatasetByID(h.db, datasetID)
	if err != nil || dataset == nil {
		c.JSON(404, gin.H{"code": 404, "message": "Dataset not found"})
		return
	}

	raw, err := models.GetDatasetAgentDataReport(h.db, datasetID)
	if err != nil {
		c.JSON(500, gin.H{"code": 500, "message": fmt.Sprintf("Failed to get agent report: %v", err)})
		return
	}

	if len(raw) == 0 {
		c.JSON(200, gin.H{"code": 200, "message": "success", "data": nil})
		return
	}

	var payload interface{}
	if err := json.Unmarshal(raw, &payload); err != nil {
		c.JSON(500, gin.H{"code": 500, "message": fmt.Sprintf("Failed to decode agent report: %v", err)})
		return
	}
	c.JSON(200, gin.H{"code": 200, "message": "success", "data": payload})
}
