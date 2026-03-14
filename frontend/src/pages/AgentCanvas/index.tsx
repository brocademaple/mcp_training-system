import React, { useState, useEffect } from 'react';
import { Card, Button, Select, Steps, Timeline, Tag, Space, Row, Col, Statistic, Progress, Switch, Radio, Input, Modal, Form, Upload, message } from 'antd';
import type { UploadFile } from 'antd/es/upload/interface';
import { RobotOutlined, PlayCircleOutlined, CheckCircleOutlined, CloseCircleOutlined, SyncOutlined, PlusOutlined, UploadOutlined, LinkOutlined, ArrowRightOutlined, EditOutlined, RightOutlined } from '@ant-design/icons';
import axios from 'axios';
import { datasetService } from '@/services/dataset';
import { DEFAULT_BASE_MODEL } from '@/constants/baseModels';
import './index.css';

const API_BASE = 'http://localhost:8080/api/v1';

/** 模型类型：先确认是文本还是多模态 */
const MODEL_TYPE_OPTIONS = [
  { value: 'text', label: '文本模型', desc: '仅文本输入，如分类、抽取、生成等' },
  { value: 'multimodal', label: '多模态模型', desc: '图文、音视频等多模态输入与理解' },
];

/** 任务类型（训练目标），依赖模型类型：文本任务仅在选择「文本模型」后可选，多模态任务仅在选择「多模态模型」后可选 */
const INTENT_OPTIONS: { value: string; label: string; desc: string; forModel: 'text' | 'multimodal' | 'both' }[] = [
  { value: 'sentiment', label: '情感分类', desc: '如评论正负面、满意度等', forModel: 'text' },
  { value: 'topic', label: '主题/新闻分类', desc: '如新闻类别、主题标签', forModel: 'text' },
  { value: 'binary', label: '文本二分类', desc: '是/否、A/B 等两类', forModel: 'text' },
  { value: 'multiclass', label: '多分类', desc: '多个互斥类别', forModel: 'text' },
  { value: 'intent', label: '意图识别', desc: '用户意图、对话意图等', forModel: 'text' },
  { value: 'ner', label: '命名实体识别', desc: '人名、地名、机构等实体抽取', forModel: 'text' },
  { value: 'summary', label: '摘要/生成', desc: '文本摘要、续写、生成', forModel: 'text' },
  { value: 'image_text_match', label: '图文匹配', desc: '图像与文本匹配、检索', forModel: 'multimodal' },
  { value: 'vqa', label: '视觉问答', desc: '根据图像回答问题', forModel: 'multimodal' },
  { value: 'other', label: '其他', desc: '在下方补充说明', forModel: 'both' },
];

/** 根据已选模型类型过滤可选任务类型 */
const getIntentOptionsForModel = (type: string) =>
  !type ? [] : INTENT_OPTIONS.filter((o) => o.forModel === type || o.forModel === 'both');

/** Data Agent 规划选项（用于驱动 Data Agent 的 prompt） */
export interface DataAgentOptions {
  scale?: 'more' | 'medium' | 'less';
  language?: 'zh' | 'en' | 'mixed' | 'any';
  domain?: string;
  recency?: 'latest' | 'any';
  quality?: 'high' | 'allow_noise' | 'any';
  sourcePreference?: 'authoritative' | 'opensource' | 'any';
  customPrompt?: string;
}

