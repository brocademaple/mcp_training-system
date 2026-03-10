// Dataset types
export interface Dataset {
  id: number;
  user_id: number;
  name: string;
  type: string;
  source: string;
  original_file_path: string;
  cleaned_file_path: string;
  row_count: number;
  column_count: number;
  file_size: number;
  status: 'uploading' | 'processing' | 'ready' | 'error';
  error_message?: string;
  created_at: string;
  updated_at: string;
}

// Training Job types
export interface TrainingJob {
  id: number;
  user_id: number;
  dataset_id: number;
  model_type: string;
  hyperparams: {
    learning_rate: number;
    batch_size: number;
    epochs: number;
  };
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress: number;
  current_epoch: number;
  total_epochs: number;
  error_message?: string;
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
  accuracy: number;
  precision: number;
  recall: number;
  f1_score: number;
  metrics: Record<string, any>;
  confusion_matrix_path?: string;
  roc_curve_path?: string;
  report_path?: string;
  created_at: string;
}

// API Response types
export interface ApiResponse<T = any> {
  code: number;
  message: string;
  data?: T;
}
