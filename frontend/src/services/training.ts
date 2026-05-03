import api from './api';
import type { ApiResponse, RunSpec, TrainingJob } from '@/types';

export const trainingService = {
  // Create training job
  createJob: async (params: {
    name?: string;
    project_id?: number;
    dataset_id: number;
    model_type: string;
    hyperparams: {
      learning_rate: number;
      batch_size: number;
      epochs: number;
      base_model?: string;
      [key: string]: unknown;
    };
    /** 可选：提供时服务端据此校验并派生 model_type */
    run_spec?: RunSpec | Record<string, unknown>;
    session_id?: string;
  }): Promise<ApiResponse> => {
    return api.post('/training/jobs', params);
  },

  // Get jobs list
  getJobs: async (project_id?: number): Promise<ApiResponse<{ jobs: TrainingJob[] }>> => {
    return api.get('/training/jobs', { params: project_id ? { project_id } : undefined });
  },

  // Get job status
  getJobStatus: async (id: number): Promise<ApiResponse<TrainingJob>> => {
    return api.get(`/training/jobs/${id}`);
  },

  /** 原始过程日志（Redis 列表，与 GetJobStatus 中 log_lines 同源） */
  getRawLogs: async (id: number): Promise<ApiResponse<{ logs: string[] }>> => {
    return api.get(`/training/jobs/${id}/raw-logs`);
  },

  // Restart training job (only for failed/completed/cancelled)
  restartJob: async (id: number): Promise<ApiResponse<{ job_id: number; status: string }>> => {
    return api.post(`/training/jobs/${id}/restart`);
  },

  // Cancel running training job
  cancelJob: async (id: number): Promise<ApiResponse<{ job_id: number; status: string }>> => {
    return api.post(`/training/jobs/${id}/cancel`);
  },

  // Delete training job
  deleteJob: async (id: number): Promise<ApiResponse<void>> => {
    return api.delete(`/training/jobs/${id}`);
  },

  // WebSocket URL for real-time training progress
  getProgressWsUrl: (jobId: number): string => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws/training/${jobId}`;
  },
};
