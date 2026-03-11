-- 去掉用户管理：解除 user_id 外键并删除 users 表（个人工具无需多用户）
ALTER TABLE datasets DROP CONSTRAINT IF EXISTS datasets_user_id_fkey;
ALTER TABLE training_jobs DROP CONSTRAINT IF EXISTS training_jobs_user_id_fkey;
DROP TABLE IF EXISTS users;
