import React, { useCallback, useState } from 'react';
import {
  Button,
  Divider,
  Drawer,
  Form,
  Input,
  Popover,
  Select,
  Space,
  Spin,
  Tabs,
  Typography,
  message,
} from 'antd';
import type { FormInstance } from 'antd/es/form';
import { InfoCircleOutlined } from '@ant-design/icons';
import { LLM_PROVIDER_LIST } from '@/constants/llmProviders';
import { PROVIDER_MODEL_OPTIONS } from '@/constants/providerModels';
import {
  QWEN_BASE_URL_FALLBACK,
  QWEN_CUSTOM_BASE,
  QWEN_DASHSCOPE_DOC_URL,
  QWEN_MODEL_FALLBACK,
} from '@/constants/qwenDashScope';
import {
  getLlmSettings,
  postProviderConnectivityTest,
  putLlmSettings,
  type LlmSettingsData,
} from '@/services/settings';
import './index.css';

type FormShape = {
  intent_resolver_provider: string;
  providers: Record<
    string,
    {
      api_key?: string;
      base_url?: string;
      model?: string;
      deployment?: string;
      api_version?: string;
    }
  >;
};

const INTENT_OPTIONS = [
  { value: 'rules', label: '规则引擎（不调通义，按关键词推断）' },
  { value: 'aliyun', label: '通义千问（每次解析都调用 DashScope）' },
  { value: 'hybrid', label: '通义优先（失败时自动退回规则）' },
];

/** 说明类文案不进主流程，统一用图标 + 弹层（点击展开） */
function HelpIconPopover({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Popover
      title={title}
      trigger="click"
      placement="leftTop"
      overlayClassName="llm-settings-help-overlay"
      content={<div className="llm-settings-help-popover">{children}</div>}
    >
      <button
        type="button"
        className="llm-settings-help-trigger"
        aria-label={`${title}（点击查看）`}
        onClick={(e) => e.stopPropagation()}
      >
        <InfoCircleOutlined />
      </button>
    </Popover>
  );
}

function buildInitialForm(data: LlmSettingsData): FormShape {
  const providers: FormShape['providers'] = {};
  const firstPresetBase =
    data.ui?.aliyun_qwen?.base_url_options?.[0]?.value ?? QWEN_BASE_URL_FALLBACK[0].value;

  for (const p of LLM_PROVIDER_LIST) {
    const row = data.providers[p.id] || {
      base_url: '',
      model: '',
      api_key_configured: false,
      api_key_masked: '',
    };
    const extra = row.extra || {};
    let baseUrl = row.base_url || '';
    let model = row.model || '';
    if (p.id === 'aliyun_qwen') {
      if (!baseUrl.trim()) {
        baseUrl = data.effective_aliyun_base_url || firstPresetBase;
      }
      if (!model.trim()) {
        model = data.effective_aliyun_intent_model || 'qwen-turbo';
      }
    }
    const masked = (row.api_key_masked || '').trim();
    const showKey = row.api_key_configured && masked ? masked : '';
    providers[p.id] = {
      api_key: showKey,
      base_url: baseUrl,
      model,
      deployment: extra.deployment ?? '',
      api_version: extra.api_version ?? '',
    };
  }
  return {
    intent_resolver_provider: data.intent_resolver_provider || 'rules',
    providers,
  };
}

