import api from './api';
import type { ApiResponse, Dataset } from '@/types';

export const datasetService = {
  // Upload dataset
  uploadDataset: async (file: File, name: string, type: string): Promise<ApiResponse> => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('name', name);
    formData.append('type', type);

    return api.post('/datasets/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
  },

  // Get all datasets
  getDatasets: async (): Promise<ApiResponse<{ total: number; datasets: Dataset[] }>> => {
    return api.get('/datasets');
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

  // Import dataset from URL (crawl/fetch CSV from link)
  importFromUrl: async (params: {
    name: string;
    url: string;
    type?: string;
    column_map?: Record<string, string>;
  }): Promise<ApiResponse<{ dataset_id: number; status: string }>> => {
    const body: { name: string; url: string; type: string; column_map?: Record<string, string> } = {
      name: params.name,
      url: params.url,
      type: params.type || 'text',
    };
    if (params.column_map && Object.keys(params.column_map).length > 0) {
      body.column_map = params.column_map;
    }
    return api.post('/datasets/from-url', body);
  },
};
