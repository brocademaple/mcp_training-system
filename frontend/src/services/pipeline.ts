import api from './api';

export interface PipelineInstance {
  id: number;
  session_id: string;
  dataset_id: number;
  status: string;
  current_step: string;
  job_id?: number;
  model_id?: number;
  eval_id?: number;
  error_msg?: string;
  plan_id?: string;
  plan_summary?: string;
  created_at: string;
  updated_at?: string;
}

export const pipelineService = {
  list: async (): Promise<PipelineInstance[]> => {
    const res = await api.get('/pipelines');
    return Array.isArray(res) ? res : [];
  },
  getStatus: async (id: number): Promise<PipelineInstance> => {
    const res = await api.get(`/pipelines/${id}`);
    return res as PipelineInstance;
  },
};
