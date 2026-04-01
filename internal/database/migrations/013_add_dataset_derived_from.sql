-- 测试集记录其由哪条训练集划分而来（与「从训练集划分测试集」一一对应）；上传/URL/在线导入的测试集此列为 NULL
ALTER TABLE datasets
  ADD COLUMN IF NOT EXISTS derived_from_dataset_id INTEGER REFERENCES datasets (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_datasets_derived_from
  ON datasets (derived_from_dataset_id)
  WHERE derived_from_dataset_id IS NOT NULL;
