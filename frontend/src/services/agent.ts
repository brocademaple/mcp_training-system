import api from './api';

export interface AgentPlanStep {
  name: 'clean_data' | 'train' | 'evaluate' | string;
  agent: string;
  input_summary: string;
  output_summary: string;
  rationale: string;
}

export interface AgentFallbackAction {
  key: string;
  label: string;
  description: string;
}

export interface AgentPlan {
  plan_id: string;
  goal: string;
  inferred_intent: string;
  train_mode?: 'classic_clf' | 'sft_lora' | string;
  task_spec?: {
    problem_family: string;
    required_columns: string[];
    output_form: string;
    default_train_mode: string;
    notes?: string;
  };
  selected_dataset_candidates: Array<{ id: number; name: string; status: string }>;
  train_config: Record<string, unknown>;
  data_agent_prompt?: string;
  steps: AgentPlanStep[];
  fallback_actions: AgentFallbackAction[];
  estimated_duration_minutes?: number;
}

export const agentService = {
  createPlan: async (payload: {
    goal: string;
    model_type?: string;
    intent?: string;
    material_source?: 'upload' | 'agent' | null;
    data_agent_prompt?: string;
    train_mode?: 'classic_clf' | 'sft_lora' | string;
  }): Promise<AgentPlan> => {
    const res = await api.post('/agent/plan', payload) as any;
    return (res.plan ?? res) as AgentPlan;
  },
};

