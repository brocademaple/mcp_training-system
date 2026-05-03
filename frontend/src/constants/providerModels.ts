export const PROVIDER_MODEL_OPTIONS: Record<string, { value: string; label: string }[]> = {
  aliyun_qwen: [
    { value: 'qwen-turbo', label: 'qwen-turbo' },
    { value: 'qwen-plus', label: 'qwen-plus' },
    { value: 'qwen-max', label: 'qwen-max' },
    { value: 'qwen-long', label: 'qwen-long' },
  ],
  deepseek: [
    { value: 'deepseek-chat', label: 'deepseek-chat' },
    { value: 'deepseek-reasoner', label: 'deepseek-reasoner' },
  ],
  zhipu_glm: [
    { value: 'glm-4-flash', label: 'glm-4-flash' },
    { value: 'glm-4-plus', label: 'glm-4-plus' },
    { value: 'glm-4-air', label: 'glm-4-air' },
  ],
  volcengine_doubao: [
    { value: 'doubao-1.5-lite-32k', label: 'doubao-1.5-lite-32k' },
    { value: 'doubao-1.5-pro-32k', label: 'doubao-1.5-pro-32k' },
  ],
  moonshot: [
    { value: 'moonshot-v1-8k', label: 'moonshot-v1-8k' },
    { value: 'moonshot-v1-32k', label: 'moonshot-v1-32k' },
    { value: 'moonshot-v1-128k', label: 'moonshot-v1-128k' },
  ],
};
