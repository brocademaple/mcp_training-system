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
	CreatedAt            time.Time              `json:"created_at"`
}

// Create creates a new evaluation in the database
func (e *Evaluation) Create(db *sql.DB) error {
	// Convert metrics to JSON
	metricsJSON, err := json.Marshal(e.Metrics)
	if err != nil {
		return err
	}

	query := `
		INSERT INTO evaluations (model_id, accuracy, precision, recall, f1_score, metrics,
		                         confusion_matrix_path, roc_curve_path, report_path)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
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
	).Scan(&e.ID, &e.CreatedAt)

	return err
}

// GetByID retrieves an evaluation by ID
func GetEvaluationByID(db *sql.DB, id int) (*Evaluation, error) {
	eval := &Evaluation{}
	var metricsJSON []byte

	query := `
		SELECT id, model_id, accuracy, precision, recall, f1_score, metrics,
		       confusion_matrix_path, roc_curve_path, report_path, created_at
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

// GetEvaluationsAll returns all evaluations, newest first
func GetEvaluationsAll(db *sql.DB) ([]*Evaluation, error) {
	query := `
		SELECT id, model_id, accuracy, precision, recall, f1_score, metrics,
		       confusion_matrix_path, roc_curve_path, report_path, created_at
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
		       confusion_matrix_path, roc_curve_path, report_path, created_at
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
