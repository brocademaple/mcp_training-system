package models

import (
	"database/sql"
	"time"
)

// Model represents a trained model in the system
type Model struct {
	ID         int       `json:"id"`
	JobID      int       `json:"job_id"`
	Name       string    `json:"name"`
	ModelPath  string    `json:"model_path"`
	ModelSize  int64     `json:"model_size"`
	ModelType  string    `json:"model_type"`
	Framework  string    `json:"framework"`
	IsDeployed bool      `json:"is_deployed"`
	CreatedAt  time.Time `json:"created_at"`
}

// Create creates a new model in the database
func (m *Model) Create(db *sql.DB) error {
	query := `
		INSERT INTO models (job_id, name, model_path, model_size, model_type, framework)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, created_at
	`
	err := db.QueryRow(
		query,
		m.JobID,
		m.Name,
		m.ModelPath,
		m.ModelSize,
		m.ModelType,
		m.Framework,
	).Scan(&m.ID, &m.CreatedAt)

	return err
}

// GetByID retrieves a model by ID
func GetModelByID(db *sql.DB, id int) (*Model, error) {
	model := &Model{}
	query := `
		SELECT id, job_id, name, model_path, model_size, model_type, framework, is_deployed, created_at
		FROM models WHERE id = $1
	`
	err := db.QueryRow(query, id).Scan(
		&model.ID,
		&model.JobID,
		&model.Name,
		&model.ModelPath,
		&model.ModelSize,
		&model.ModelType,
		&model.Framework,
		&model.IsDeployed,
		&model.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return model, nil
}

// GetByJobID retrieves a model by job ID
func GetModelByJobID(db *sql.DB, jobID int) (*Model, error) {
	model := &Model{}
	query := `
		SELECT id, job_id, name, model_path, model_size, model_type, framework, is_deployed, created_at
		FROM models WHERE job_id = $1
	`
	err := db.QueryRow(query, jobID).Scan(
		&model.ID,
		&model.JobID,
		&model.Name,
		&model.ModelPath,
		&model.ModelSize,
		&model.ModelType,
		&model.Framework,
		&model.IsDeployed,
		&model.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return model, nil
}

// GetModelsByUserID retrieves all models for a user (via training_jobs)
func GetModelsByUserID(db *sql.DB, userID int) ([]*Model, error) {
	query := `
		SELECT m.id, m.job_id, m.name, m.model_path, m.model_size, m.model_type, m.framework, m.is_deployed, m.created_at
		FROM models m
		INNER JOIN training_jobs j ON m.job_id = j.id
		WHERE j.user_id = $1
		ORDER BY m.created_at DESC
	`
	rows, err := db.Query(query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var models []*Model
	for rows.Next() {
		m := &Model{}
		err := rows.Scan(
			&m.ID,
			&m.JobID,
			&m.Name,
			&m.ModelPath,
			&m.ModelSize,
			&m.ModelType,
			&m.Framework,
			&m.IsDeployed,
			&m.CreatedAt,
		)
		if err != nil {
			return nil, err
		}
		models = append(models, m)
	}
	return models, rows.Err()
}
