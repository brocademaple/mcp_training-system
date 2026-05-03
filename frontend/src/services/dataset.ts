import api from './api';
import type { ApiResponse, Dataset, DatasetAIAnalysis } from '@/types';

export type UploadDatasetResponse = {
  dataset_id: number;
  status: string;
  ai_analysis: DatasetAIAnalysis | null;
  analysis_error?: string;
  session_id?: string;
};

export const datasetService = {
  uploadDataset: async (
    file: File,
    name: string,
    type: string,
    usage: 'training' | 'test' = 'training',
    session_id?: string
  ): Promise<ApiResponse<UploadDatasetResponse>> => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('name', name);
    formData.append('type', type);
    formData.append('usage', usage);
    if (session_id) {
      formData.append('session_id', session_id);
    }

    return api.post('/datasets/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
  },

  getDatasets: async (usage?: 'training' | 'test'): Promise<ApiResponse<{ total: number; datasets: Dataset[] }>> => {
    const params = usage ? { usage } : undefined;
    return api.get('/datasets', { params });
  },

  getDatasetDetail: async (id: number): Promise<ApiResponse<Dataset>> => {
    return api.get(`/datasets/${id}`);
  },

  getDatasetPreview: async (
    id: number,
    limit?: number
  ): Promise<ApiResponse<{ columns: string[]; rows: Record<string, string>[]; total: number }>> => {
    const params = limit != null ? { limit } : undefined;
    return api.get(`/datasets/${id}/preview`, { params });
  },

  retryClean: async (id: number): Promise<ApiResponse<{ status: string }>> => {
    return api.post(`/datasets/${id}/retry-clean`);
  },

  confirmAnalysis: async (
    id: number,
    payload: {
      confirmed_task_type:
        | 'text_classification'
        | 'text_generation'
        | 'named_entity_recognition'
        | 'summarization'
        | 'sentiment_analysis'
        | 'other';
      confirmed_domain: 'general' | 'finance' | 'medical' | 'legal' | 'ecommerce' | 'other';
      session_id?: string;
    }
  ): Promise<ApiResponse<{ dataset_id: number; confirmed_task_type: string; confirmed_domain: string; session_id?: string }>> => {
    return api.post(`/datasets/${id}/confirm-analysis`, payload);
  },

  deleteDataset: async (id: number): Promise<ApiResponse> => {
    return api.delete(`/datasets/${id}`);
  },

  updateName: async (id: number, name: string): Promise<ApiResponse> => {
    return api.patch(`/datasets/${id}`, { name });
  },

  bulkDelete: async (ids: number[]): Promise<ApiResponse<{ deleted?: number }>> => {
    return api.post('/datasets/bulk-delete', { ids });
  },

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
