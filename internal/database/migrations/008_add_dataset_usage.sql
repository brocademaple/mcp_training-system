-- 数据集用途：training（训练集）| test（测试集），用于与前端「训练数据集/测试数据集」Tab 严格区分，避免删除/列表互通
-- usage 为 PostgreSQL 保留字，列名需双引号。DEFAULT 会使已有行自动为 'training'，无需再 UPDATE
ALTER TABLE datasets ADD COLUMN IF NOT EXISTS "usage" VARCHAR(20) DEFAULT 'training';
