-- 删除数据集时不再级联删除训练任务与模型：保留已完成的训练任务记录和模型本身。
-- 将 training_jobs.dataset_id 外键改为 ON DELETE SET NULL，并允许 dataset_id 为 NULL。

-- 1. 删除原有 CASCADE 外键（PostgreSQL 默认约束名一般为 表名_列名_fkey）
ALTER TABLE training_jobs DROP CONSTRAINT IF EXISTS training_jobs_dataset_id_fkey;

-- 2. 允许 dataset_id 为 NULL（删除数据集后该字段置空，任务与模型保留）
ALTER TABLE training_jobs ALTER COLUMN dataset_id DROP NOT NULL;

-- 3. 重新添加外键，删除数据集时仅将 dataset_id 置为 NULL
ALTER TABLE training_jobs
  ADD CONSTRAINT training_jobs_dataset_id_fkey
  FOREIGN KEY (dataset_id) REFERENCES datasets(id) ON DELETE SET NULL;
