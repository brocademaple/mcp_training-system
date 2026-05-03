import api from './api';
import type { RunSpec } from '@/types';

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

export interface IntentResolveResult {
  inferred_intent: string;
  train_mode: 'classic_clf' | 'sft_lora' | string;
  domain_hint: string;
  confidence: 'high' | 'medium' | 'low' | string;
  matched_terms: string[];
  matched_pattern_ids: string[];
  message: string;
}

export interface AgentPlan {
  plan_id: string;
  goal: string;
  inferred_intent: string;
  train_mode?: 'classic_clf' | 'sft_lora' | string;
  intent_resolution?: IntentResolveResult;
  task_spec?: {
    problem_family: string;
    required_columns: string[];
    output_form: string;
    default_train_mode: string;
    notes?: string;
  };
  selected_dataset_candidates: Array<{ id: number; name: string; status: string }>;
  train_config: Record<string, unknown>;
  run_spec?: RunSpec;
  data_agent_prompt?: string;
  steps: AgentPlanStep[];
  fallback_actions: AgentFallbackAction[];
  estimated_duration_minutes?: number;
}

export interface DataAgentReport {
  task_type: string;
  confidence: number;
  trainability: 'high' | 'medium' | 'low' | string;
  reliability: 'high' | 'medium' | 'low' | string;
  issues: string[];
  summary: string;
  recommendations: string[];
  stats: {
    row_count?: number;
    empty_text_ratio?: number;
    duplicate_ratio?: number;
    label_distribution?: Record<string, number>;
    [key: string]: unknown;
  };
  explanation_source?: string;
  [key: string]: unknown;
}

export interface EvaluationAdvice {
  effect: 'good' | 'fair' | 'poor' | string;
  summary: string;
  possible_issues: string[];
  recommendations: string[];
  signals?: Record<string, unknown>;
  explanation_source?: string;
  [key: string]: unknown;
}

export const agentService = {
  resolveIntent: async (goal: string): Promise<IntentResolveResult> => {
    const res = (await api.post('/agent/resolve-intent', { goal })) as { result: IntentResolveResult };
    return res.result;
  },

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

  analyzeDataset: async (datasetId: number): Promise<DataAgentReport> => {
    const res = await api.post(`/agent/datasets/${datasetId}/analyze`) as any;
    return (res.data ?? res) as DataAgentReport;
  },

  getDatasetReport: async (datasetId: number): Promise<DataAgentReport | null> => {
    const res = await api.get(`/agent/datasets/${datasetId}/report`) as any;
    return (res.data ?? res ?? null) as DataAgentReport | null;
  },

  getEvaluationAdvice: async (evaluationId: number): Promise<EvaluationAdvice> => {
    const res = await api.get(`/agent/evaluations/${evaluationId}/advice`) as any;
    return (res.data ?? res) as EvaluationAdvice;
  },
};

