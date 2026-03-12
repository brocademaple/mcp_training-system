import api from './api';

export interface SyncFromDiskResult {
  datasets_recovered: number;
  models_recovered: number;
  message?: string;
}

export const syncService = {
  /** 从 data/uploads 与 data/models 一次性补全数据集、模型及训练任务记录 */
  syncFromDisk: async (userId?: number): Promise<{ code: number; data?: SyncFromDiskResult; message?: string }> => {
    const params = userId != null ? { user_id: userId } : undefined;
    return api.post('/sync-from-disk', null, { params });
  },
};
