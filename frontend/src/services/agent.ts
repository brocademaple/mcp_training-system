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

/** POST /agent/resolve-intent 与 PlanResult.intent_resolution 结构一致 */
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
  /** 规则引擎解析说明（与 resolve-intent 一致） */
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
  /** 后端规则规划器生成的 RunSpec（语义任务 + 方法 + 领域） */
  run_spec?: RunSpec;
  data_agent_prompt?: string;
  steps: AgentPlanStep[];
  fallback_actions: AgentFallbackAction[];
  estimated_duration_minutes?: number;
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
};

