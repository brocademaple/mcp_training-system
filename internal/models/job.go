package models

import (
	"database/sql"
	"encoding/json"
	"time"
)

// TrainingJob represents a training job in the system.
// DatasetID 为 nil 表示原数据集已被删除，仅保留训练任务与模型记录。
type TrainingJob struct {
	ID           int                    `json:"id"`
	UserID       int                    `json:"user_id"`
	DatasetID    *int                   `json:"dataset_id"` // 可空：删除数据集后置空，任务与模型保留
	Name         string                 `json:"name"`
	ModelType    string                 `json:"model_type"`
	Hyperparams  map[string]interface{} `json:"hyperparams"`
	Status       string                 `json:"status"`
	Progress     int                    `json:"progress"`
	CurrentEpoch int                    `json:"current_epoch"`
	TotalEpochs  int                    `json:"total_epochs"`
	ErrorMessage *string                `json:"error_message"` // NULL in DB when no error
	CreatedAt    time.Time              `json:"created_at"`
	StartedAt    *time.Time             `json:"started_at"`
	CompletedAt  *time.Time             `json:"completed_at"`
	UpdatedAt    time.Time              `json:"updated_at"`
}

// Create creates a new training job in the database
func (j *TrainingJob) Create(db *sql.DB) error {
	// Convert hyperparams to JSON
	hyperparamsJSON, err := json.Marshal(j.Hyperparams)
	if err != nil {
		return err
	}

	query := `
		INSERT INTO training_jobs (user_id, dataset_id, name, model_type, hyperparams, status, total_epochs)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id, created_at, updated_at
	`
	err = db.QueryRow(
		query,
		j.UserID,
		datasetIDToNullInt64(j.DatasetID),
		j.Name,
		j.ModelType,
		hyperparamsJSON,
		j.Status,
		j.TotalEpochs,
	).Scan(&j.ID, &j.CreatedAt, &j.UpdatedAt)

	return err
}

func datasetIDToNullInt64(p *int) sql.NullInt64 {
	if p == nil {
		return sql.NullInt64{}
	}
	return sql.NullInt64{Int64: int64(*p), Valid: true}
}

// GetByID retrieves a training job by ID
func GetTrainingJobByID(db *sql.DB, id int) (*TrainingJob, error) {
	job := &TrainingJob{}
	var hyperparamsJSON []byte
	var errMsg sql.NullString
	var dID sql.NullInt64

	query := `
		SELECT id, user_id, dataset_id, name, model_type, hyperparams, status, progress,
		       current_epoch, total_epochs, error_message, created_at, started_at,
		       completed_at, updated_at
		FROM training_jobs WHERE id = $1
	`
	err := db.QueryRow(query, id).Scan(
		&job.ID,
		&job.UserID,
		&dID,
		&job.Name,
		&job.ModelType,
		&hyperparamsJSON,
		&job.Status,
		&job.Progress,
		&job.CurrentEpoch,
		&job.TotalEpochs,
		&errMsg,
		&job.CreatedAt,
		&job.StartedAt,
		&job.CompletedAt,
		&job.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	if dID.Valid {
		v := int(dID.Int64)
		job.DatasetID = &v
	}
	if errMsg.Valid {
		job.ErrorMessage = &errMsg.String
	}

	// Parse hyperparams JSON
	if err := json.Unmarshal(hyperparamsJSON, &job.Hyperparams); err != nil {
		return nil, err
	}

	return job, nil
}

// UpdateStatus updates the status of a training job
func UpdateTrainingJobStatus(db *sql.DB, id int, status string, errorMsg string) error {
	query := `
		UPDATE training_jobs
		SET status = $1, error_message = $2, updated_at = NOW()
		WHERE id = $3
	`
	_, err := db.Exec(query, status, errorMsg, id)
	return err
}

// UpdateProgress updates the progress of a training job
func UpdateTrainingJobProgress(db *sql.DB, id int, progress int, currentEpoch int) error {
	query := `
		UPDATE training_jobs
		SET progress = $1, current_epoch = $2, updated_at = NOW()
		WHERE id = $3
	`
	_, err := db.Exec(query, progress, currentEpoch, id)
	return err
}

// SetStarted marks a training job as started
func SetTrainingJobStarted(db *sql.DB, id int) error {
	query := `
		UPDATE training_jobs
		SET status = 'running', started_at = NOW(), updated_at = NOW()
		WHERE id = $1
	`
	_, err := db.Exec(query, id)
	return err
}

// SetCompleted marks a training job as completed
func SetTrainingJobCompleted(db *sql.DB, id int) error {
	query := `
		UPDATE training_jobs
		SET status = 'completed', completed_at = NOW(), progress = 100, updated_at = NOW()
		WHERE id = $1
	`
	_, err := db.Exec(query, id)
	return err
}

// ResetJobForRestart 将已结束的任务重置为可重新训练：状态改为 queued，清空错误与进度，用于「重启训练」
func ResetJobForRestart(db *sql.DB, id int) error {
	query := `
		UPDATE training_jobs
		SET status = 'queued', error_message = NULL, progress = 0, current_epoch = 0,
		    started_at = NULL, completed_at = NULL, updated_at = NOW()
		WHERE id = $1
	`
	_, err := db.Exec(query, id)
	return err
}

// DeleteTrainingJob 删除训练任务（关联的 training_logs、models 由外键 ON DELETE CASCADE 自动清理）
func DeleteTrainingJob(db *sql.DB, id int) error {
	_, err := db.Exec("DELETE FROM training_jobs WHERE id = $1", id)
	return err
}

// GetTrainingJobsByUserID returns all training jobs for a user, newest first
func GetTrainingJobsByUserID(db *sql.DB, userID int) ([]*TrainingJob, error) {
	query := `
		SELECT id, user_id, dataset_id, name, model_type, hyperparams, status, progress,
		       current_epoch, total_epochs, error_message, created_at, started_at,
		       completed_at, updated_at
		FROM training_jobs
		WHERE user_id = $1
		ORDER BY created_at DESC
	`
	rows, err := db.Query(query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var jobs []*TrainingJob
	for rows.Next() {
		job := &TrainingJob{}
		var hyperparamsJSON []byte
		var errMsg sql.NullString
		var dID sql.NullInt64
		err := rows.Scan(
			&job.ID,
			&job.UserID,
			&dID,
			&job.Name,
			&job.ModelType,
			&hyperparamsJSON,
			&job.Status,
			&job.Progress,
			&job.CurrentEpoch,
			&job.TotalEpochs,
			&errMsg,
			&job.CreatedAt,
			&job.StartedAt,
			&job.CompletedAt,
			&job.UpdatedAt,
		)
		if err != nil {
			return nil, err
		}
		if dID.Valid {
			v := int(dID.Int64)
			job.DatasetID = &v
		}
		if errMsg.Valid {
			job.ErrorMessage = &errMsg.String
		}
		if err := json.Unmarshal(hyperparamsJSON, &job.Hyperparams); err != nil {
			return nil, err
		}
		jobs = append(jobs, job)
	}
	return jobs, rows.Err()
}
