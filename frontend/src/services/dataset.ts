import api from './api';
import type { ApiResponse, Dataset } from '@/types';

export const datasetService = {
  // Upload dataset；usage 与当前 Tab 一致（training | test）
  uploadDataset: async (file: File, name: string, type: string, usage: 'training' | 'test' = 'training'): Promise<ApiResponse> => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('name', name);
    formData.append('type', type);
    formData.append('usage', usage);

    return api.post('/datasets/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
  },

  // Get datasets, optionally filtered by usage (training | test)，与「训练数据集/测试数据集」Tab 对应
  getDatasets: async (usage?: 'training' | 'test'): Promise<ApiResponse<{ total: number; datasets: Dataset[] }>> => {
    const params = usage ? { usage } : undefined;
    return api.get('/datasets', { params });
  },

  // Get dataset detail
  getDatasetDetail: async (id: number): Promise<ApiResponse<Dataset>> => {
    return api.get(`/datasets/${id}`);
  },

  // Get dataset data preview (first N rows) for display in table
  getDatasetPreview: async (
    id: number,
    limit?: number
  ): Promise<ApiResponse<{ columns: string[]; rows: Record<string, string>[]; total: number }>> => {
    const params = limit != null ? { limit } : undefined;
    return api.get(`/datasets/${id}/preview`, { params });
  },

  // Retry clean for dataset in error state
  retryClean: async (id: number): Promise<ApiResponse<{ status: string }>> => {
    return api.post(`/datasets/${id}/retry-clean`);
  },

  // Delete dataset by id
  deleteDataset: async (id: number): Promise<ApiResponse> => {
    return api.delete(`/datasets/${id}`);
  },

  // 从已清洗的训练集按比例划分出测试集，生成一条直接可用的测试集记录
  splitDataset: async (
    datasetId: number,
    trainRatio: number
  ): Promise<
    ApiResponse<{
      test_dataset_id: number;
      test_count: number;
    }>
  > => {
    return api.post(`/datasets/${datasetId}/split`, {
      train_ratio: trainRatio,
    });
  },

  // Import dataset from URL；usage 与当前 Tab 一致（training | test）
  importFromUrl: async (params: {
    name: string;
    url: string;
    type?: string;
    usage?: 'training' | 'test';
    column_map?: Record<string, string>;
  }): Promise<ApiResponse<{ dataset_id: number; status: string }>> => {
    const body: { name: string; url: string; type: string; usage?: string; column_map?: Record<string, string> } = {
      name: params.name,
      url: params.url,
      type: params.type || 'text',
    };
    if (params.usage) body.usage = params.usage;
    if (params.column_map && Object.keys(params.column_map).length > 0) {
      body.column_map = params.column_map;
    }
    return api.post('/datasets/from-url', body);
  },
};
