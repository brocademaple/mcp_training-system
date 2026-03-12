-- 评估任务名称，便于列表展示
ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS name VARCHAR(255);
