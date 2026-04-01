-- Vibe Spec：训练任务统一 run_spec；流水线显式编排状态与失败码
-- 执行时机：已有库升级时执行一次；新环境在 001～011 之后执行本文件
-- 同一条迁移在同一数据库只需执行一次

ALTER TABLE training_jobs ADD COLUMN IF NOT EXISTS run_spec JSONB;

ALTER TABLE pipeline_instances ADD COLUMN IF NOT EXISTS orchestration_state VARCHAR(64);
ALTER TABLE pipeline_instances ADD COLUMN IF NOT EXISTS failure_code VARCHAR(64);
ALTER TABLE pipeline_instances ADD COLUMN IF NOT EXISTS run_spec JSONB;

-- COMMENT uses ASCII only: piping from PowerShell to psql may corrupt UTF-8 in quoted strings.
COMMENT ON COLUMN training_jobs.run_spec IS 'Unified RunSpec JSON (semantic_task, training_method, domain, runtime). Legacy rows may be derived in app.';
COMMENT ON COLUMN pipeline_instances.orchestration_state IS 'Orchestrator state: RECEIVED .. COMPLETED or FAILED_*';
COMMENT ON COLUMN pipeline_instances.failure_code IS 'Failure code: FAILED_TASK_PARSE, FAILED_DATA_SCHEMA, FAILED_TRAINING, FAILED_EVALUATION';
