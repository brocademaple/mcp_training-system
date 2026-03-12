import axios from 'axios';
import type { ApiResponse, Dataset, TrainingJob, Evaluation } from '@/types';

const api = axios.create({
  baseURL: '/api/v1',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor
api.interceptors.request.use(
  (config) => {
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor：保留 status 便于调用方区分 404 等
api.interceptors.response.use(
  (response) => {
    return response.data;
  },
  (error) => {
    const msg = error.response?.data?.message || error.message || '请求失败';
    const status = error.response?.status;
    const err = new Error(msg) as Error & { status?: number };
    if (status != null) err.status = status;
    return Promise.reject(err);
  }
);

export default api;
