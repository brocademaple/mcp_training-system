package models

import (
	"database/sql"
	"encoding/json"
	"strings"
	"time"
)

// Evaluation represents an evaluation result in the system
type Evaluation struct {
	ID                   int                    `json:"id"`
	ModelID              int                    `json:"model_id"`
	Name                 string                 `json:"name"` // 任务名，列表展示用
	Accuracy             float64                `json:"accuracy"`
	Precision            float64                `json:"precision"`
	Recall               float64                `json:"recall"`
	F1Score              float64                `json:"f1_score"`
	Metrics              map[string]interface{} `json:"metrics"`
	ConfusionMatrixPath  string                 `json:"confusion_matrix_path"`
	ROCCurvePath         string                 `json:"roc_curve_path"`
	ReportPath           string                 `json:"report_path"`
	Status       string    `json:"status"`        // running | completed | failed
	ErrorMessage string    `json:"error_message"` // 失败时原因，库中 NULL 查时用 COALESCE 成空串
	CreatedAt    time.Time `json:"created_at"`
}

// Create creates a new evaluation in the database
func (e *Evaluation) Create(db *sql.DB) error {
	// Convert metrics to JSON
	metricsJSON, err := json.Marshal(e.Metrics)
	if err != nil {
		return err
	}
	// 仅写入 001 基础列，兼容未执行 006/007 的库（无 status/error_message/name）
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

	// 仅查 001 基础列，兼容未执行 006/007 的库；status/error_message 在代码中赋默认值
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
	inferStatusFromResult(eval)

	// Parse metrics JSON
	if len(metricsJSON) > 0 {
		if err := json.Unmarshal(metricsJSON, &eval.Metrics); err != nil {
			return nil, err
		}
	}

	return eval, nil
}

// inferStatusFromResult 根据报告与指标推断状态，避免「准确率 0 仍标已完成」；无法评估时给出具体原因与解决措施
func inferStatusFromResult(e *Evaluation) {
	if e.ReportPath == "" {
		e.Status = "failed"
		e.ErrorMessage = "未生成报告或评估异常。可能原因：脚本执行失败、测试集格式不符、模型加载失败。解决：查看后端/控制台日志定位报错；确认测试集含 text 与 label 列且与模型任务一致。"
		return
	}
	acc, f1 := e.Accuracy, e.F1Score
	if acc <= 0 && f1 <= 0 {
		e.Status = "failed"
		e.ErrorMessage = "评估完成但指标均为 0，无法反映真实效果。可能原因：测试集与模型任务不匹配、标签列名或取值与训练不一致、数据全为单一类别。解决：1) 确认测试集与训练集格式一致 2) 检查 label 列是否正确 3) 预览报告或查看日志排查。"
		return
	}
	e.Status = "completed"
	e.ErrorMessage = ""
}

// UpdateResult 更新已有评估记录的结果（仅更新 001 基础列，兼容无 006 的库）
func UpdateEvaluationResult(db *sql.DB, id int, accuracy, precision, recall, f1Score float64, metrics map[string]interface{}, confusionMatrixPath, rocCurvePath, reportPath string) error {
	metricsJSON, _ := json.Marshal(metrics)
	if metricsJSON == nil {
		metricsJSON = []byte("{}")
	}
	_, err := db.Exec(`
		UPDATE evaluations
		SET accuracy = $1, precision = $2, recall = $3, f1_score = $4, metrics = $5,
		    confusion_matrix_path = $6, roc_curve_path = $7, report_path = $8
		WHERE id = $9
	`, accuracy, precision, recall, f1Score, metricsJSON, confusionMatrixPath, rocCurvePath, reportPath, id)
	return err
}

// UpdateEvaluationStatus 将评估标记为失败或取消并写入错误信息（需 006 迁移；无该列时静默忽略）
func UpdateEvaluationStatus(db *sql.DB, id int, status, errorMsg string) error {
	_, err := db.Exec(`
		UPDATE evaluations SET status = $1, error_message = $2 WHERE id = $3
	`, status, errorMsg, id)
	if err != nil && strings.Contains(err.Error(), "does not exist") {
		return nil
	}
	return err
}

// DeleteEvaluation 删除评估记录
func DeleteEvaluation(db *sql.DB, id int) error {
	_, err := db.Exec(`DELETE FROM evaluations WHERE id = $1`, id)
	return err
}

// GetEvaluationsAll returns all evaluations, newest first（仅查 001 基础列，兼容未执行 006/007 的库）
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
		inferStatusFromResult(e)
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
	inferStatusFromResult(eval)

	// Parse metrics JSON
	if len(metricsJSON) > 0 {
		if err := json.Unmarshal(metricsJSON, &eval.Metrics); err != nil {
			return nil, err
		}
	}

	return eval, nil
}
