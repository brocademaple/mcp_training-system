-- 017: add projects and project-level isolation keys
-- Purpose:
-- 1) persist project list for Agent workflow management
-- 2) scope training/evaluation/pipeline records by project_id

CREATE TABLE IF NOT EXISTS projects (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL DEFAULT 1,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    session_root VARCHAR(255) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_projects_user_created
    ON projects (user_id, created_at DESC);

ALTER TABLE training_jobs
    ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_training_jobs_project
    ON training_jobs (project_id, created_at DESC);

ALTER TABLE evaluations
    ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_evaluations_project
    ON evaluations (project_id, created_at DESC);

ALTER TABLE pipeline_instances
    ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pipeline_instances_project
    ON pipeline_instances (project_id, created_at DESC);