function QwenProviderFields({
  form,
  snapshot,
}: {
  form: FormInstance<FormShape>;
  snapshot: LlmSettingsData | null;
}) {
  const [testing, setTesting] = useState(false);
  const baseOptions = snapshot?.ui?.aliyun_qwen?.base_url_options ?? QWEN_BASE_URL_FALLBACK;
  const modelOptions = snapshot?.ui?.aliyun_qwen?.model_options ?? QWEN_MODEL_FALLBACK;
  const docUrl = snapshot?.ui?.aliyun_qwen?.doc_url ?? QWEN_DASHSCOPE_DOC_URL;
  const qwenRow = snapshot?.providers?.aliyun_qwen;
  const keyConfigured = !!qwenRow?.api_key_configured;

  const baseUrl = Form.useWatch(['providers', 'aliyun_qwen', 'base_url'], form) ?? '';
  const known = baseOptions.some((o) => o.value === baseUrl);
  const selectBaseVal = known ? baseUrl : QWEN_CUSTOM_BASE;

  const maskedSaved = (qwenRow?.api_key_masked || '').trim();

  const runTest = async () => {
    const q = form.getFieldValue(['providers', 'aliyun_qwen']) || {};
    const keyInForm = (q.api_key as string | undefined)?.trim();
    const usingSavedKey =
      !keyInForm || (!!maskedSaved && keyInForm === maskedSaved);
    const hasKeyForTest = !usingSavedKey || !!snapshot?.effective_aliyun_api_configured;
    if (!hasKeyForTest) {
      message.warning('请先填写 API Key，或保存过通义 Key 后再测');
      return;
    }
    if (!known && !(q.base_url as string)?.trim()) {
      message.warning('请选择或填写 Base URL');
      return;
    }
    setTesting(true);
    try {
      const apiKeyForRequest =
        keyInForm && (!maskedSaved || keyInForm !== maskedSaved)
          ? keyInForm
          : undefined;
      const r = await postProviderConnectivityTest({
        provider: 'aliyun_qwen',
        api_key: apiKeyForRequest,
        base_url: (q.base_url as string)?.trim() || undefined,
        model: (q.model as string)?.trim() || undefined,
      });
      if (r.ok) {
        message.success(
          `连通成功 · HTTP ${r.http_status ?? 200}` +
            (r.model ? ` · ${r.model}` : '')
        );
      } else {
        message.error((r.message || '请求失败') + (r.detail ? ` · ${r.detail}` : ''));
      }
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : '请求失败');
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="llm-settings-tab-body">
      <Form.Item
        label={(
          <Space size={6}>
            <span>API Key</span>
            <HelpIconPopover title="API Key 与连通测试">
              <p>
                已保存的 Key 在服务器侧脱敏存储；输入框<strong>留空并保存</strong>表示不修改已有 Key。
              </p>
              <p>
                <strong>连通测试</strong>：发起到{' '}
                <Typography.Text code>/chat/completions</Typography.Text> 的探测请求（极短输入、最多 1
                个输出 token，省额度）。优先用输入框里的新 Key；若显示为已保存的脱敏串或未改，则用服务器已保存 Key。
              </p>
              <Divider style={{ margin: '10px 0' }} />
              <Typography.Text type="secondary">
                {keyConfigured
                  ? `当前已保存：${qwenRow?.api_key_masked || '已配置'}`
                  : '当前未保存过通义 Key'}
              </Typography.Text>
            </HelpIconPopover>
          </Space>
        )}
      >
        <Space.Compact style={{ width: '100%' }}>
          <Form.Item name={['providers', 'aliyun_qwen', 'api_key']} noStyle>
            <Input.Password
              style={{ flex: 1 }}
              autoComplete="off"
              placeholder={
                keyConfigured ? '已保存（脱敏显示）；输入新 Key 可覆盖' : 'DashScope API Key'
              }
            />
          </Form.Item>
          <Button type="default" loading={testing} onClick={() => void runTest()}>
            连通测试
          </Button>
        </Space.Compact>
      </Form.Item>

      <Form.Item
        label={(
          <Space size={6}>
            <span>Base URL</span>
            <HelpIconPopover title="Base URL（OpenAI 兼容）">
              <p>
                使用阿里云百炼 DashScope 的 <strong>OpenAI 兼容模式</strong>，请求路径为{' '}
                <Typography.Text code>/chat/completions</Typography.Text>。
              </p>
              <p>下拉里为官方 Base URL 完整地址；须以 <Typography.Text code>/compatible-mode/v1</Typography.Text> 结尾，且<strong>不要</strong>末尾多一个斜杠。</p>
            </HelpIconPopover>
          </Space>
        )}
        required
      >
        <Space direction="vertical" style={{ width: '100%' }} size={8}>
          <Select
            value={selectBaseVal}
            popupMatchSelectWidth={false}
            style={{ width: '100%' }}
            options={[
              ...baseOptions.map((o) => ({
                value: o.value,
                label: o.value,
              })),
              { value: QWEN_CUSTOM_BASE, label: '自定义…' },
            ]}
            onChange={(v: string) => {
              if (v === QWEN_CUSTOM_BASE) {
                form.setFieldValue(['providers', 'aliyun_qwen', 'base_url'], '');
              } else {
                form.setFieldValue(['providers', 'aliyun_qwen', 'base_url'], v);
              }
            }}
          />
          {!known ? (
            <Form.Item
              name={['providers', 'aliyun_qwen', 'base_url']}
              noStyle
              rules={[{ required: true, message: '请输入完整 Base URL' }]}
            >
              <Input placeholder="https://…/compatible-mode/v1" />
            </Form.Item>
          ) : (
            <Form.Item name={['providers', 'aliyun_qwen', 'base_url']} hidden>
              <Input />
            </Form.Item>
          )}
        </Space>
      </Form.Item>

      <Form.Item
        name={['providers', 'aliyun_qwen', 'model']}
        label={(
          <Space size={6}>
            <span>模型</span>
            <HelpIconPopover title="模型说明">
              <p>用于意图解析等调用时的 <Typography.Text code>model</Typography.Text> 参数，须与当前地域/账号在百炼控制台中可用的模型名一致。</p>
              <p>
                <Typography.Link href={docUrl} target="_blank" rel="noopener noreferrer">
                  官方文档：通过 API 调用千问
                </Typography.Link>
              </p>
            </HelpIconPopover>
          </Space>
        )}
        rules={[{ required: true, message: '请选择模型' }]}
      >
        <Select
          showSearch
          optionFilterProp="label"
          popupMatchSelectWidth={false}
          options={modelOptions.map((o) => ({
            value: o.value,
            label: `${o.label}（${o.value}）`,
          }))}
          placeholder="选择模型"
        />
      </Form.Item>
    </div>
  );
}

