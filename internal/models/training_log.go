package models

import (
	"database/sql"
	"time"
)

// TrainingLog represents one log entry per epoch for a training job
type TrainingLog struct {
	ID           int       `json:"id"`
	JobID        int       `json:"job_id"`
	Epoch        int       `json:"epoch"`
	Loss         float64   `json:"loss"`
	Accuracy     float64   `json:"accuracy"`
	LearningRate float64   `json:"learning_rate"`
	LogTime      time.Time `json:"log_time"`
}

// Create inserts a training log entry
func (l *TrainingLog) Create(db *sql.DB) error {
	query := `
		INSERT INTO training_logs (job_id, epoch, loss, accuracy, learning_rate)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, log_time
	`
	return db.QueryRow(
		query,
		l.JobID,
		l.Epoch,
		l.Loss,
		l.Accuracy,
		l.LearningRate,
	).Scan(&l.ID, &l.LogTime)
}

// GetTrainingLogsByJobID returns all log entries for a job, ordered by epoch ascending
func GetTrainingLogsByJobID(db *sql.DB, jobID int) ([]*TrainingLog, error) {
	query := `
		SELECT id, job_id, epoch, loss, accuracy, learning_rate, log_time
		FROM training_logs
		WHERE job_id = $1
		ORDER BY epoch ASC
	`
	rows, err := db.Query(query, jobID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var logs []*TrainingLog
	for rows.Next() {
		l := &TrainingLog{}
		err := rows.Scan(
			&l.ID,
			&l.JobID,
			&l.Epoch,
			&l.Loss,
			&l.Accuracy,
			&l.LearningRate,
			&l.LogTime,
		)
		if err != nil {
			return nil, err
		}
		logs = append(logs, l)
	}
	return logs, rows.Err()
}
