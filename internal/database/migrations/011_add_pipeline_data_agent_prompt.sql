-- 流水线实例表增加 Data Agent 规划 prompt（用户在前端设定的数据规模/语言/领域等，用于驱动 Data Agent）
ALTER TABLE pipeline_instances ADD COLUMN IF NOT EXISTS data_agent_prompt TEXT;
