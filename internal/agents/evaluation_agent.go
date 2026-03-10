package agents

import (
	"database/sql"
	"fmt"
	"time"

	"mcp-training-system/internal/models"
	"mcp-training-system/internal/utils"
)

// EvaluationAgent handles model evaluation operations
type EvaluationAgent struct {
	db        *sql.DB
	executor  *utils.PythonExecutor
	reportDir string
}

// NewEvaluationAgent creates a new evaluation agent
func NewEvaluationAgent(db *sql.DB, executor *utils.PythonExecutor, reportDir string) *EvaluationAgent {
	return &EvaluationAgent{
		db:        db,
		executor:  executor,
		reportDir: reportDir,
	}
}

// Evaluate evaluates a trained model
func (a *EvaluationAgent) Evaluate(modelID int, testDatasetID int) error {
	utils.Info("EvaluationAgent: Starting evaluation for model %d", modelID)

	// 1. Get model information
	model, err := models.GetModelByID(a.db, modelID)
	if err != nil {
		utils.Error("EvaluationAgent: Failed to get model: %v", err)
		return fmt.Errorf("failed to get model: %v", err)
	}

	// 2. Get test dataset path
	var testDataPath string
	if testDatasetID > 0 {
		err = a.db.QueryRow(
			"SELECT cleaned_file_path FROM datasets WHERE id = $1",
			testDatasetID,
		).Scan(&testDataPath)
	} else {
		// Use training dataset if no test dataset provided
		err = a.db.QueryRow(`
			SELECT d.cleaned_file_path FROM datasets d
			JOIN training_jobs j ON j.dataset_id = d.id
			WHERE j.id = $1
		`, model.JobID).Scan(&testDataPath)
	}

	if err != nil {
		utils.Error("EvaluationAgent: Failed to get test data: %v", err)
		return fmt.Errorf("failed to get test data: %v", err)
	}

	utils.Info("EvaluationAgent: Evaluating model at %s with data %s", model.ModelPath, testDataPath)

	// 3. Call Python evaluation script (report_suffix for unique filenames; report_dir so output matches server)
	reportSuffix := fmt.Sprintf("%d_%d", modelID, time.Now().Unix())
	result, err := a.executor.Execute("evaluation/evaluate_model.py", model.ModelPath, testDataPath, reportSuffix, a.reportDir)
	if err != nil {
		utils.Error("EvaluationAgent: Evaluation failed: %v", err)
		return err
	}

	// 4. Check execution status
	if result["status"] != "success" {
		errMsg := fmt.Sprintf("%v", result["error_message"])
		utils.Error("EvaluationAgent: Evaluation failed: %s", errMsg)
		return fmt.Errorf("evaluation failed: %s", errMsg)
	}

	// 5. Save evaluation results to database (with optional roc_curve_path and report_path)
	cmPath := getString(result, "confusion_matrix_path")
	rocPath := getString(result, "roc_curve_path")
	reportPath := getString(result, "report_path")

	evaluation := &models.Evaluation{
		ModelID:             modelID,
		Accuracy:            getFloat(result, "accuracy"),
		Precision:           getFloat(result, "precision"),
		Recall:              getFloat(result, "recall"),
		F1Score:             getFloat(result, "f1_score"),
		ConfusionMatrixPath: cmPath,
		ROCCurvePath:        rocPath,
		ReportPath:          reportPath,
	}
	if rocAuc, ok := result["roc_auc"]; ok {
		if v, ok := rocAuc.(float64); ok {
			if evaluation.Metrics == nil {
				evaluation.Metrics = make(map[string]interface{})
			}
			evaluation.Metrics["roc_auc"] = v
		}
	}

	if err := evaluation.Create(a.db); err != nil {
		utils.Error("EvaluationAgent: Failed to save evaluation: %v", err)
		return err
	}

	utils.Info("EvaluationAgent: Evaluation completed for model %d, evaluation ID: %d", modelID, evaluation.ID)
	return nil
}

// GetEvaluationResult retrieves evaluation results
func (a *EvaluationAgent) GetEvaluationResult(evaluationID int) (*models.Evaluation, error) {
	return models.GetEvaluationByID(a.db, evaluationID)
}

func getString(m map[string]interface{}, key string) string {
	if v, ok := m[key]; ok && v != nil {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

func getFloat(m map[string]interface{}, key string) float64 {
	if v, ok := m[key]; ok && v != nil {
		switch x := v.(type) {
		case float64:
			return x
		case float32:
			return float64(x)
		}
	}
	return 0
}
