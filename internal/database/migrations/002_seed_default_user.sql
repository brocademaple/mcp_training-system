-- 默认用户（id=1），用于数据集/训练任务等关联；若已存在则跳过
INSERT INTO users (id, username, email)
SELECT 1, 'default', 'default@local'
WHERE NOT EXISTS (SELECT 1 FROM users WHERE id = 1);

-- 若表已有数据且 id 从更大值自增，需重置序列（可选，仅首次 seed 后执行一次）
SELECT setval(pg_get_serial_sequence('users', 'id'), (SELECT COALESCE(MAX(id), 1) FROM users));