const DATA_AGENT_SCALE = [
  { value: 'more', label: '尽量多' },
  { value: 'medium', label: '适中' },
  { value: 'less', label: '最少' },
];
const DATA_AGENT_LANGUAGE = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: '英文' },
  { value: 'mixed', label: '中英混合' },
  { value: 'any', label: '不限制' },
];
const DATA_AGENT_DOMAIN = [
  { value: 'general', label: '通用' },
  { value: 'finance', label: '金融' },
  { value: 'medical', label: '医疗' },
  { value: 'education', label: '教育' },
  { value: 'ecommerce', label: '电商' },
  { value: 'social', label: '社交' },
  { value: 'other', label: '其他' },
];
const DATA_AGENT_RECENCY = [
  { value: 'latest', label: '最新优先' },
  { value: 'any', label: '不限制' },
];
const DATA_AGENT_QUALITY = [
  { value: 'high', label: '高质量标注优先' },
  { value: 'allow_noise', label: '允许一定噪声' },
  { value: 'any', label: '不限制' },
];
const DATA_AGENT_SOURCE = [
  { value: 'authoritative', label: '权威/学术来源优先' },
  { value: 'opensource', label: '开源数据集优先' },
  { value: 'any', label: '不限制' },
];

interface Dataset {
  id: number;
  name: string;
  status: string;
}

interface Pipeline {
  id: number;
  session_id: string;
  dataset_id: number;
  status: string;
  current_step: string;
  job_id?: number;
  model_id?: number;
  error_msg?: string;
  created_at: string;
}

