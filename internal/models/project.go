package models

import (
	"database/sql"
	"time"
)

type Project struct {
	ID          int       `json:"id"`
	UserID      int       `json:"user_id"`
	Name        string    `json:"name"`
	Description string    `json:"description,omitempty"`
	SessionRoot string    `json:"session_root"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

func CreateProject(db *sql.DB, p *Project) error {
	return db.QueryRow(
		`INSERT INTO projects (user_id, name, description, session_root) VALUES ($1, $2, $3, $4) RETURNING id, created_at, updated_at`,
		p.UserID,
		p.Name,
		nullIfEmpty(p.Description),
		p.SessionRoot,
	).Scan(&p.ID, &p.CreatedAt, &p.UpdatedAt)
}

func GetProjectByID(db *sql.DB, id int) (*Project, error) {
	out := &Project{}
	var desc sql.NullString
	err := db.QueryRow(
		`SELECT id, user_id, name, description, session_root, created_at, updated_at FROM projects WHERE id = $1`,
		id,
	).Scan(&out.ID, &out.UserID, &out.Name, &desc, &out.SessionRoot, &out.CreatedAt, &out.UpdatedAt)
	if err != nil {
		return nil, err
	}
	if desc.Valid {
		out.Description = desc.String
	}
	return out, nil
}

func ListProjectsByUser(db *sql.DB, userID int) ([]*Project, error) {
	rows, err := db.Query(
		`SELECT id, user_id, name, description, session_root, created_at, updated_at FROM projects WHERE user_id = $1 ORDER BY created_at DESC`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := make([]*Project, 0, 16)
	for rows.Next() {
		p := &Project{}
		var desc sql.NullString
		if err := rows.Scan(&p.ID, &p.UserID, &p.Name, &desc, &p.SessionRoot, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		if desc.Valid {
			p.Description = desc.String
		}
		list = append(list, p)
	}
	return list, rows.Err()
}

func UpdateProject(db *sql.DB, p *Project) error {
	return db.QueryRow(
		`UPDATE projects SET name = $1, description = $2, session_root = $3, updated_at = NOW() WHERE id = $4 RETURNING updated_at`,
		p.Name,
		nullIfEmpty(p.Description),
		p.SessionRoot,
		p.ID,
	).Scan(&p.UpdatedAt)
}
