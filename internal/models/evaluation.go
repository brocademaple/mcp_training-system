package models

import (
	"database/sql"
	"encoding/json"
	"time"
)

// Evaluation represents an evaluation result in the system
type Evaluation struct {
	ID                   int                    `json:"id"`
	ModelID              int                    `json:"model_id"`
	Accuracy             float64                `json:"accuracy"`
	Precision            float64                `json:"precision"`
	Recall               float64                `json:"recall"`
	F1Score              float64                `json:"f1_score"`
	Metrics              map[string]interface{} `json:"metrics"`
	ConfusionMatrixPath  string                 `json:"confusion_matrix_path"`
	ROCCurvePath         string                 `json:"roc_curve_path"`
	ReportPath           string                 `json:"report_path"`
	Status               string                 `json:"status"`        // running | completed | failed
	ErrorMessage         string                 `json:"error_message"` // 失败时原因
	CreatedAt            time.Time              `json:"created_at"`
}

// Create creates a new evaluation in the database
func (e *Evaluation) Create(db *sql.DB) error {
	// Convert metrics to JSON
	metricsJSON, err := json.Marshal(e.Metrics)
	if err != nil {
		return err
	}
	status := e.Status
	if status == "" {
		status = "completed"
	}

	query := `
		INSERT INTO evaluations (model_id, accuracy, precision, recall, f1_score, metrics,
		                         confusion_matrix_path, roc_curve_path, report_path, status, error_message)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		RETURNING id, created_at
	`
	err = db.QueryRow(
		query,
		e.ModelID,
		e.Accuracy,
		e.Precision,
		e.Recall,
		e.F1Score,
		metricsJSON,
		e.ConfusionMatrixPath,
		e.ROCCurvePath,
		e.ReportPath,
		status,
		e.ErrorMessage,
	).Scan(&e.ID, &e.CreatedAt)

	return err
}

// GetByID retrieves an evaluation by ID
func GetEvaluationByID(db *sql.DB, id int) (*Evaluation, error) {
	eval := &Evaluation{}
	var metricsJSON []byte

	query := `
		SELECT id, model_id, accuracy, precision, recall, f1_score, metrics,
		       confusion_matrix_path, roc_curve_path, report_path, COALESCE(status,'completed'), error_message, created_at
		FROM evaluations WHERE id = $1
	`
	err := db.QueryRow(query, id).Scan(
		&eval.ID,
		&eval.ModelID,
		&eval.Accuracy,
		&eval.Precision,
		&eval.Recall,
		&eval.F1Score,
		&metricsJSON,
		&eval.ConfusionMatrixPath,
		&eval.ROCCurvePath,
		&eval.ReportPath,
		&eval.Status,
		&eval.ErrorMessage,
		&eval.CreatedAt,
	)
	if err != nil {
		return nil, err
	}

	// Parse metrics JSON
	if len(metricsJSON) > 0 {
		if err := json.Unmarshal(metricsJSON, &eval.Metrics); err != nil {
			return nil, err
		}
	}

	return eval, nil
}

// UpdateResult 更新已有评估记录的结果（评估完成后调用）
func UpdateEvaluationResult(db *sql.DB, id int, accuracy, precision, recall, f1Score float64, metrics map[string]interface{}, confusionMatrixPath, rocCurvePath, reportPath string) error {
	metricsJSON, _ := json.Marshal(metrics)
	if metricsJSON == nil {
		metricsJSON = []byte("{}")
	}
	_, err := db.Exec(`
		UPDATE evaluations
		SET accuracy = $1, precision = $2, recall = $3, f1_score = $4, metrics = $5,
		    confusion_matrix_path = $6, roc_curve_path = $7, report_path = $8, status = 'completed', error_message = NULL
		WHERE id = $9
	`, accuracy, precision, recall, f1Score, metricsJSON, confusionMatrixPath, rocCurvePath, reportPath, id)
	return err
}

// UpdateEvaluationStatus 将评估标记为失败并写入错误信息
func UpdateEvaluationStatus(db *sql.DB, id int, status, errorMsg string) error {
	_, err := db.Exec(`
		UPDATE evaluations SET status = $1, error_message = $2 WHERE id = $3
	`, status, errorMsg, id)
	return err
}

// GetEvaluationsAll returns all evaluations, newest first
func GetEvaluationsAll(db *sql.DB) ([]*Evaluation, error) {
	query := `
		SELECT id, model_id, accuracy, precision, recall, f1_score, metrics,
		       confusion_matrix_path, roc_curve_path, report_path, COALESCE(status,'completed'), error_message, created_at
		FROM evaluations
		ORDER BY created_at DESC
	`
	rows, err := db.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []*Evaluation
	for rows.Next() {
		e := &Evaluation{}
		var metricsJSON []byte
		if err := rows.Scan(
			&e.ID,
			&e.ModelID,
			&e.Accuracy,
			&e.Precision,
			&e.Recall,
			&e.F1Score,
			&metricsJSON,
			&e.ConfusionMatrixPath,
			&e.ROCCurvePath,
			&e.ReportPath,
			&e.Status,
			&e.ErrorMessage,
			&e.CreatedAt,
		); err != nil {
			return nil, err
		}
		if len(metricsJSON) > 0 {
			_ = json.Unmarshal(metricsJSON, &e.Metrics)
		}
		list = append(list, e)
	}
	return list, rows.Err()
}

// GetByModelID retrieves an evaluation by model ID
func GetEvaluationByModelID(db *sql.DB, modelID int) (*Evaluation, error) {
	eval := &Evaluation{}
	var metricsJSON []byte

	query := `
		SELECT id, model_id, accuracy, precision, recall, f1_score, metrics,
		       confusion_matrix_path, roc_curve_path, report_path, COALESCE(status,'completed'), error_message, created_at
		FROM evaluations WHERE model_id = $1
	`
	err := db.QueryRow(query, modelID).Scan(
		&eval.ID,
		&eval.ModelID,
		&eval.Accuracy,
		&eval.Precision,
		&eval.Recall,
		&eval.F1Score,
		&metricsJSON,
		&eval.ConfusionMatrixPath,
		&eval.ROCCurvePath,
		&eval.ReportPath,
		&eval.Status,
		&eval.ErrorMessage,
		&eval.CreatedAt,
	)
	if err != nil {
		return nil, err
	}

	// Parse metrics JSON
	if len(metricsJSON) > 0 {
		if err := json.Unmarshal(metricsJSON, &eval.Metrics); err != nil {
			return nil, err
		}
	}

	return eval, nil
}
