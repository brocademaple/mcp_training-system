package agents

import (
	"database/sql"
	"fmt"
	"mcp-training-system/internal/utils"
)

// DataAgent handles data processing operations
type DataAgent struct {
	db       *sql.DB
	executor *utils.PythonExecutor
}

// NewDataAgent creates a new data agent
func NewDataAgent(db *sql.DB, executor *utils.PythonExecutor) *DataAgent {
	return &DataAgent{
		db:       db,
		executor: executor,
	}
}

// CleanData cleans a dataset by removing duplicates and missing values
func (a *DataAgent) CleanData(datasetID int) error {
	utils.Info("DataAgent: Starting data cleaning for dataset %d", datasetID)

	// 1. Query database to get file path (may be NULL)
	var pathVal sql.NullString
	err := a.db.QueryRow(
		"SELECT original_file_path FROM datasets WHERE id = $1",
		datasetID,
	).Scan(&pathVal)
	if err != nil {
		utils.Error("DataAgent: Failed to query dataset: %v", err)
		return fmt.Errorf("failed to query dataset: %v", err)
	}
	if !pathVal.Valid || pathVal.String == "" {
		utils.Error("DataAgent: No original_file_path for dataset %d", datasetID)
		return fmt.Errorf("dataset has no file path")
	}
	filePath := pathVal.String
	utils.Info("DataAgent: Cleaning file: %s", filePath)

	// 2. Call Python script
	result, err := a.executor.Execute("data/clean_data.py", filePath)
	if err != nil {
		utils.Error("DataAgent: Python script failed: %v", err)
		// Update database with error
		a.db.Exec(
			"UPDATE datasets SET status = 'error', error_message = $1, updated_at = NOW() WHERE id = $2",
			err.Error(), datasetID,
		)
		return err
	}

	// 3. Check execution status
	if result["status"] != "success" {
		errMsg := fmt.Sprintf("%v", result["error_message"])
		utils.Error("DataAgent: Cleaning failed: %s", errMsg)
		a.db.Exec(
			"UPDATE datasets SET status = 'error', error_message = $1, updated_at = NOW() WHERE id = $2",
			errMsg, datasetID,
		)
		return fmt.Errorf("cleaning failed: %s", errMsg)
	}

	// 4. Update database with results
	cleanedRows := int(result["cleaned_rows"].(float64))
	columnCount := len(result["columns"].([]interface{}))
	outputPath := result["output_path"].(string)

	_, err = a.db.Exec(`
		UPDATE datasets
		SET cleaned_file_path = $1,
		    row_count = $2,
		    column_count = $3,
		    status = 'ready',
		    updated_at = NOW()
		WHERE id = $4
	`,
		outputPath,
		cleanedRows,
		columnCount,
		datasetID,
	)

	if err != nil {
		utils.Error("DataAgent: Failed to update database: %v", err)
		return fmt.Errorf("failed to update database: %v", err)
	}

	utils.Info("DataAgent: Data cleaning completed for dataset %d", datasetID)
	return nil
}

// AnalyzeData analyzes a dataset and returns statistics
func (a *DataAgent) AnalyzeData(datasetID int) (map[string]interface{}, error) {
	utils.Info("DataAgent: Starting data analysis for dataset %d", datasetID)

	// Query database to get cleaned file path (may be NULL)
	var pathVal sql.NullString
	err := a.db.QueryRow(
		"SELECT cleaned_file_path FROM datasets WHERE id = $1",
		datasetID,
	).Scan(&pathVal)
	if err != nil {
		utils.Error("DataAgent: Failed to query dataset: %v", err)
		return nil, fmt.Errorf("failed to query dataset: %v", err)
	}
	if !pathVal.Valid || pathVal.String == "" {
		return nil, fmt.Errorf("dataset has no cleaned file path (not ready yet)")
	}
	filePath := pathVal.String

	// Call Python script
	result, err := a.executor.Execute("data/analyze_data.py", filePath)
	if err != nil {
		utils.Error("DataAgent: Analysis failed: %v", err)
		return nil, err
	}

	// Check execution status
	if result["status"] != "success" {
		errMsg := fmt.Sprintf("%v", result["error_message"])
		utils.Error("DataAgent: Analysis failed: %s", errMsg)
		return nil, fmt.Errorf("analysis failed: %s", errMsg)
	}

	utils.Info("DataAgent: Data analysis completed for dataset %d", datasetID)
	return result, nil
}

// SplitDatasetResult 划分数据集脚本的返回
type SplitDatasetResult struct {
	TrainPath  string
	TestPath   string
	TrainCount int
	TestCount  int
}

// SplitDataset 从已有数据集中按比例划分训练集与测试集，写入 outputDir，返回两个文件路径与条数
func (a *DataAgent) SplitDataset(inputPath, trainRatio, outputDir string) (*SplitDatasetResult, error) {
	utils.Info("DataAgent: Splitting dataset %s with train_ratio=%s into %s", inputPath, trainRatio, outputDir)
	result, err := a.executor.Execute("data/split_dataset.py", inputPath, trainRatio, outputDir)
	if err != nil {
		return nil, err
	}
	if result["status"] != "success" {
		errMsg := "split failed"
		if em, ok := result["error_message"].(string); ok {
			errMsg = em
		}
		return nil, fmt.Errorf("%s", errMsg)
	}
	trainPath, _ := result["train_path"].(string)
	testPath, _ := result["test_path"].(string)
	if trainPath == "" || testPath == "" {
		return nil, fmt.Errorf("split script did not return train_path or test_path")
	}
	trainCount := 0
	testCount := 0
	if v, ok := result["train_count"].(float64); ok {
		trainCount = int(v)
	}
	if v, ok := result["test_count"].(float64); ok {
		testCount = int(v)
	}
	return &SplitDatasetResult{
		TrainPath:  trainPath,
		TestPath:   testPath,
		TrainCount: trainCount,
		TestCount:  testCount,
	}, nil
}
