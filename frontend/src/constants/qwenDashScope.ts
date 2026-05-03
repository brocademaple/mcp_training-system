/** 与后端 config/qwen_dashscope_ui.go 保持一致，供 GET 失败时兜底 */
export const QWEN_DASHSCOPE_DOC_URL =
  'https://help.aliyun.com/zh/model-studio/developer-reference/use-qwen-by-calling-api';

export const QWEN_BASE_URL_FALLBACK: { value: string; label: string }[] = [
  {
    value: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    label: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  },
  {
    value: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    label: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  },
  {
    value: 'https://dashscope-us.aliyuncs.com/compatible-mode/v1',
    label: 'https://dashscope-us.aliyuncs.com/compatible-mode/v1',
  },
  {
    value: 'https://cn-hongkong.dashscope.aliyuncs.com/compatible-mode/v1',
    label: 'https://cn-hongkong.dashscope.aliyuncs.com/compatible-mode/v1',
  },
];

export const QWEN_MODEL_FALLBACK: { value: string; label: string }[] = [
  { value: 'qwen-turbo', label: 'qwen-turbo（轻量、低延迟）' },
  { value: 'qwen-flash', label: 'qwen-flash' },
  { value: 'qwen-plus', label: 'qwen-plus' },
  { value: 'qwen-max', label: 'qwen-max' },
  { value: 'qwen-long', label: 'qwen-long（长文本）' },
  { value: 'qwen2.5-7b-instruct', label: 'qwen2.5-7b-instruct' },
  { value: 'qwen2.5-14b-instruct', label: 'qwen2.5-14b-instruct' },
  { value: 'qwen2.5-32b-instruct', label: 'qwen2.5-32b-instruct' },
  { value: 'qwen2.5-72b-instruct', label: 'qwen2.5-72b-instruct' },
];

export const QWEN_CUSTOM_BASE = '__custom__';
