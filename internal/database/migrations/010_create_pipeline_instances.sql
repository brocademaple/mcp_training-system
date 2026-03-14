-- 2.0 流水线实例表：用于一键流水线（清洗→训练→评估）的状态与可观测
-- 执行时机：新环境或尚未建过 pipeline_instances 时执行一次
CREATE TABLE IF NOT EXISTS pipeline_instances (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(255) NOT NULL,
    dataset_id INTEGER NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    current_step VARCHAR(100),
    job_id INTEGER REFERENCES training_jobs(id) ON DELETE SET NULL,
    model_id INTEGER REFERENCES models(id) ON DELETE SET NULL,
    eval_id INTEGER REFERENCES evaluations(id) ON DELETE SET NULL,
    error_msg TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pipeline_session ON pipeline_instances(session_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_status ON pipeline_instances(status);
CREATE INDEX IF NOT EXISTS idx_pipeline_created ON pipeline_instances(created_at DESC);
