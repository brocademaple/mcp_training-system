package models

import (
	"database/sql"
	"encoding/json"
	"strings"
	"time"
)

func nullIfEmpty(s string) interface{} {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

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
	// 优先写入 006/007 列（name/status/error_message），失败则回退到 001 基础列（兼容旧库）
	queryNew := `
		INSERT INTO evaluations (model_id, name, accuracy, precision, recall, f1_score, metrics,
		                         confusion_matrix_path, roc_curve_path, report_path, status, error_message)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
		RETURNING id, created_at
	`
	err = db.QueryRow(
		queryNew,
		e.ModelID,
		e.Name,
		e.Accuracy,
		e.Precision,
		e.Recall,
		e.F1Score,
		metricsJSON,
		e.ConfusionMatrixPath,
		e.ROCCurvePath,
		e.ReportPath,
		e.Status,
		nullIfEmpty(e.ErrorMessage),
	).Scan(&e.ID, &e.CreatedAt)
	if err == nil {
		return nil
	}
	if strings.Contains(err.Error(), "does not exist") {
		queryOld := `
			INSERT INTO evaluations (model_id, accuracy, precision, recall, f1_score, metrics,
			                         confusion_matrix_path, roc_curve_path, report_path)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
			RETURNING id, created_at
		`
		return db.QueryRow(
			queryOld,
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
	}
	return err
}

// GetByID retrieves an evaluation by ID
func GetEvaluationByID(db *sql.DB, id int) (*Evaluation, error) {
	eval := &Evaluation{}
	var metricsJSON []byte

	// 优先读取 006/007 列（name/status/error_message），失败则回退到 001 基础列（兼容旧库）
	queryNew := `
		SELECT id, model_id, COALESCE(name,''), accuracy, precision, recall, f1_score, metrics,
		       confusion_matrix_path, roc_curve_path, report_path,
		       COALESCE(status,''), COALESCE(error_message,''), created_at
		FROM evaluations WHERE id = $1
	`
	err := db.QueryRow(queryNew, id).Scan(
		&eval.ID,
		&eval.ModelID,
		&eval.Name,
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
		if strings.Contains(err.Error(), "does not exist") {
			queryOld := `
				SELECT id, model_id, accuracy, precision, recall, f1_score, metrics,
				       confusion_matrix_path, roc_curve_path, report_path, created_at
				FROM evaluations WHERE id = $1
			`
			err2 := db.QueryRow(queryOld, id).Scan(
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
			if err2 != nil {
				return nil, err2
			}
		} else {
			return nil, err
		}
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
	// 若 DB 已显式记录状态（running/cancelled/failed/completed），优先尊重；
	// 仅在 status 为空或 status=completed 但结果明显异常时进行推断修正。
	if e.Status == "running" {
		// 若已生成报告（有 report_path），但状态仍为 running，说明成功路径未显式更新 status，
		// 这里自动纠正为 completed，避免列表一直显示「评估中」。
		if strings.TrimSpace(e.ReportPath) != "" {
			e.Status = "completed"
			e.ErrorMessage = ""
		}
		return
	}
	if e.Status == "cancelled" {
		return
	}
	// 已标记失败且已有具体错误信息（如 Python 报错、获取测试集失败等）时不再覆盖为通用提示
	if e.Status == "failed" && strings.TrimSpace(e.ErrorMessage) != "" {
		return
	}

	if e.ReportPath == "" {
		e.Status = "failed"
		if e.ErrorMessage == "" {
			e.ErrorMessage = "未生成报告或评估异常。可能原因：脚本执行失败、测试集格式不符、模型加载失败。解决：查看后端/控制台日志定位报错；确认测试集含 text 与 label 列且与模型任务一致。"
		}
		return
	}
	acc, f1 := e.Accuracy, e.F1Score
	if acc <= 0 && f1 <= 0 {
		e.Status = "failed"
		if e.ErrorMessage == "" {
			e.ErrorMessage = "评估完成但指标均为 0，无法反映真实效果。可能原因：测试集与模型任务不匹配、标签列名或取值与训练不一致、数据全为单一类别。解决：1) 确认测试集与训练集格式一致 2) 检查 label 列是否正确 3) 预览报告或查看日志排查。"
		}
		return
	}
	e.Status = "completed"
	e.ErrorMessage = ""
}

// UpdateResult 更新已有评估记录的结果（主要更新 001 基础列；若存在 006 列则顺便把 status 置为 completed）
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
	if err != nil {
		return err
	}

	// 若存在 status/error_message 列，则把状态显式标记为 completed，清空错误信息；
	// 对未执行 006 的旧库，此语句会因列不存在报错，需忽略。
	_, err2 := db.Exec(`
		UPDATE evaluations
		SET status = 'completed', error_message = ''
		WHERE id = $1
	`, id)
	if err2 != nil && strings.Contains(err2.Error(), "does not exist") {
		return nil
	}
	return err2
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
	// 优先查新列；失败（列不存在）则回退旧列
	queryNew := `
		SELECT id, model_id, COALESCE(name,''), accuracy, precision, recall, f1_score, metrics,
		       confusion_matrix_path, roc_curve_path, report_path,
		       COALESCE(status,''), COALESCE(error_message,''), created_at
		FROM evaluations
		ORDER BY created_at DESC
	`
	useNew := true
	rows, err := db.Query(queryNew)
	if err != nil && strings.Contains(err.Error(), "does not exist") {
		queryOld := `
			SELECT id, model_id, accuracy, precision, recall, f1_score, metrics,
			       confusion_matrix_path, roc_curve_path, report_path, created_at
			FROM evaluations
			ORDER BY created_at DESC
		`
		useNew = false
		rows, err = db.Query(queryOld)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []*Evaluation
	for rows.Next() {
		e := &Evaluation{}
		var metricsJSON []byte
		if useNew {
			if err := rows.Scan(
				&e.ID,
				&e.ModelID,
				&e.Name,
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
		} else {
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
