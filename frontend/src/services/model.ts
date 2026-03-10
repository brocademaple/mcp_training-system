import api from './api';
import type { ApiResponse, Model } from '@/types';

export const modelService = {
  // Get all models (optional user_id query)
  getModels: async (userId?: number): Promise<ApiResponse<{ models: Model[] }>> => {
    const params = userId != null ? { user_id: userId } : undefined;
    return api.get('/models', { params });
  },

  // Get download URL for a model (for <a download> or window.open)
  getDownloadUrl: (modelId: number): string => {
    return `/api/v1/models/${modelId}/download`;
  },
};
