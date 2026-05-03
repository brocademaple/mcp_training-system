package models

import (
	"database/sql"
	"encoding/json"
	"strings"
	"time"
)

// rawJSONFromBytes 将 JSONB 扫描结果转为 json.RawMessage。
// 查询侧使用 COALESCE(ai_analysis, 'null'::jsonb)，避免 SQL NULL 触发驱动 Scan 进 []byte/json.RawMessage 失败。
func rawJSONFromBytes(b []byte) json.RawMessage {
	if b == nil || len(b) == 0 {
		return nil
	}
	// JSONB 字面量 null（含 COALESCE 填充）
	if len(b) == 4 && string(b) == "null" {
		return nil
	}
	out := make([]byte, len(b))
	copy(out, b)
	return json.RawMessage(out)
}

// Dataset represents a dataset record.
type Dataset struct {
	ID                   int             `json:"id"`
	UserID               int             `json:"user_id"`
	Name                 string          `json:"name"`
	Type                 string          `json:"type"`
	Usage                string          `json:"usage"` // "training" | "test"
	Source               sql.NullString  `json:"source"`
	OriginalFilePath     sql.NullString  `json:"original_file_path"`
	CleanedFilePath      sql.NullString  `json:"cleaned_file_path"`
	RowCount             sql.NullInt64   `json:"row_count"`
	ColumnCount          sql.NullInt64   `json:"column_count"`
	FileSize             sql.NullInt64   `json:"file_size"`
	Status               string          `json:"status"`
	ErrorMessage         sql.NullString  `json:"error_message"`
	AIAnalysis           json.RawMessage `json:"ai_analysis,omitempty"`
	DerivedFromDatasetID sql.NullInt64   `json:"derived_from_dataset_id"`
	DerivedFromName      sql.NullString  `json:"derived_from_dataset_name"`
	CreatedAt            time.Time       `json:"created_at"`
	UpdatedAt            time.Time       `json:"updated_at"`
}

// Create creates a new dataset in the database.
func (d *Dataset) Create(db *sql.DB) error {
	usage := d.Usage
	if usage != "training" && usage != "test" {
		usage = "training"
	}

	query := `
		INSERT INTO datasets (user_id, name, type, "usage", source, original_file_path, file_size, status)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id, created_at, updated_at
	`
	return db.QueryRow(
		query,
		d.UserID,
		d.Name,
		d.Type,
		usage,
		d.Source,
		d.OriginalFilePath,
		d.FileSize,
		d.Status,
	).Scan(&d.ID, &d.CreatedAt, &d.UpdatedAt)
}

// GetDatasetByID retrieves a dataset by ID.
func GetDatasetByID(db *sql.DB, id int) (*Dataset, error) {
	dataset := &Dataset{}
	query := `
		SELECT d.id, d.user_id, d.name, d.type, COALESCE(d."usage",'training'), d.source, d.original_file_path, d.cleaned_file_path,
		       d.row_count, d.column_count, d.file_size, d.status, d.error_message,
		       COALESCE(d.ai_analysis, 'null'::jsonb), d.created_at, d.updated_at,
		       d.derived_from_dataset_id, src.name
		FROM datasets d
		LEFT JOIN datasets src ON src.id = d.derived_from_dataset_id
		WHERE d.id = $1
	`
	var aiBytes []byte
	err := db.QueryRow(query, id).Scan(
		&dataset.ID,
		&dataset.UserID,
		&dataset.Name,
		&dataset.Type,
		&dataset.Usage,
		&dataset.Source,
		&dataset.OriginalFilePath,
		&dataset.CleanedFilePath,
		&dataset.RowCount,
		&dataset.ColumnCount,
		&dataset.FileSize,
		&dataset.Status,
		&dataset.ErrorMessage,
		&aiBytes,
		&dataset.CreatedAt,
		&dataset.UpdatedAt,
		&dataset.DerivedFromDatasetID,
		&dataset.DerivedFromName,
	)
	if err != nil {
		return nil, err
	}
	dataset.AIAnalysis = rawJSONFromBytes(aiBytes)
	return dataset, nil
}

// GetDatasetsByUserID retrieves all datasets for a user.
func GetDatasetsByUserID(db *sql.DB, userID int) ([]*Dataset, error) {
	return getDatasetsByUserIDWithUsage(db, userID, "")
}

