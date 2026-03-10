import api from './api';
import type { ApiResponse, Evaluation } from '@/types';

export const evaluationService = {
  // Get evaluations list
  getEvaluations: async (): Promise<ApiResponse<{ evaluations: Evaluation[] }>> => {
    return api.get('/evaluations');
  },

  // Create evaluation
  createEvaluation: async (params: {
    model_id: number;
    test_dataset_id?: number;
  }): Promise<ApiResponse> => {
    return api.post('/evaluations', params);
  },

  // Get evaluation result
  getEvaluationResult: async (id: number): Promise<ApiResponse<Evaluation>> => {
    return api.get(`/evaluations/${id}`);
  },

  // Get report download URL (for <a download> or window.open)
  getReportDownloadUrl: (evaluationId: number): string => {
    return `/api/v1/reports/download/${evaluationId}`;
  },
};
