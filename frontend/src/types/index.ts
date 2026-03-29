// Dataset types (nullable fields match DB/API: may be null before processing)
export interface Dataset {
  id: number;
  user_id: number;
  name: string;
  type: string;
  /** 用途：training 训练集 | test 测试集，与列表 Tab 一一对应，删除/操作互不影响 */
  usage?: 'training' | 'test';
  source: string | null;
  original_file_path: string | null;
  cleaned_file_path: string | null;
  row_count: number | null;
  column_count: number | null;
  file_size: number | null;
  status: 'uploading' | 'processing' | 'ready' | 'error';
  error_message?: string | null;
  created_at: string;
  updated_at: string;
}

// Training Job types
export interface TrainingJob {
  id: number;
  user_id: number;
  /** 可为 null：原数据集已删除时保留任务与模型记录 */
  dataset_id?: number | null;
  name?: string;
  model_type: string;
  hyperparams: {
    learning_rate: number;
    batch_size: number;
    epochs: number;
    /** 文本分类 / 微调常用 */
    base_model?: string;
    max_seq_length?: number;
    lora_r?: number;
    [key: string]: unknown;
  };
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  current_epoch: number;
  total_epochs: number;
  error_message?: string;
  /** 实时训练指标（来自 Redis/WebSocket）：loss、step、max_steps、learning_rate、accuracy 等 */
  redis_progress?: Record<string, unknown>;
  /** 训练过程输出（LOG: 行），来自后端推送或 getJobStatus */
  log_lines?: string[];
  created_at: string;
  started_at?: string;
  completed_at?: string;
  updated_at: string;
}

// Model types
export interface Model {
  id: number;
  job_id: number;
  name: string;
  model_path: string;
  model_size: number;
  model_type: string;
  framework: string;
  is_deployed: boolean;
  created_at: string;
}

// Evaluation types
export interface Evaluation {
  id: number;
  model_id: number;
  /** 任务名，列表展示用 */
  name?: string;
  accuracy: number;
  precision: number;
  recall: number;
  f1_score: number;
  metrics: Record<string, any>;
  confusion_matrix_path?: string;
  roc_curve_path?: string;
  report_path?: string;
  /** running | completed | failed | cancelled，用于列表与进度弹窗 */
  status?: 'running' | 'completed' | 'failed' | 'cancelled';
  error_message?: string | null;
  created_at: string;
}

// API Response types
export interface ApiResponse<T = any> {
  code: number;
  message: string;
  data?: T;
}
