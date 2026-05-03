import api from './api';
import type { ApiResponse, Project } from '@/types';

export const projectService = {
  list: async (): Promise<ApiResponse<{ projects: Project[] }>> => {
    return api.get('/projects');
  },

  create: async (payload: { name: string; description?: string }): Promise<ApiResponse<Project>> => {
    return api.post('/projects', payload);
  },

  patch: async (id: number, payload: { name?: string; description?: string }): Promise<ApiResponse<Project>> => {
    return api.patch(`/projects/${id}`, payload);
  },
};
