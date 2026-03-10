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

	// 1. Query database to get file path
	var filePath string
	err := a.db.QueryRow(
		"SELECT original_file_path FROM datasets WHERE id = $1",
		datasetID,
	).Scan(&filePath)
	if err != nil {
		utils.Error("DataAgent: Failed to query dataset: %v", err)
		return fmt.Errorf("failed to query dataset: %v", err)
	}

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

	// Query database to get cleaned file path
	var filePath string
	err := a.db.QueryRow(
		"SELECT cleaned_file_path FROM datasets WHERE id = $1",
		datasetID,
	).Scan(&filePath)
	if err != nil {
		utils.Error("DataAgent: Failed to query dataset: %v", err)
		return nil, fmt.Errorf("failed to query dataset: %v", err)
	}

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
