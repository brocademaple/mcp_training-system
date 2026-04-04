-- 014: 创建三段式数据生成任务表
-- 支持 Idea → Build → Review 工作流

CREATE TABLE IF NOT EXISTS data_generation_tasks (
    id SERIAL PRIMARY KEY,
    parent_task_id INTEGER REFERENCES data_generation_tasks(id) ON DELETE CASCADE,
    pipeline_id INTEGER REFERENCES pipeline_instances(id) ON DELETE CASCADE,
    stage VARCHAR(20) NOT NULL CHECK (stage IN ('idea', 'build', 'review')),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'cancelled')),

    -- 任务认领与超时
    locked_by VARCHAR(100),
    locked_at TIMESTAMP,
    task_started_at TIMESTAMP,
    completed_at TIMESTAMP,
    timeout_hours INTEGER DEFAULT 24,

    -- 输入输出
    input_data JSONB,
    output_data JSONB,
    output_file_path TEXT,

    -- 错误信息
    error_message TEXT,

    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_data_gen_tasks_status ON data_generation_tasks(status);
CREATE INDEX idx_data_gen_tasks_stage ON data_generation_tasks(stage);
CREATE INDEX idx_data_gen_tasks_parent ON data_generation_tasks(parent_task_id);
CREATE INDEX idx_data_gen_tasks_pipeline ON data_generation_tasks(pipeline_id);
