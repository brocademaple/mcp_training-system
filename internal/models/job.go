package models

import (
	"database/sql"
	"encoding/json"
	"time"
)

// TrainingJob represents a training job in the system
type TrainingJob struct {
	ID           int                    `json:"id"`
	UserID       int                    `json:"user_id"`
	DatasetID    int                    `json:"dataset_id"`
	ModelType    string                 `json:"model_type"`
	Hyperparams  map[string]interface{} `json:"hyperparams"`
	Status       string                 `json:"status"`
	Progress     int                    `json:"progress"`
	CurrentEpoch int                    `json:"current_epoch"`
	TotalEpochs  int                    `json:"total_epochs"`
	ErrorMessage string                 `json:"error_message"`
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
		INSERT INTO training_jobs (user_id, dataset_id, model_type, hyperparams, status, total_epochs)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, created_at, updated_at
	`
	err = db.QueryRow(
		query,
		j.UserID,
		j.DatasetID,
		j.ModelType,
		hyperparamsJSON,
		j.Status,
		j.TotalEpochs,
	).Scan(&j.ID, &j.CreatedAt, &j.UpdatedAt)

	return err
}

// GetByID retrieves a training job by ID
func GetTrainingJobByID(db *sql.DB, id int) (*TrainingJob, error) {
	job := &TrainingJob{}
	var hyperparamsJSON []byte

	query := `
		SELECT id, user_id, dataset_id, model_type, hyperparams, status, progress,
		       current_epoch, total_epochs, error_message, created_at, started_at,
		       completed_at, updated_at
		FROM training_jobs WHERE id = $1
	`
	err := db.QueryRow(query, id).Scan(
		&job.ID,
		&job.UserID,
		&job.DatasetID,
		&job.ModelType,
		&hyperparamsJSON,
		&job.Status,
		&job.Progress,
		&job.CurrentEpoch,
		&job.TotalEpochs,
		&job.ErrorMessage,
		&job.CreatedAt,
		&job.StartedAt,
		&job.CompletedAt,
		&job.UpdatedAt,
	)
	if err != nil {
		return nil, err
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

// GetTrainingJobsByUserID returns all training jobs for a user, newest first
func GetTrainingJobsByUserID(db *sql.DB, userID int) ([]*TrainingJob, error) {
	query := `
		SELECT id, user_id, dataset_id, model_type, hyperparams, status, progress,
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
		err := rows.Scan(
			&job.ID,
			&job.UserID,
			&job.DatasetID,
			&job.ModelType,
			&hyperparamsJSON,
			&job.Status,
			&job.Progress,
			&job.CurrentEpoch,
			&job.TotalEpochs,
			&job.ErrorMessage,
			&job.CreatedAt,
			&job.StartedAt,
			&job.CompletedAt,
			&job.UpdatedAt,
		)
		if err != nil {
			return nil, err
		}
		if err := json.Unmarshal(hyperparamsJSON, &job.Hyperparams); err != nil {
			return nil, err
		}
		jobs = append(jobs, job)
	}
	return jobs, rows.Err()
}
