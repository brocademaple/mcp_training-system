/** 与后端 settings 中 providers 的 key 一致 */
export const LLM_PROVIDER_LIST = [
  {
    id: 'aliyun_qwen',
    label: '阿里云 · 通义千问',
    short: '通义千问',
    hint: 'DashScope OpenAI 兼容模式；当前「意图识别 / Planning」走此配置',
  },
  { id: 'openai', label: 'OpenAI', short: 'OpenAI', hint: 'GPT 系列（配置已保存，后续可接业务）' },
  { id: 'azure_openai', label: 'Azure OpenAI', short: 'Azure', hint: '企业版 OpenAI 部署' },
  { id: 'anthropic', label: 'Anthropic · Claude', short: 'Claude', hint: 'Claude 系列' },
  { id: 'google_gemini', label: 'Google · Gemini', short: 'Gemini', hint: 'Gemini API' },
  { id: 'deepseek', label: 'DeepSeek', short: 'DeepSeek', hint: 'DeepSeek 官方 API' },
  { id: 'zhipu_glm', label: '智谱 · GLM', short: '智谱', hint: 'GLM 系列' },
  { id: 'volcengine_doubao', label: '火山引擎 · 豆包', short: '豆包', hint: '字节方舟 / 豆包大模型' },
  { id: 'moonshot', label: '月之暗面 · Moonshot', short: 'Moonshot', hint: 'Kimi / Moonshot API' },
] as const;

export type LlmProviderId = (typeof LLM_PROVIDER_LIST)[number]['id'];
