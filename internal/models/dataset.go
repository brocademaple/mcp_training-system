package models

import (
	"database/sql"
	"time"
)

// Dataset represents a dataset in the system
type Dataset struct {
	ID               int       `json:"id"`
	UserID           int       `json:"user_id"`
	Name             string    `json:"name"`
	Type             string    `json:"type"`
	Source           string    `json:"source"`
	OriginalFilePath string    `json:"original_file_path"`
	CleanedFilePath  string    `json:"cleaned_file_path"`
	RowCount         int       `json:"row_count"`
	ColumnCount      int       `json:"column_count"`
	FileSize         int64     `json:"file_size"`
	Status           string    `json:"status"`
	ErrorMessage     string    `json:"error_message"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

// Create creates a new dataset in the database
func (d *Dataset) Create(db *sql.DB) error {
	query := `
		INSERT INTO datasets (user_id, name, type, source, original_file_path, file_size, status)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id, created_at, updated_at
	`
	err := db.QueryRow(
		query,
		d.UserID,
		d.Name,
		d.Type,
		d.Source,
		d.OriginalFilePath,
		d.FileSize,
		d.Status,
	).Scan(&d.ID, &d.CreatedAt, &d.UpdatedAt)

	return err
}

// GetByID retrieves a dataset by ID
func GetDatasetByID(db *sql.DB, id int) (*Dataset, error) {
	dataset := &Dataset{}
	query := `
		SELECT id, user_id, name, type, source, original_file_path, cleaned_file_path,
		       row_count, column_count, file_size, status, error_message, created_at, updated_at
		FROM datasets WHERE id = $1
	`
	err := db.QueryRow(query, id).Scan(
		&dataset.ID,
		&dataset.UserID,
		&dataset.Name,
		&dataset.Type,
		&dataset.Source,
		&dataset.OriginalFilePath,
		&dataset.CleanedFilePath,
		&dataset.RowCount,
		&dataset.ColumnCount,
		&dataset.FileSize,
		&dataset.Status,
		&dataset.ErrorMessage,
		&dataset.CreatedAt,
		&dataset.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return dataset, nil
}

// GetByUserID retrieves all datasets for a user
func GetDatasetsByUserID(db *sql.DB, userID int) ([]*Dataset, error) {
	query := `
		SELECT id, user_id, name, type, source, original_file_path, cleaned_file_path,
		       row_count, column_count, file_size, status, error_message, created_at, updated_at
		FROM datasets WHERE user_id = $1 ORDER BY created_at DESC
	`
	rows, err := db.Query(query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	datasets := []*Dataset{}
	for rows.Next() {
		dataset := &Dataset{}
		err := rows.Scan(
			&dataset.ID,
			&dataset.UserID,
			&dataset.Name,
			&dataset.Type,
			&dataset.Source,
			&dataset.OriginalFilePath,
			&dataset.CleanedFilePath,
			&dataset.RowCount,
			&dataset.ColumnCount,
			&dataset.FileSize,
			&dataset.Status,
			&dataset.ErrorMessage,
			&dataset.CreatedAt,
			&dataset.UpdatedAt,
		)
		if err != nil {
			return nil, err
		}
		datasets = append(datasets, dataset)
	}
	return datasets, nil
}

// Update updates a dataset in the database
func (d *Dataset) Update(db *sql.DB) error {
	query := `
		UPDATE datasets
		SET cleaned_file_path = $1, row_count = $2, column_count = $3,
		    status = $4, error_message = $5, updated_at = NOW()
		WHERE id = $6
	`
	_, err := db.Exec(
		query,
		d.CleanedFilePath,
		d.RowCount,
		d.ColumnCount,
		d.Status,
		d.ErrorMessage,
		d.ID,
	)
	return err
}

// UpdateStatus updates only the status of a dataset
func UpdateDatasetStatus(db *sql.DB, id int, status string, errorMsg string) error {
	query := `
		UPDATE datasets
		SET status = $1, error_message = $2, updated_at = NOW()
		WHERE id = $3
	`
	_, err := db.Exec(query, status, errorMsg, id)
	return err
}
