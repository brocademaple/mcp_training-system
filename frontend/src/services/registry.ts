import api from './api';

export interface TaskFamily {
  id: string;
  label_zh: string;
  default_metrics?: string[];
  supported_methods?: string[];
  tasks?: { id: string; default_schema?: string }[];
}

export interface MethodDef {
  id: string;
  label_zh: string;
  peft?: boolean;
  alignment_only?: boolean;
}

export interface DomainDef {
  id: string;
  label_zh: string;
}

export interface RegistryBundle {
  task_registry: { families: TaskFamily[] };
  method_registry: { methods: MethodDef[] };
  domain_registry: { domains: DomainDef[] };
}

export const registryService = {
  getBundle: async (): Promise<RegistryBundle> => {
    const res = (await api.get('/registry')) as unknown as RegistryBundle;
    return res;
  },
};
