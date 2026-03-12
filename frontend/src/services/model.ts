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

  // 扫描 data/models 下已有目录，将磁盘上存在但数据库无记录的模型补写为训练任务+模型记录
  recoverFromDisk: async (userId?: number): Promise<ApiResponse<{ recovered: number; message?: string }>> => {
    const params = userId != null ? { user_id: userId } : undefined;
    return api.post('/models/recover-from-disk', null, { params });
  },
};