const AgentCanvas: React.FC = () => {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedDataset, setSelectedDataset] = useState<number>();
  const [currentPipeline, setCurrentPipeline] = useState<Pipeline | null>(null);
  const [loading, setLoading] = useState(false);
  const [datasetsLoading, setDatasetsLoading] = useState(true);

  // 画布步骤：1=仅步骤1, 2=步骤2（含附属卡片）, 3=训练计划与执行
  const [canvasStep, setCanvasStep] = useState<1 | 2 | 3>(1);
  const [modelType, setModelType] = useState<string>('');
  const [modelIntent, setModelIntent] = useState<string>('');
  const [intentNote, setIntentNote] = useState<string>('');
  const [materialSource, setMaterialSource] = useState<'upload' | 'agent' | null>(null);
  const [dataAgentOptions, setDataAgentOptions] = useState<DataAgentOptions>({});

  // Agent 画布内独立的上传/导入（不跳转经典版）
  const [uploadModalVisible, setUploadModalVisible] = useState(false);
  const [urlModalVisible, setUrlModalVisible] = useState(false);
  const [uploadForm] = Form.useForm();
  const [urlForm] = Form.useForm();
  const [fileList, setFileList] = useState<UploadFile[]>([]);

  const intentOptionsFiltered = getIntentOptionsForModel(modelType);
  const currentIntentValid = modelType && intentOptionsFiltered.some((o) => o.value === modelIntent);

  useEffect(() => {
    fetchDatasets();
  }, []);

  // 切换模型类型时，若当前任务类型不在该类型下可选则清空
  useEffect(() => {
    if (!modelType || !modelIntent) return;
    const options = getIntentOptionsForModel(modelType);
    if (!options.some((o) => o.value === modelIntent)) setModelIntent('');
  }, [modelType]);

  useEffect(() => {
    if (currentPipeline && currentPipeline.status === 'running') {
      const interval = setInterval(() => fetchPipelineStatus(currentPipeline.id), 2000);
      return () => clearInterval(interval);
    }
  }, [currentPipeline]);

  const fetchDatasets = async () => {
    setDatasetsLoading(true);
    try {
      const res = await datasetService.getDatasets('training');
      if (res?.data?.datasets) {
        const ready = (res.data.datasets as Dataset[]).filter((d) => d.status === 'ready');
        setDatasets(ready);
      } else {
        setDatasets([]);
      }
    } catch (_) {
      setDatasets([]);
    } finally {
      setDatasetsLoading(false);
    }
  };

  const handleCanvasUpload = async () => {
    const values = await uploadForm.validateFields().catch(() => null);
    if (!values || fileList.length === 0) {
      message.error('请选择文件');
      return;
    }
    const file = fileList[0].originFileObj as File;
    try {
      await datasetService.uploadDataset(file, values.name, values.type, 'training');
      message.success('训练集上传成功，正在处理中...');
      setUploadModalVisible(false);
      uploadForm.resetFields();
      setFileList([]);
      setTimeout(fetchDatasets, 1000);
    } catch (e: any) {
      message.error(e?.message || '上传失败');
    }
  };

  const handleCanvasImportFromUrl = async () => {
    const values = await urlForm.validateFields().catch(() => null);
    if (!values) return;
    try {
      await datasetService.importFromUrl({
        name: values.name,
        url: values.url,
        type: values.type || 'text',
        usage: 'training',
      });
      message.success('已提交从 URL 导入，正在拉取并处理...');
      setUrlModalVisible(false);
      urlForm.resetFields();
      setTimeout(fetchDatasets, 1000);
    } catch (e: any) {
      message.error(e?.message || '从 URL 导入失败');
    }
  };

  /** 由 Data Agent 选项拼成用于驱动 Agent 的 prompt 片段（可传给后端） */
  const getDataAgentPromptFragment = () => {
    const o = dataAgentOptions;
    const parts: string[] = [];
    if (o.scale) parts.push(`数据规模：${DATA_AGENT_SCALE.find((x) => x.value === o.scale)?.label ?? o.scale}`);
    if (o.language) parts.push(`语言：${DATA_AGENT_LANGUAGE.find((x) => x.value === o.language)?.label ?? o.language}`);
    if (o.domain) parts.push(`领域：${DATA_AGENT_DOMAIN.find((x) => x.value === o.domain)?.label ?? o.domain}`);
    if (o.recency) parts.push(`时效：${DATA_AGENT_RECENCY.find((x) => x.value === o.recency)?.label ?? o.recency}`);
    if (o.quality) parts.push(`质量：${DATA_AGENT_QUALITY.find((x) => x.value === o.quality)?.label ?? o.quality}`);
    if (o.sourcePreference) parts.push(`来源：${DATA_AGENT_SOURCE.find((x) => x.value === o.sourcePreference)?.label ?? o.sourcePreference}`);
    if (o.customPrompt?.trim()) parts.push(`自定义要求：${o.customPrompt.trim()}`);
    return parts.join('；');
  };

  const fetchPipelineStatus = async (id: number) => {
    try {
      const res = await axios.get(`${API_BASE}/pipelines/${id}`);
      setCurrentPipeline(res.data);
    } catch (err) {}
  };

  const handleStart = async () => {
    if (!selectedDataset) return;
    setLoading(true);
    try {
      const payload: Record<string, unknown> = {
        dataset_id: selectedDataset,
        train_config: {
          model_type: 'text_classification',
          base_model: DEFAULT_BASE_MODEL,
          epochs: 3,
          learning_rate: 2e-5,
          batch_size: 16,
        },
      };
      if (materialSource === 'agent') {
        const fragment = getDataAgentPromptFragment();
        if (fragment) payload.data_agent_prompt = fragment;
      }
      const res = await axios.post(`${API_BASE}/pipelines`, payload);
      setCurrentPipeline(res.data);
    } catch (err) {
    } finally {
      setLoading(false);
    }
  };

  const getStepIndex = (step: string) => {
    const steps = ['clean_data', 'train', 'evaluate'];
    return steps.indexOf(step);
  };

  const getProgress = () => {
    if (!currentPipeline) return 0;
    if (currentPipeline.status === 'completed') return 100;
    const idx = getStepIndex(currentPipeline.current_step);
    return ((idx + 1) / 3) * 100;
  };

  const switchToClassic = () => {
    localStorage.setItem('app-version', 'classic');
    window.location.href = '/';
  };

  const themeMode = (localStorage.getItem('app-theme') as 'light' | 'dark') || 'light';

  return (
    <div className="agent-canvas" data-theme={themeMode}>
      <div className="canvas-header">
        <div className="canvas-title">
          <RobotOutlined style={{ fontSize: 32, marginRight: 12 }} />
          <div>
            <h1>MCP Agent 智能画布</h1>
            <p>Multi-Agent 协同编排 · 意图与材料 → 制定计划 → 数据清洗→训练→评估</p>
          </div>
        </div>
      </div>

      {!currentPipeline ? (
        <div className="canvas-setup">
          {canvasStep === 3 ? (
            <div className="canvas-flow">
              <p className="canvas-flow-hint">
                根据你在步骤 1、2 的输入，下方为编排层生成的训练计划；选择数据集即可启动流水线。
              </p>
              <Card className="canvas-step-card canvas-step-single" title={<span><span className="canvas-step-badge">步骤 3</span> 训练计划与执行</span>}>
                <h3 style={{ marginBottom: 8, fontWeight: 600, fontSize: 15 }}>计划摘要</h3>
                <p style={{ color: 'rgba(0,0,0,0.55)', fontSize: 13, marginBottom: 16 }}>
                  根据你的选择，我们将进行 <strong>{MODEL_TYPE_OPTIONS.find((o) => o.value === modelType)?.label ?? '文本'}</strong> + <strong>{INTENT_OPTIONS.find((o) => o.value === modelIntent)?.label ?? '分类'}</strong> 的训练。
                  {intentNote && (
                    <span> 你的补充：{intentNote.slice(0, 80)}{intentNote.length > 80 ? '…' : ''}</span>
                  )}
                </p>
                {materialSource === 'agent' && (
                  <p className="canvas-agent-plan-note">
                    你选择了由 Data Agent 从外部规划数据源；该能力完善后将自动执行。当前请先选择已有数据集以启动流水线。
                  </p>
                )}
                <div className="canvas-plan-desc">
                  流程：数据清洗 → 模型训练 → 模型评估。请选择已准备好的数据集并启动流水线。
                </div>
                <Space direction="vertical" size="large" style={{ width: '100%' }}>
                  <div>
                    <label>选择数据集</label>
                    <Select
                      placeholder={datasetsLoading ? '加载中…' : '选择已清洗的数据集'}
                      style={{ width: '100%', marginTop: 6 }}
                      value={selectedDataset}
                      onChange={setSelectedDataset}
                      options={datasets.map((d) => ({ label: d.name, value: d.id }))}
                      size="large"
                      loading={datasetsLoading}
                      notFoundContent={null}
                    />
                    {!datasetsLoading && datasets.length === 0 && (
                      <p className="canvas-no-data-hint" style={{ marginTop: 8, fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>
                        暂无已清洗的数据集，请返回步骤 2 在「数据集上传与选择」中上传或从 URL 导入。
                      </p>
                    )}
                  </div>
                  <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                    <Button type="default" icon={<EditOutlined />} onClick={() => setCanvasStep(2)}>
                      返回修改
                    </Button>
                    <Button
                      type="primary"
                      size="large"
                      icon={<PlayCircleOutlined />}
                      onClick={handleStart}
                      loading={loading}
                      disabled={!selectedDataset}
                    >
                      启动 Agent 流水线
                    </Button>
                  </Space>
                </Space>
              </Card>
            </div>
          ) : (
            <div className={`canvas-slider ${canvasStep === 2 ? 'canvas-slider-step2' : ''}`}>
              <div className="canvas-slider-track">
                <div className="canvas-slider-panel">
                  <p className="canvas-flow-hint">
                    先确认训练目标，确认后将进入下一步：选择数据准备方式。
                  </p>
                  <Card className="canvas-step-card" title={<span><span className="canvas-step-badge">步骤 1</span> 训练目标确认</span>}>
                    <p className="canvas-step-desc">先确认要训练的模型类型与任务目标，Agent 将据此规划流程。</p>
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ marginBottom: 8, fontWeight: 500 }}>训练的是什么模型？</div>
                      <Radio.Group
                        value={modelType}
                        onChange={(e) => setModelType(e.target.value)}
                        style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}
                      >
                        {MODEL_TYPE_OPTIONS.map((opt) => (
                          <Radio key={opt.value} value={opt.value} style={{ marginRight: 0 }}>
                            <span>{opt.label}</span>
                            <span style={{ marginLeft: 6, fontWeight: 400, color: 'rgba(0,0,0,0.55)', fontSize: 12 }}>{opt.desc}</span>
                          </Radio>
                        ))}
                      </Radio.Group>
                    </div>
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ marginBottom: 8, fontWeight: 500 }}>任务类型（训练目标）</div>
                      {!modelType ? (
                        <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.45)', marginBottom: 0 }}>
                          请先选择上方「训练的是什么模型？」，再选择本项。
                        </p>
                      ) : (
                        <Radio.Group
                          value={currentIntentValid ? modelIntent : undefined}
                          onChange={(e) => setModelIntent(e.target.value)}
                          style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}
                        >
                          {intentOptionsFiltered.map((opt) => (
                            <Radio key={opt.value} value={opt.value} style={{ marginRight: 0 }}>
                              <span>{opt.label}</span>
                              <span style={{ marginLeft: 6, fontWeight: 400, color: 'rgba(0,0,0,0.55)', fontSize: 12 }}>{opt.desc}</span>
                            </Radio>
                          ))}
                        </Radio.Group>
                      )}
                    </div>
                    <div>
                      <div style={{ marginBottom: 8, fontWeight: 500 }}>补充说明（可选）</div>
                      <Input.TextArea
                        placeholder="例如：希望区分好评/中评/差评，或标注业务场景、数据来源等"
                        value={intentNote}
                        onChange={(e) => setIntentNote(e.target.value)}
                        rows={2}
                        maxLength={500}
                        showCount
                      />
                    </div>
                  </Card>
                  <div className="canvas-flow-actions">
                    <Button
                      type="primary"
                      size="large"
                      icon={<ArrowRightOutlined />}
                      onClick={() => setCanvasStep(2)}
                      disabled={!modelType || !modelIntent}
                    >
                      下一步
                    </Button>
                  </div>
                </div>
                <div className="canvas-slider-panel">
                  <p className="canvas-flow-hint">
                    选择数据准备方式后，右侧会出现对应附属卡片：上传/选择数据集，或设定 Data Agent 的获取偏好。
                  </p>
                  <div className="canvas-step2-row">
                    <Card className="canvas-step-card canvas-step2-main" title={<span><span className="canvas-step-badge">步骤 2</span> 训练数据准备</span>}>
                      <p className="canvas-step-desc">先确认是哪种数据准备方式，再在右侧附属卡片中完成具体操作。</p>
                      <Radio.Group
                        value={materialSource}
                        onChange={(e) => {
                          setMaterialSource(e.target.value);
                          if (e.target.value === 'agent') setSelectedDataset(undefined);
                        }}
                        style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}
                      >
                        <Radio value="upload" style={{ marginRight: 0 }}>
                          <strong>我已有材料</strong>（在右侧卡片中上传或选择数据集）
                        </Radio>
                        <Radio value="agent" style={{ marginRight: 0 }}>
                          <strong>由 Data Agent 自行规划</strong>（在右侧卡片中设定获取偏好与自定义要求）
                        </Radio>
                      </Radio.Group>
                    </Card>
                    {materialSource === 'upload' && (
                      <Card className="canvas-step-card canvas-step2-side" title="数据集上传与选择">
                        <p className="canvas-step-desc">在 Agent 画布内完成上传或从 URL 导入，无需跳转其他页面。</p>
                        <Select
                          placeholder={datasetsLoading ? '加载中…' : '选择已清洗的数据集'}
                          style={{ width: '100%', marginBottom: 12 }}
                          value={selectedDataset}
                          onChange={setSelectedDataset}
                          options={datasets.map((d) => ({ label: d.name, value: d.id }))}
                          size="large"
                          loading={datasetsLoading}
                          notFoundContent={null}
                        />
                        <Space direction="vertical" style={{ width: '100%' }} size={8}>
                          <Button type="default" block icon={<UploadOutlined />} onClick={() => setUploadModalVisible(true)}>
                            本地上传
                          </Button>
                          <Button type="default" block icon={<LinkOutlined />} onClick={() => setUrlModalVisible(true)}>
                            从 URL 导入
                          </Button>
                        </Space>
                        {!datasetsLoading && datasets.length === 0 && (
                          <p style={{ marginTop: 12, fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>
                            暂无就绪数据集，请先使用上方按钮上传或导入。
                          </p>
                        )}
                      </Card>
                    )}
                    {materialSource === 'agent' && (
                      <Card className="canvas-step-card canvas-step2-side" title="Data Agent 规划选项">
                        <p className="canvas-step-desc">设定数据获取偏好，这些选项将加入驱动 Data Agent 的 prompt。</p>
                        <Space direction="vertical" style={{ width: '100%' }} size={12}>
                          <div>
                            <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>数据规模</label>
                            <Select
                              placeholder="请选择"
                              style={{ width: '100%' }}
                              value={dataAgentOptions.scale}
                              onChange={(v) => setDataAgentOptions((o) => ({ ...o, scale: v }))}
                              options={DATA_AGENT_SCALE.map((x) => ({ label: x.label, value: x.value }))}
                              allowClear
                            />
                          </div>
                          <div>
                            <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>语言</label>
                            <Select
                              placeholder="请选择"
                              style={{ width: '100%' }}
                              value={dataAgentOptions.language}
                              onChange={(v) => setDataAgentOptions((o) => ({ ...o, language: v }))}
                              options={DATA_AGENT_LANGUAGE.map((x) => ({ label: x.label, value: x.value }))}
                              allowClear
                            />
                          </div>
                          <div>
                            <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>领域</label>
                            <Select
                              placeholder="请选择"
                              style={{ width: '100%' }}
                              value={dataAgentOptions.domain}
                              onChange={(v) => setDataAgentOptions((o) => ({ ...o, domain: v }))}
                              options={DATA_AGENT_DOMAIN.map((x) => ({ label: x.label, value: x.value }))}
                              allowClear
                            />
                          </div>
                          <div>
                            <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>时效</label>
                            <Select
                              placeholder="请选择"
                              style={{ width: '100%' }}
                              value={dataAgentOptions.recency}
                              onChange={(v) => setDataAgentOptions((o) => ({ ...o, recency: v }))}
                              options={DATA_AGENT_RECENCY.map((x) => ({ label: x.label, value: x.value }))}
                              allowClear
                            />
                          </div>
                          <div>
                            <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>质量要求</label>
                            <Select
                              placeholder="请选择"
                              style={{ width: '100%' }}
                              value={dataAgentOptions.quality}
                              onChange={(v) => setDataAgentOptions((o) => ({ ...o, quality: v }))}
                              options={DATA_AGENT_QUALITY.map((x) => ({ label: x.label, value: x.value }))}
                              allowClear
                            />
                          </div>
                          <div>
                            <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>来源偏好</label>
                            <Select
                              placeholder="请选择"
                              style={{ width: '100%' }}
                              value={dataAgentOptions.sourcePreference}
                              onChange={(v) => setDataAgentOptions((o) => ({ ...o, sourcePreference: v }))}
                              options={DATA_AGENT_SOURCE.map((x) => ({ label: x.label, value: x.value }))}
                              allowClear
                            />
                          </div>
                          <div>
                            <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>自定义要求</label>
                            <Input.TextArea
                              placeholder="例如：仅使用近两年数据、需包含多方言、排除某类来源等"
                              value={dataAgentOptions.customPrompt ?? ''}
                              onChange={(e) => setDataAgentOptions((o) => ({ ...o, customPrompt: e.target.value }))}
                              rows={3}
                              maxLength={500}
                              showCount
                            />
                          </div>
                        </Space>
                      </Card>
                    )}
                  </div>
                  <div className="canvas-flow-actions">
                    <Button type="default" onClick={() => setCanvasStep(1)} style={{ marginRight: 8 }}>
                      上一步
                    </Button>
                    <Button
                      type="primary"
                      size="large"
                      icon={<ArrowRightOutlined />}
                      onClick={() => setCanvasStep(3)}
                      disabled={
                        !materialSource ||
                        (materialSource === 'upload' && !selectedDataset)
                      }
                    >
                      下一步，制定训练计划
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="canvas-board">
          <Row gutter={[16, 16]}>
            <Col span={24}>
              <Card>
                <Statistic
                  title="流水线进度"
                  value={getProgress()}
                  suffix="%"
                  prefix={currentPipeline.status === 'running' ? <SyncOutlined spin /> : null}
                />
                <Progress
                  percent={getProgress()}
                  status={currentPipeline.status === 'failed' ? 'exception' : currentPipeline.status === 'completed' ? 'success' : 'active'}
                  strokeColor={{ from: '#108ee9', to: '#87d068' }}
                />
              </Card>
            </Col>
          </Row>

          <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
            <Col span={12}>
              <Card title="执行步骤" className="step-card">
                <Steps
                  direction="vertical"
                  current={getStepIndex(currentPipeline.current_step)}
                  status={currentPipeline.status === 'failed' ? 'error' : undefined}
                >
                  <Steps.Step title="数据清洗" description="Data Agent 处理中" />
                  <Steps.Step title="模型训练" description="Training Agent 执行中" />
                  <Steps.Step title="模型评估" description="Evaluation Agent 分析中" />
                </Steps>
              </Card>
            </Col>

            <Col span={12}>
              <Card title="MCP 消息流" className="mcp-card">
                <Timeline>
                  <Timeline.Item color="green">
                    <p><strong>Session ID:</strong> {currentPipeline.session_id.slice(0, 8)}...</p>
                  </Timeline.Item>
                  <Timeline.Item color={getStepIndex(currentPipeline.current_step) >= 0 ? 'green' : 'gray'}>
                    <p>Data Agent: clean_data</p>
                    <Tag color="success">已完成</Tag>
                  </Timeline.Item>
                  <Timeline.Item color={getStepIndex(currentPipeline.current_step) >= 1 ? 'blue' : 'gray'}>
                    <p>Training Agent: train</p>
                    {currentPipeline.job_id && <Tag color="processing">Job #{currentPipeline.job_id}</Tag>}
                  </Timeline.Item>
                  <Timeline.Item color={getStepIndex(currentPipeline.current_step) >= 2 ? 'blue' : 'gray'}>
                    <p>Evaluation Agent: evaluate</p>
                    {currentPipeline.model_id && <Tag color="processing">Model #{currentPipeline.model_id}</Tag>}
                  </Timeline.Item>
                </Timeline>
              </Card>
            </Col>
          </Row>

          <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
            <Col span={24}>
              <Card title="执行结果">
                {currentPipeline.status === 'completed' && (
                  <div style={{ textAlign: 'center', padding: 24 }}>
                    <CheckCircleOutlined style={{ fontSize: 48, color: '#52c41a' }} />
                    <h2>流水线执行成功</h2>
                    <Space>
                      <Tag color="blue">训练任务 #{currentPipeline.job_id}</Tag>
                      <Tag color="green">模型 #{currentPipeline.model_id}</Tag>
                    </Space>
                  </div>
                )}
                {currentPipeline.status === 'failed' && (
                  <div style={{ textAlign: 'center', padding: 24 }}>
                    <CloseCircleOutlined style={{ fontSize: 48, color: '#ff4d4f' }} />
                    <h2>执行失败</h2>
                    <p>{currentPipeline.error_msg}</p>
                  </div>
                )}
                {currentPipeline.status === 'running' && (
                  <div style={{ textAlign: 'center', padding: 24 }}>
                    <SyncOutlined spin style={{ fontSize: 48, color: '#1890ff' }} />
                    <h2>Agent 正在协同工作...</h2>
                  </div>
                )}
                <div style={{ marginTop: 16, textAlign: 'center' }}>
                  <Button onClick={() => setCurrentPipeline(null)}>返回配置</Button>
                </div>
              </Card>
            </Col>
          </Row>
        </div>
      )}

      {/* Agent 画布内独立的上传/导入弹窗（不跳转经典版） */}
      <Modal
        title="上传训练集"
        open={uploadModalVisible}
        onCancel={() => {
          setUploadModalVisible(false);
          uploadForm.resetFields();
          setFileList([]);
        }}
        onOk={() => uploadForm.submit()}
        okText="上传"
        cancelText="取消"
      >
        <Form form={uploadForm} layout="vertical" onFinish={handleCanvasUpload}>
          <Form.Item label="选择文件" required>
            <Upload
              beforeUpload={() => false}
              fileList={fileList}
              onChange={({ fileList: newList }) => {
                setFileList(newList);
                const file = newList[0]?.originFileObj as File | undefined;
                if (file && !uploadForm.getFieldValue('name')) {
                  const base = file.name.replace(/\.[^/.]+$/, '');
                  uploadForm.setFieldsValue({ name: base });
                }
              }}
              maxCount={1}
              accept=".csv,.json"
            >
              <Button icon={<UploadOutlined />}>选择文件（CSV / JSON）</Button>
            </Upload>
          </Form.Item>
          <Form.Item name="name" label="数据集名称" rules={[{ required: true, message: '请输入数据集名称' }]}>
            <Input placeholder="请输入数据集名称" />
          </Form.Item>
          <Form.Item name="type" label="数据类型" rules={[{ required: true, message: '请选择数据类型' }]}>
            <Select placeholder="请选择数据类型">
              <Select.Option value="text">文本（CSV/JSON）</Select.Option>
              <Select.Option value="instruction">指令/对话（JSON）</Select.Option>
              <Select.Option value="image">图像</Select.Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title="从 URL 导入数据集"
        open={urlModalVisible}
        onCancel={() => {
          setUrlModalVisible(false);
          urlForm.resetFields();
        }}
        onOk={() => urlForm.submit()}
        okText="导入"
        cancelText="取消"
      >
        <Form form={urlForm} layout="vertical" onFinish={handleCanvasImportFromUrl}>
          <Form.Item name="name" label="数据集名称" rules={[{ required: true, message: '请输入数据集名称' }]}>
            <Input placeholder="请输入数据集名称" />
          </Form.Item>
          <Form.Item
            name="url"
            label="CSV 文件链接"
            rules={[
              { required: true, message: '请输入 CSV 的 URL' },
              { type: 'url', message: '请输入有效的 URL' },
            ]}
          >
            <Input placeholder="https://example.com/data.csv" />
          </Form.Item>
          <Form.Item name="type" label="数据类型" initialValue="text">
            <Select>
              <Select.Option value="text">文本</Select.Option>
              <Select.Option value="image">图像</Select.Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      {/* 与经典版侧栏底部样式一致的左下角版本切换 */}
      <div className="canvas-version-footer">
        <div className="canvas-version-footer-inner">
          <div className="canvas-version-label">Agent版</div>
          <Switch
            checked
            onChange={() => switchToClassic()}
            checkedChildren="Agent"
            unCheckedChildren="经典"
            className="canvas-version-switch"
          />
          <div className="canvas-version-hint">切换到经典版</div>
        </div>
      </div>
    </div>
  );
};

export default AgentCanvas;
