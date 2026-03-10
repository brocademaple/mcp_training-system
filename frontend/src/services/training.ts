import api from './api';
import type { ApiResponse, TrainingJob } from '@/types';

export const trainingService = {
  // Create training job
  createJob: async (params: {
    dataset_id: number;
    model_type: string;
    hyperparams: {
      learning_rate: number;
      batch_size: number;
      epochs: number;
    };
  }): Promise<ApiResponse> => {
    return api.post('/training/jobs', params);
  },

  // Get jobs list
  getJobs: async (): Promise<ApiResponse<{ jobs: TrainingJob[] }>> => {
    return api.get('/training/jobs');
  },

  // Get job status
  getJobStatus: async (id: number): Promise<ApiResponse<TrainingJob>> => {
    return api.get(`/training/jobs/${id}`);
  },

  // WebSocket URL for real-time training progress
  getProgressWsUrl: (jobId: number): string => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws/training/${jobId}`;
  },
};