function GenericProviderFields({
  form,
  snapshot,
  providerId,
}: {
  form: FormInstance<FormShape>;
  snapshot: LlmSettingsData | null;
  providerId: string;
}) {
  const [testing, setTesting] = useState(false);
  const row = snapshot?.providers?.[providerId];
  const keyConfigured = !!row?.api_key_configured;
  const maskedSaved = (row?.api_key_masked || '').trim();
  const modelOptions = PROVIDER_MODEL_OPTIONS[providerId] || [];

  const runTest = async () => {
    const p = form.getFieldValue(['providers', providerId]) || {};
    const keyInForm = (p.api_key as string | undefined)?.trim();
    const usingSavedKey = !keyInForm || (!!maskedSaved && keyInForm === maskedSaved);
    const hasKeyForTest = !usingSavedKey || keyConfigured;
    if (!hasKeyForTest) {
      message.warning('请先填写 API Key，或先保存后再测');
      return;
    }
    setTesting(true);
    try {
      const apiKeyForRequest =
        keyInForm && (!maskedSaved || keyInForm !== maskedSaved) ? keyInForm : undefined;
      const r = await postProviderConnectivityTest({
        provider: providerId,
        api_key: apiKeyForRequest,
        base_url: (p.base_url as string)?.trim() || undefined,
        model: (p.model as string)?.trim() || undefined,
      });
      if (r.ok) {
        message.success(`连通成功 · HTTP ${r.http_status ?? 200}` + (r.model ? ` · ${r.model}` : ''));
      } else {
        message.error((r.message || '请求失败') + (r.detail ? ` · ${r.detail}` : ''));
      }
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : '请求失败');
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="llm-settings-tab-body">
      <Form.Item label="API Key">
        <Space.Compact style={{ width: '100%' }}>
          <Form.Item name={['providers', providerId, 'api_key']} noStyle>
            <Input.Password
              style={{ flex: 1 }}
              autoComplete="off"
              placeholder={keyConfigured ? '已保存（脱敏显示）；输入新 Key 可覆盖' : 'API Key'}
            />
          </Form.Item>
          <Button type="default" loading={testing} onClick={() => void runTest()}>
            连通测试
          </Button>
        </Space.Compact>
      </Form.Item>
      <Form.Item name={['providers', providerId, 'base_url']} label="Base URL">
        <Input placeholder="https://...（OpenAI 兼容地址）" />
      </Form.Item>
      <Form.Item name={['providers', providerId, 'model']} label="模型">
        {modelOptions.length > 0 ? (
          <Select showSearch optionFilterProp="label" options={modelOptions} placeholder="请选择模型" />
        ) : (
          <Input placeholder="模型 id" />
        )}
      </Form.Item>
      {providerId === 'azure_openai' ? (
        <>
          <Form.Item name={['providers', providerId, 'deployment']} label="Deployment">
            <Input placeholder="部署名" />
          </Form.Item>
          <Form.Item name={['providers', providerId, 'api_version']} label="API Version">
            <Input placeholder="如 2024-02-15-preview" />
          </Form.Item>
        </>
      ) : null}
    </div>
  );
}

