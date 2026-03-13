package agents

import (
	"database/sql"
	"fmt"
	"path/filepath"
	"time"

	"mcp-training-system/internal/models"
	"mcp-training-system/internal/utils"
)

// EvaluationAgent handles model evaluation operations
type EvaluationAgent struct {
	db        *sql.DB
	executor  *utils.PythonExecutor
	reportDir string
	baseDir   string // 项目根目录，用于将相对路径转为绝对路径供 Python 脚本使用
}

// NewEvaluationAgent creates a new evaluation agent. baseDir 用于解析相对路径（如 data/models/job_1）。
func NewEvaluationAgent(db *sql.DB, executor *utils.PythonExecutor, reportDir, baseDir string) *EvaluationAgent {
	if baseDir == "" {
		baseDir = "."
	}
	return &EvaluationAgent{
		db:        db,
		executor:  executor,
		reportDir: reportDir,
		baseDir:   baseDir,
	}
}

// Evaluate evaluates a trained model. If evaluationID > 0, updates that record on success; otherwise creates a new one.
func (a *EvaluationAgent) Evaluate(modelID int, testDatasetID int, evaluationID int) error {
	utils.Info("EvaluationAgent: Starting evaluation for model %d", modelID)

	// 1. Get model information
	model, err := models.GetModelByID(a.db, modelID)
	if err != nil {
		utils.Error("EvaluationAgent: Failed to get model: %v", err)
		return fmt.Errorf("failed to get model: %v", err)
	}

	// 2. Get test dataset path (may be NULL)
	var pathVal sql.NullString
	if testDatasetID > 0 {
		err = a.db.QueryRow(
			"SELECT cleaned_file_path FROM datasets WHERE id = $1 AND status = 'ready'",
			testDatasetID,
		).Scan(&pathVal)
		if err != nil {
			utils.Error("EvaluationAgent: Failed to get test dataset: %v", err)
			return fmt.Errorf("无法获取测试集（请确认所选测试集存在且状态为「就绪」）: %v", err)
		}
	} else {
		// 未指定测试集时，尝试使用该模型对应训练任务关联的数据集作为测试数据
		var jobDatasetID sql.NullInt64
		err = a.db.QueryRow("SELECT dataset_id FROM training_jobs WHERE id = $1", model.JobID).Scan(&jobDatasetID)
		if err != nil {
			utils.Error("EvaluationAgent: Failed to get job: %v", err)
			return fmt.Errorf("无法获取训练任务信息: %v", err)
		}
		if !jobDatasetID.Valid {
			msg := "未指定测试集，且该模型对应的训练数据集已删除。请先在「数据集管理」中准备一份测试集（或从训练集划分），在创建评估时选择该测试集。"
			if evaluationID > 0 {
				_ = models.UpdateEvaluationStatus(a.db, evaluationID, "failed", msg)
			}
			return fmt.Errorf("%s", msg)
		}
		err = a.db.QueryRow(`
			SELECT cleaned_file_path FROM datasets d
			JOIN training_jobs j ON j.dataset_id = d.id
			WHERE j.id = $1
		`, model.JobID).Scan(&pathVal)
		if err != nil {
			utils.Error("EvaluationAgent: Failed to get test data: %v", err)
			return fmt.Errorf("无法获取训练任务关联的数据集路径: %v", err)
		}
	}
	if !pathVal.Valid || pathVal.String == "" {
		msg := "测试集尚未就绪（无可用文件路径）。请确认所选测试集已上传并处理完成，或从训练集划分出一份测试集后再评估。"
		if evaluationID > 0 {
			_ = models.UpdateEvaluationStatus(a.db, evaluationID, "failed", msg)
		}
		return fmt.Errorf("%s", msg)
	}
	testDataPath := pathVal.String
	modelPath := model.ModelPath
	// 转为绝对路径，避免 Python 脚本因工作目录不同找不到文件
	if !filepath.IsAbs(modelPath) {
		modelPath = filepath.Join(a.baseDir, modelPath)
	}
	if !filepath.IsAbs(testDataPath) {
		testDataPath = filepath.Join(a.baseDir, testDataPath)
	}

	utils.Info("EvaluationAgent: Evaluating model at %s with data %s", modelPath, testDataPath)

	// 3. Call Python evaluation script (report_suffix for unique filenames; report_dir so output matches server)
	reportSuffix := fmt.Sprintf("%d_%d", modelID, time.Now().Unix())
	result, err := a.executor.Execute("evaluation/evaluate_model.py", modelPath, testDataPath, reportSuffix, a.reportDir)
	if err != nil {
		utils.Error("EvaluationAgent: Evaluation failed: %v", err)
		if evaluationID > 0 {
			_ = models.UpdateEvaluationStatus(a.db, evaluationID, "failed", err.Error())
		}
		return err
	}

	// 4. Check execution status
	if result["status"] != "success" {
		errMsg := fmt.Sprintf("%v", result["error_message"])
		utils.Error("EvaluationAgent: Evaluation failed: %s", errMsg)
		if evaluationID > 0 {
			_ = models.UpdateEvaluationStatus(a.db, evaluationID, "failed", errMsg)
		}
		return fmt.Errorf("evaluation failed: %s", errMsg)
	}

	// 5. Save evaluation results to database (with optional roc_curve_path and report_path)
	cmPath := getString(result, "confusion_matrix_path")
	rocPath := getString(result, "roc_curve_path")
	reportPath := getString(result, "report_path")

	accuracy := getFloat(result, "accuracy")
	precision := getFloat(result, "precision")
	recall := getFloat(result, "recall")
	f1Score := getFloat(result, "f1_score")
	metrics := make(map[string]interface{})
	if rocAuc, ok := result["roc_auc"]; ok {
		if v, ok := rocAuc.(float64); ok {
			metrics["roc_auc"] = v
		}
	}

	if evaluationID > 0 {
		if err := models.UpdateEvaluationResult(a.db, evaluationID, accuracy, precision, recall, f1Score, metrics, cmPath, rocPath, reportPath); err != nil {
			utils.Error("EvaluationAgent: Failed to update evaluation: %v", err)
			return err
		}
		utils.Info("EvaluationAgent: Evaluation completed for model %d, evaluation ID: %d", modelID, evaluationID)
		return nil
	}

	evaluation := &models.Evaluation{
		ModelID:             modelID,
		Accuracy:            accuracy,
		Precision:           precision,
		Recall:              recall,
		F1Score:             f1Score,
		Metrics:             metrics,
		ConfusionMatrixPath: cmPath,
		ROCCurvePath:        rocPath,
		ReportPath:          reportPath,
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