// GetDatasetsByUserIDAndUsage retrieves datasets by usage.
func GetDatasetsByUserIDAndUsage(db *sql.DB, userID int, usage string) ([]*Dataset, error) {
	return getDatasetsByUserIDWithUsage(db, userID, usage)
}

func getDatasetsByUserIDWithUsage(db *sql.DB, userID int, usage string) ([]*Dataset, error) {
	query := `
		SELECT d.id, d.user_id, d.name, d.type, COALESCE(d."usage",'training'), d.source, d.original_file_path, d.cleaned_file_path,
		       d.row_count, d.column_count, d.file_size, d.status, d.error_message,
		       COALESCE(d.ai_analysis, 'null'::jsonb), d.created_at, d.updated_at,
		       d.derived_from_dataset_id, src.name
		FROM datasets d
		LEFT JOIN datasets src ON src.id = d.derived_from_dataset_id
		WHERE d.user_id = $1
	`

	args := []interface{}{userID}
	if usage == "training" || usage == "test" {
		query += ` AND COALESCE(d."usage",'training') = $2 ORDER BY d.created_at DESC`
		args = append(args, usage)
	} else {
		query += ` ORDER BY d.created_at DESC`
	}

	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	datasets := make([]*Dataset, 0)
	for rows.Next() {
		dataset := &Dataset{}
		var aiBytes []byte
		err := rows.Scan(
			&dataset.ID,
			&dataset.UserID,
			&dataset.Name,
			&dataset.Type,
			&dataset.Usage,
			&dataset.Source,
			&dataset.OriginalFilePath,
			&dataset.CleanedFilePath,
			&dataset.RowCount,
			&dataset.ColumnCount,
			&dataset.FileSize,
			&dataset.Status,
			&dataset.ErrorMessage,
			&aiBytes,
			&dataset.CreatedAt,
			&dataset.UpdatedAt,
			&dataset.DerivedFromDatasetID,
			&dataset.DerivedFromName,
		)
		if err != nil {
			return nil, err
		}
		dataset.AIAnalysis = rawJSONFromBytes(aiBytes)
		datasets = append(datasets, dataset)
	}

	return datasets, nil
}

// Update updates a dataset after processing.
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

// UpdateDatasetStatus updates dataset status and error message.
func UpdateDatasetStatus(db *sql.DB, id int, status string, errorMsg string) error {
	query := `
		UPDATE datasets
		SET status = $1, error_message = $2, updated_at = NOW()
		WHERE id = $3
	`
	_, err := db.Exec(query, status, errorMsg, id)
	return err
}

// UpdateDatasetName updates dataset name.
func UpdateDatasetName(db *sql.DB, id int, name string) error {
	_, err := db.Exec(`UPDATE datasets SET name = $1, updated_at = NOW() WHERE id = $2`, strings.TrimSpace(name), id)
	return err
}

// SetDatasetReadyWithPath marks dataset as ready with cleaned path.
func SetDatasetReadyWithPath(db *sql.DB, id int, cleanedPath string) error {
	query := `
		UPDATE datasets
		SET status = 'ready', cleaned_file_path = $1, error_message = NULL, updated_at = NOW()
		WHERE id = $2
	`
	_, err := db.Exec(query, cleanedPath, id)
	return err
}

// UpdateDatasetAIAnalysis updates datasets.ai_analysis JSON payload.
func UpdateDatasetAIAnalysis(db *sql.DB, id int, aiAnalysis json.RawMessage) error {
	_, err := db.Exec(`UPDATE datasets SET ai_analysis = $1, updated_at = NOW() WHERE id = $2`, aiAnalysis, id)
	return err
}

// UpdateDatasetAgentDataReport updates datasets.agent_data_report JSON payload.
func UpdateDatasetAgentDataReport(db *sql.DB, id int, report json.RawMessage) error {
	_, err := db.Exec(`UPDATE datasets SET agent_data_report = $1, updated_at = NOW() WHERE id = $2`, report, id)
	return err
}

// GetDatasetAgentDataReport returns datasets.agent_data_report JSON payload.
func GetDatasetAgentDataReport(db *sql.DB, id int) (json.RawMessage, error) {
	var raw []byte
	if err := db.QueryRow(`SELECT COALESCE(agent_data_report, 'null'::jsonb) FROM datasets WHERE id = $1`, id).Scan(&raw); err != nil {
		return nil, err
	}
	return rawJSONFromBytes(raw), nil
}