export const LlmApiSettingsTrigger: React.FC<{ className?: string }> = ({ className }) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [snapshot, setSnapshot] = useState<LlmSettingsData | null>(null);
  const [form] = Form.useForm<FormShape>();

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      try {
        const data = await getLlmSettings();
        setSnapshot(data);
        form.setFieldsValue(buildInitialForm(data));
      } catch (e: unknown) {
        message.error(e instanceof Error ? e.message : '加载失败');
      } finally {
        if (!opts?.silent) setLoading(false);
      }
    },
    [form]
  );

  const onOpen = () => {
    setOpen(true);
    void load();
  };

  const onSave = async () => {
    const values = await form.validateFields();
    if (!snapshot) return;
    const aq = values.providers?.aliyun_qwen;
    if (aq && !String(aq.base_url || '').trim()) {
      message.warning('请为通义千问填写 Base URL');
      return;
    }
    const providers: Parameters<typeof putLlmSettings>[0]['providers'] = {};
    for (const meta of LLM_PROVIDER_LIST) {
      const b = values.providers?.[meta.id] || {};
      const prev = snapshot.providers[meta.id];
      const patch: {
        api_key?: string;
        base_url?: string;
        model?: string;
        extra?: Record<string, string>;
      } = {};
      const keyTrim = (b.api_key ?? '').trim();
      const prevMasked = (prev?.api_key_masked ?? '').trim();
      if (keyTrim && keyTrim !== prevMasked) {
        patch.api_key = keyTrim;
      }
      patch.base_url = (b.base_url ?? '').trim();
      patch.model = (b.model ?? '').trim();
      if (meta.id === 'azure_openai') {
        const ex: Record<string, string> = { ...(prev?.extra || {}) };
        if (b.deployment !== undefined) ex.deployment = (b.deployment ?? '').trim();
        if (b.api_version !== undefined) ex.api_version = (b.api_version ?? '').trim();
        if (Object.keys(ex).length) patch.extra = ex;
      }
      providers[meta.id] = patch;
    }
    setSaving(true);
    try {
      await putLlmSettings({
        intent_resolver_provider: values.intent_resolver_provider,
        providers,
      });
      message.success('已保存');
      await load({ silent: true });
      setOpen(false);
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const tabItems = LLM_PROVIDER_LIST.map((meta) => ({
    key: meta.id,
    label: (
      <span className="llm-settings-tab-label">
        <span>{meta.short}</span>
        <span
          className="llm-settings-tab-label-help"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          role="presentation"
        >
          <HelpIconPopover title={`${meta.short} · 说明`}>
            {meta.id === 'aliyun_qwen' ? (
              <>
                <p>
                  本页配置阿里云百炼 <strong>DashScope</strong>（OpenAI 兼容）。后端当前会读取此处的 Key、Base URL、模型，用于<strong>意图解析</strong>与
                  Planning 相关通义调用。
                </p>
                <p>
                  <Typography.Link href={QWEN_DASHSCOPE_DOC_URL} target="_blank" rel="noopener noreferrer">
                    官方文档：通过 API 调用千问
                  </Typography.Link>
                </p>
              </>
            ) : (
              <p>{meta.hint}</p>
            )}
          </HelpIconPopover>
        </span>
      </span>
    ),
    children:
      meta.id === 'aliyun_qwen' ? (
        <QwenProviderFields form={form} snapshot={snapshot} />
      ) : (
        <GenericProviderFields form={form} snapshot={snapshot} providerId={meta.id} />
      ),
  }));

  return (
    <>
      <Button
        type="default"
        className={`llm-api-pill ${className || ''}`.trim()}
        onClick={onOpen}
        aria-label="AI 模型 API 配置"
      >
        API
      </Button>
      <Drawer
        title={(
          <Space size={8}>
            <span>AI 模型 API 配置</span>
            <HelpIconPopover title="配置说明（用户 / 开发者）">
              <p>
                配置持久化在服务器文件 <Typography.Text code>{snapshot?.settings_path || './data/llm_settings.json'}</Typography.Text>（路径以接口返回为准）。
              </p>
              <p>
                当前后端<strong>实际消费</strong>的是 <strong>通义千问</strong> 页的 API Key、Base URL 与模型，用于意图解析及 Planning 中的 DashScope 调用；其它厂商字段仅保存，供后续功能扩展。
              </p>
            </HelpIconPopover>
          </Space>
        )}
        placement="right"
        width={Math.min(560, typeof window !== 'undefined' ? window.innerWidth - 24 : 560)}
        open={open}
        onClose={() => setOpen(false)}
        destroyOnClose
        extra={(
          <Space>
            <Button onClick={() => void load()} disabled={loading || saving}>
              重新加载
            </Button>
            <Button type="primary" loading={saving} onClick={() => void onSave()}>
              保存
            </Button>
          </Space>
        )}
      >
        <Spin spinning={loading}>
          <Form form={form} layout="vertical" className="llm-settings-form">
            <Form.Item
              name="intent_resolver_provider"
              label={(
                <Space size={6}>
                  <span>意图解析模式</span>
                  <HelpIconPopover title="意图解析模式说明">
                    <p>
                      用户在编排里输入「训练目标」等自然语言后，系统<strong>如何推断</strong>任务类型（分类、摘要、NER 等）与训练方式，由这里决定。
                    </p>
                    <p>
                      · <strong>规则引擎</strong>：只匹配内置关键词，<strong>不调用通义</strong>，不耗额度、无需 Key；说法很绕时可能不如大模型准。
                    </p>
                    <p>
                      · <strong>通义千问</strong>：每次解析都请求你配置的 DashScope 模型，理解更好，需要有效 API Key。
                    </p>
                    <p>
                      · <strong>通义优先</strong>：先走通义，失败或异常时<strong>自动退回规则</strong>。
                    </p>
                    {snapshot ? (
                      <>
                        <Divider style={{ margin: '12px 0' }} />
                        <Typography.Text type="secondary">
                          当前生效：<Typography.Text code>{snapshot.effective_intent_resolver}</Typography.Text>
                          {' · '}
                          {snapshot.effective_aliyun_api_configured ? '通义 Key 已配置' : '通义 Key 未配置'}
                        </Typography.Text>
                      </>
                    ) : null}
                  </HelpIconPopover>
                </Space>
              )}
              rules={[{ required: true, message: '请选择' }]}
            >
              <Select options={INTENT_OPTIONS} />
            </Form.Item>
            <Tabs items={tabItems} />
          </Form>
        </Spin>
      </Drawer>
    </>
  );
};