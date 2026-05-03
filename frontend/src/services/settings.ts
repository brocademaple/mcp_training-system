import api from './api';

export type LlmProviderRow = {
  base_url: string;
  model: string;
  api_key_masked: string;
  api_key_configured: boolean;
  extra?: Record<string, string>;
};

export type QwenUiPack = {
  base_url_options: { value: string; label: string }[];
  model_options: { value: string; label: string }[];
  doc_url: string;
};

export type LlmSettingsData = {
  settings_path: string;
  intent_resolver_provider: string;
  effective_intent_resolver: string;
  effective_aliyun_base_url: string;
  effective_aliyun_intent_model: string;
  effective_aliyun_api_configured: boolean;
  providers: Record<string, LlmProviderRow>;
  ui?: { aliyun_qwen?: QwenUiPack };
};

export async function getLlmSettings(): Promise<LlmSettingsData> {
  const res = (await api.get('/agent/llm-settings')) as { code: number; data: LlmSettingsData; message?: string };
  if (res.code !== 200 || !res.data) {
    throw new Error(res.message || '加载设置失败');
  }
  return res.data;
}

export type QwenConnectivityResult = {
  ok: boolean;
  message: string;
  http_status?: number;
  detail?: string;
  resolved_base_url?: string;
  model?: string;
};

export type ProviderConnectivityResult = {
  ok: boolean;
  message: string;
  http_status?: number;
  detail?: string;
  resolved_base_url?: string;
  model?: string;
};

/** POST /agent/llm-settings/test-qwen — DashScope 最小 chat 请求探测 */
export async function postQwenConnectivityTest(body: {
  api_key?: string;
  base_url?: string;
  model?: string;
}): Promise<QwenConnectivityResult> {
  const res = (await api.post('/agent/llm-settings/test-qwen', body)) as {
    code: number;
    message?: string;
    data?: {
      http_status?: number;
      detail?: string;
      reply_excerpt?: string;
      resolved_base_url?: string;
      model?: string;
    };
  };
  if (res.code === 200) {
    return {
      ok: true,
      message: res.message || 'success',
      http_status: res.data?.http_status,
      detail: res.data?.reply_excerpt,
      resolved_base_url: res.data?.resolved_base_url,
      model: res.data?.model,
    };
  }
  return {
    ok: false,
    message: res.message || '连通失败',
    http_status: res.data?.http_status,
    detail: res.data?.detail,
  };
}

export async function postProviderConnectivityTest(body: {
  provider: string;
  api_key?: string;
  base_url?: string;
  model?: string;
}): Promise<ProviderConnectivityResult> {
  const res = (await api.post('/agent/llm-settings/test-provider', body)) as {
    code: number;
    message?: string;
    data?: {
      http_status?: number;
      detail?: string;
      resolved_base_url?: string;
      model?: string;
    };
  };
  if (res.code === 200) {
    return {
      ok: true,
      message: res.message || 'success',
      http_status: res.data?.http_status,
      detail: res.data?.detail,
      resolved_base_url: res.data?.resolved_base_url,
      model: res.data?.model,
    };
  }
  return {
    ok: false,
    message: res.message || '连通失败',
    http_status: res.data?.http_status,
    detail: res.data?.detail,
  };
}

export async function putLlmSettings(body: {
  intent_resolver_provider?: string;
  providers: Record<
    string,
    {
      api_key?: string;
      base_url?: string;
      model?: string;
      extra?: Record<string, string>;
    }
  >;
}): Promise<void> {
  const res = (await api.put('/agent/llm-settings', body)) as { code: number; message?: string };
  if (res.code !== 200) {
    throw new Error(res.message || '保存失败');
  }
}
