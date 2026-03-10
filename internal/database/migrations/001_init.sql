-- MCP Training System Database Schema
-- Version: 1.0
-- Created: 2026-01-10

-- Table 1: users
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    email VARCHAR(100) UNIQUE,
    password_hash VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Table 2: datasets
CREATE TABLE IF NOT EXISTS datasets (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    type VARCHAR(50) NOT NULL,
    source VARCHAR(500),
    original_file_path VARCHAR(500),
    cleaned_file_path VARCHAR(500),
    row_count INT,
    column_count INT,
    file_size BIGINT,
    status VARCHAR(50) DEFAULT 'uploading',
    error_message TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_datasets_user_id ON datasets(user_id);
CREATE INDEX idx_datasets_status ON datasets(status);

-- Table 3: training_jobs
CREATE TABLE IF NOT EXISTS training_jobs (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    dataset_id INT REFERENCES datasets(id) ON DELETE CASCADE,
    model_type VARCHAR(100) NOT NULL,
    hyperparams JSONB,
    status VARCHAR(50) DEFAULT 'queued',
    progress INT DEFAULT 0,
    current_epoch INT DEFAULT 0,
    total_epochs INT,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_jobs_user_id ON training_jobs(user_id);
CREATE INDEX idx_jobs_status ON training_jobs(status);

-- Table 4: models
CREATE TABLE IF NOT EXISTS models (
    id SERIAL PRIMARY KEY,
    job_id INT REFERENCES training_jobs(id) ON DELETE CASCADE,
    name VARCHAR(200),
    model_path VARCHAR(500) NOT NULL,
    model_size BIGINT,
    model_type VARCHAR(100),
    framework VARCHAR(50) DEFAULT 'pytorch',
    is_deployed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_models_job_id ON models(job_id);

-- Table 5: training_logs
CREATE TABLE IF NOT EXISTS training_logs (
    id SERIAL PRIMARY KEY,
    job_id INT REFERENCES training_jobs(id) ON DELETE CASCADE,
    epoch INT NOT NULL,
    loss FLOAT,
    accuracy FLOAT,
    learning_rate FLOAT,
    log_time TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_logs_job_id ON training_logs(job_id);

-- Table 6: evaluations
CREATE TABLE IF NOT EXISTS evaluations (
    id SERIAL PRIMARY KEY,
    model_id INT REFERENCES models(id) ON DELETE CASCADE,
    accuracy FLOAT,
    precision FLOAT,
    recall FLOAT,
    f1_score FLOAT,
    metrics JSONB,
    confusion_matrix_path VARCHAR(500),
    roc_curve_path VARCHAR(500),
    report_path VARCHAR(500),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_eval_model_id ON evaluations(model_id);
