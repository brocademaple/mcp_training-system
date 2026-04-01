// Dataset types (nullable fields match DB/API: may be null before processing)
export interface Dataset {
  id: number;
  user_id: number;
  name: string;
  type: string;
  /** 用途：training 训练集 | test 测试集，与列表 Tab 一一对应，删除/操作互不影响 */
  usage?: 'training' | 'test';
  /** 由「从训练集划分测试集」生成时，对应训练集 id（Go sql.NullInt64 序列化可能为 { Int64, Valid }） */
  derived_from_dataset_id?: number | null | { Int64: number; Valid: boolean };
  /** 来源训练集名称（列表 JOIN 返回；可能为 { String, Valid }） */
  derived_from_dataset_name?: string | null | { String: string; Valid: boolean };
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
  /** 统一 RunSpec（后端返回时可能含推导或持久化结果） */
  run_spec?: RunSpec | Record<string, unknown>;
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

export type RunCurrentState =
  | 'draft'
  | 'intent_submitted'
  | 'task_parsed'
  | 'task_confirmed'
  | 'data_selecting'
  | 'data_validating'
  | 'data_ready'
  | 'plan_generating'
  | 'plan_previewed'
  | 'plan_frozen'
  | 'training_queued'
  | 'training_running'
  | 'training_succeeded'
  | 'evaluating'
  | 'done';

export interface IntentDraftSpec {
  intent_text: string;
  ui_selected_tags?: string[];
  modality_hint?: string;
}

export interface TaskSpec {
  semantic_task_type: string;
  domain: string;
  modality: string;
  output_structure: string;
  recommended_metrics: string[];
  candidate_methods: string[];
  task_schema_id: string;
}

export interface DatasetSpec {
  dataset_source_mode: 'upload' | 'agent_search' | 'agent_convert' | string;
  dataset_id?: string;
  raw_file_path?: string;
  normalized_dataset_path?: string;
  schema_valid: boolean;
  split_strategy: 'preset' | 'auto_split' | string;
  train_path?: string;
  valid_path?: string;
  test_path?: string;
  sample_count?: number;
}

export interface PlanSpec {
  base_model: string;
  training_method: string;
  trainer_backend: string;
  learning_rate: number;
  batch_size: number;
  epochs: number;
  max_seq_length?: number;
  eval_strategy: string;
  expected_outputs: string[];
}

export interface RunTrace {
  trace_id: string;
  run_id: string;
  agent_name: string;
  action: string;
  input_ref?: string;
  output_ref?: string;
  status: string;
  timestamp: string;
}

export interface RunSpec {
  run_id: string;
  task_spec: TaskSpec;
  dataset_spec: DatasetSpec;
  /** 数据确认后写入的结构化校验摘要（前端 mock / 本地状态，可与后端对齐） */
  dataset_validation_report?: Record<string, string>;
  plan_spec: PlanSpec;
  current_state: RunCurrentState;
  created_at: string;
  updated_at: string;
  owner?: string;
  intent_draft?: IntentDraftSpec;
  run_trace?: RunTrace[];
}
