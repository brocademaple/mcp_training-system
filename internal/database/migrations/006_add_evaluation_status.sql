-- 评估任务状态与错误信息，便于前端轮询展示「评估中」/「失败」及原因
ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'completed';
ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS error_message TEXT;
UPDATE evaluations SET status = 'completed' WHERE status IS NULL;
