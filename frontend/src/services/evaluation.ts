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
    name?: string;
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

  // Get report preview URL (for iframe inline display)
  getReportPreviewUrl: (evaluationId: number): string => {
    return `/api/v1/reports/preview/${evaluationId}`;
  },

  // 中止评估（仅 status=running 可调用）
  cancelEvaluation: async (id: number): Promise<ApiResponse<{ status: string }>> => {
    return api.post(`/evaluations/${id}/cancel`);
  },

  // 删除评估记录
  deleteEvaluation: async (id: number): Promise<ApiResponse> => {
    return api.delete(`/evaluations/${id}`);
  },

  // 失败原因洞察：根据 error_message 解析出问题归类、摘要与建议
  getEvaluationInsight: async (
    id: number
  ): Promise<
    ApiResponse<{
      raw_message: string;
      insight: { category: string; summary: string; suggestions: string[] };
    }>
  > => {
    return api.get(`/evaluations/${id}/insight`);
  },
};
