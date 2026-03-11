-- 确保存在 id=1 的用户（解决 002 因 username 唯一约束未插入成功的情况）
-- 若已有 id=1 则跳过；若无则插入（用 default_user 避免与已有 default 冲突）
INSERT INTO users (id, username, email)
SELECT 1, 'default_user', 'default@local'
WHERE NOT EXISTS (SELECT 1 FROM users WHERE id = 1);

SELECT setval(pg_get_serial_sequence('users', 'id'), (SELECT COALESCE(MAX(id), 1) FROM users));
