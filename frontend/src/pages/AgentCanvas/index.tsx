import React, { useState, useEffect, useRef } from 'react';
import { Card, Button, Select, Steps, Timeline, Tag, Space, Row, Col, Statistic, Progress, Switch, Radio, Input, Modal, Form, Upload, message } from 'antd';
import type { UploadFile } from 'antd/es/upload/interface';
import { RobotOutlined, PlayCircleOutlined, CheckCircleOutlined, CloseCircleOutlined, SyncOutlined, UploadOutlined, LinkOutlined, ArrowRightOutlined, EditOutlined, HomeOutlined, ThunderboltOutlined, ExperimentOutlined, DownOutlined, UpOutlined, MoonOutlined, SunOutlined } from '@ant-design/icons';
import axios from 'axios';
import { datasetService } from '@/services/dataset';
import { trainingService } from '@/services/training';
import { agentService, type AgentPlan } from '@/services/agent';
import { DEFAULT_BASE_MODEL } from '@/constants/baseModels';
import type { TrainingJob } from '@/types';
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

  // 入口区：未展开步骤前显示引导；展开后与步骤卡片动效衔接；任务列表可收起/展开
  const [entryDismissed, setEntryDismissed] = useState(false);
  const [entryListExpanded, setEntryListExpanded] = useState(false); // 展开步骤后，历史任务列表是否展开
  const entryCollapsedBarRef = useRef<HTMLDivElement>(null); // 展开/收起那一行，用于展开后滚动露出
  const [jobs, setJobs] = useState<TrainingJob[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);

  // 画布步骤：1=仅步骤1, 2=步骤2（含附属卡片）, 3=训练计划与执行
  const [canvasStep, setCanvasStep] = useState<1 | 2 | 3>(1);
  const [modelType, setModelType] = useState<string>('text');
  const [modelIntent, setModelIntent] = useState<string>('sentiment');
  const [intentNote, setIntentNote] = useState<string>('');
  const [goalInput, setGoalInput] = useState<string>('');
  const [goalPreset, setGoalPreset] = useState<'full_pipeline' | 'train_only' | 'evaluate_only' | ''>('');
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState<string>('');
  const [generatedPlan, setGeneratedPlan] = useState<AgentPlan | null>(null);
  const [trainMode, setTrainMode] = useState<'classic_clf' | 'sft_lora'>('classic_clf');
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await trainingService.getJobs();
        if (!cancelled && res?.data?.jobs) setJobs(res.data.jobs);
      } catch (_) {
        if (!cancelled) setJobs([]);
      } finally {
        if (!cancelled) setJobsLoading(false);
      }
    })();
    return () => { cancelled = true; };
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

  const getPresetGoalText = (preset: 'full_pipeline' | 'train_only' | 'evaluate_only' | '') => {
    if (preset === 'full_pipeline') return '从数据准备到评估报告，一次跑完整条训练链路';
    if (preset === 'train_only') return '基于已有训练数据，快速产出一个可用模型';
    if (preset === 'evaluate_only') return '对已训练模型做评估并生成报告';
    return '';
  };

  const handleGeneratePlan = async () => {
    const goal = goalInput.trim() || getPresetGoalText(goalPreset);
    if (!goal) {
      message.warning('请先选择预设目标或输入一句训练目标');
      return;
    }
    setPlanLoading(true);
    setPlanError('');
    try {
      const plan = await agentService.createPlan({
        goal,
        model_type: modelType,
        intent: modelIntent,
        material_source: materialSource,
        data_agent_prompt: getDataAgentPromptFragment(),
        train_mode: trainMode,
      });
      setGeneratedPlan(plan);

      // 将规则计划自动映射到当前表单，用户仍可手动调整
      if (plan.inferred_intent) setModelIntent(plan.inferred_intent);
      if (plan.train_mode === 'classic_clf' || plan.train_mode === 'sft_lora') setTrainMode(plan.train_mode);
      if (plan.data_agent_prompt && materialSource === 'agent') {
        setDataAgentOptions((o) => ({ ...o, customPrompt: plan.data_agent_prompt }));
      }

      const firstReady = plan.selected_dataset_candidates?.[0]?.id;
      if (firstReady && !selectedDataset) setSelectedDataset(firstReady);
      message.success('已生成执行计划');
    } catch (e: any) {
      const errMsg = e?.message || '计划生成失败';
      setPlanError(errMsg);
      message.error(errMsg);
    } finally {
      setPlanLoading(false);
    }
  };

  const getStepRationale = (step: string) => {
    if (!generatedPlan?.steps?.length) return '';
    return generatedPlan.steps.find((s) => s.name === step)?.rationale || '';
  };

  const fetchPipelineStatus = async (id: number) => {
    try {
      const res = await axios.get(`${API_BASE}/pipelines/${id}`);
      setCurrentPipeline(res.data);
    } catch (err) {}
  };

  const handleStart = async (overrideTrainConfig?: Record<string, unknown>) => {
    if (!selectedDataset) {
      message.warning('请先选择数据集');
      return;
    }
    setLoading(true);
    try {
      const planTrainConfig = generatedPlan?.train_config ?? {};
      const payload: Record<string, unknown> = {
        dataset_id: selectedDataset,
        train_config: {
          model_type: 'text_classification',
          base_model: DEFAULT_BASE_MODEL,
          epochs: 3,
          learning_rate: 2e-5,
          batch_size: 16,
          ...planTrainConfig,
          ...(overrideTrainConfig || {}),
        },
      };
      if (materialSource === 'agent') {
        const fragment = getDataAgentPromptFragment();
        const promptFromPlan = generatedPlan?.data_agent_prompt;
        if (fragment || promptFromPlan) payload.data_agent_prompt = fragment || promptFromPlan;
      }
      if (generatedPlan?.plan_id) payload.plan_id = generatedPlan.plan_id;
      if (generatedPlan) payload.plan_payload = generatedPlan;
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

  const [themeMode, setThemeMode] = useState<'light' | 'dark'>(() => (localStorage.getItem('app-theme') as 'light' | 'dark') || 'light');

  useEffect(() => {
    localStorage.setItem('app-theme', themeMode);
  }, [themeMode]);

  const jobCount = jobs.length;
  const isFirstTime = !jobsLoading && jobCount === 0;
  const isDataAgentRequiredReady =
    materialSource !== 'agent'
      ? true
      : Boolean(dataAgentOptions.scale && dataAgentOptions.language && dataAgentOptions.domain) &&
        (dataAgentOptions.domain !== 'other' || Boolean(dataAgentOptions.customPrompt?.trim()));
  const dataAgentRequiredMissing: string[] = [];
  if (materialSource === 'agent') {
    if (!dataAgentOptions.scale) dataAgentRequiredMissing.push('数据规模');
    if (!dataAgentOptions.language) dataAgentRequiredMissing.push('语言');
    if (!dataAgentOptions.domain) dataAgentRequiredMissing.push('领域');
    if (dataAgentOptions.domain === 'other' && !dataAgentOptions.customPrompt?.trim()) dataAgentRequiredMissing.push('自定义要求（用于补充领域）');
  }

  return (
    <div className="agent-canvas" data-theme={themeMode}>
      {/* 左侧边栏：主题切换 + 版本切换，固定于左下角，带简短文字提示 */}
      <aside className="canvas-sider">
        <div className="canvas-sider-inner">
          <div className="canvas-sider-theme-wrap">
            <span
              className="canvas-sider-icon"
              onClick={() => setThemeMode((t) => (t === 'light' ? 'dark' : 'light'))}
              title={themeMode === 'light' ? '切换到深色模式' : '切换到浅色模式'}
            >
              {themeMode === 'light' ? <MoonOutlined /> : <SunOutlined />}
            </span>
            <span className="canvas-sider-hint">{themeMode === 'light' ? '切换深色' : '切换浅色'}</span>
          </div>
          <div className="canvas-sider-version-wrap">
            <Switch
              checked
              onChange={() => switchToClassic()}
              checkedChildren="Agent"
              unCheckedChildren="经典"
              size="small"
              className="canvas-sider-version-switch"
            />
            <span className="canvas-sider-hint">切换到经典版</span>
          </div>
        </div>
      </aside>

      <div className="canvas-main">
      <div className="canvas-header">
        <div className="canvas-title">
          <RobotOutlined style={{ fontSize: 32, marginRight: 12 }} />
          <div>
            <h1>训练从意图开始</h1>
            <p>说出训练目标与数据来源，由 Agent 自动完成清洗、训练与评估</p>
          </div>
        </div>
        {entryDismissed && (
          <Button type="link" icon={<HomeOutlined />} onClick={() => { setEntryDismissed(false); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
            返回首页
          </Button>
        )}
      </div>

      {/* 入口区：引导语 + 任务列表（可收起）或零状态 + CTA；展开步骤后仅保留收起条+展开图标；首次使用时展开后隐藏整块 */}
      <div className={`canvas-entry-block ${entryDismissed ? 'canvas-entry-block-collapsed' : ''} ${entryDismissed && isFirstTime ? 'canvas-entry-block-hidden' : ''}`}>
        <div className="canvas-entry-inner">
          {!jobsLoading && (
            <>
              {!entryDismissed ? (
                <>
                  {isFirstTime ? (
                    <div className="canvas-entry-zero">
                      <p className="canvas-entry-hint">还没有训练记录，点击下方开始创建你的第一次训练</p>
                      <ul className="canvas-entry-guide">
                        <li>选择训练目标（如情感分类、主题分类、多分类等）</li>
                        <li>准备或上传数据集，或由 Data Agent 规划数据来源</li>
                        <li>由 Agent 自动完成清洗、训练与评估</li>
                      </ul>
                    </div>
                  ) : (
                    <div className="canvas-entry-list-wrap">
                      <p className="canvas-entry-hint">已进行 <strong>{jobCount}</strong> 次训练任务，点击下方创建新的训练任务</p>
                      <ul className="canvas-entry-job-list">
                        {jobs.slice(0, 8).map((j) => (
                          <li key={j.id} className="canvas-entry-job-item">
                            <ExperimentOutlined style={{ color: 'rgba(0,0,0,0.45)', marginRight: 8 }} />
                            <span className="canvas-entry-job-name">{j.name || `训练任务 #${j.id}`}</span>
                            <span
                              className="canvas-entry-job-status"
                              style={{
                                color: j.status === 'completed' ? '#52c41a' : j.status === 'failed' || j.status === 'cancelled' ? '#ff4d4f' : '#1890ff',
                              }}
                            >
                              {j.status === 'queued' || j.status === 'running' ? '进行中' : j.status === 'completed' ? '已完成' : j.status === 'failed' ? '失败' : '已取消'}
                            </span>
                            <span className="canvas-entry-job-time">
                              {j.created_at ? new Date(j.created_at).toLocaleString('zh-CN') : ''}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <Button
                    type="primary"
                    size="large"
                    icon={<ThunderboltOutlined />}
                    className={isFirstTime ? 'canvas-entry-cta canvas-entry-cta-prominent' : 'canvas-entry-cta'}
                    onClick={() => setEntryDismissed(true)}
                  >
                    {isFirstTime ? '开始第一次训练' : '新的训练任务'}
                  </Button>
                </>
              ) : (
                <>
                  {jobCount > 0 && (
                    <div className="canvas-entry-collapsed-bar" ref={entryCollapsedBarRef}>
                      <span className="canvas-entry-collapsed-text">已进行 <strong>{jobCount}</strong> 次训练任务</span>
                      <Button
                        type="link"
                        size="small"
                        icon={entryListExpanded ? <UpOutlined /> : <DownOutlined />}
                        onClick={() => {
                          const next = !entryListExpanded;
                          setEntryListExpanded(next);
                          if (next) {
                            setTimeout(() => {
                              entryCollapsedBarRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                            }, 80);
                          }
                        }}
                        className="canvas-entry-expand-btn"
                      >
                        {entryListExpanded ? '收起' : '展开'}
                      </Button>
                    </div>
                  )}
                  {jobCount > 0 && entryListExpanded && (
                    <ul className="canvas-entry-job-list canvas-entry-job-list-collapsed">
                      {jobs.slice(0, 8).map((j) => (
                        <li key={j.id} className="canvas-entry-job-item">
                          <ExperimentOutlined style={{ color: 'rgba(0,0,0,0.45)', marginRight: 8 }} />
                          <span className="canvas-entry-job-name">{j.name || `训练任务 #${j.id}`}</span>
                          <span
                            className="canvas-entry-job-status"
                            style={{
                              color: j.status === 'completed' ? '#52c41a' : j.status === 'failed' || j.status === 'cancelled' ? '#ff4d4f' : '#1890ff',
                            }}
                          >
                            {j.status === 'queued' || j.status === 'running' ? '进行中' : j.status === 'completed' ? '已完成' : j.status === 'failed' ? '失败' : '已取消'}
                          </span>
                          <span className="canvas-entry-job-time">
                            {j.created_at ? new Date(j.created_at).toLocaleString('zh-CN') : ''}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </>
          )}
          {jobsLoading && <div className="canvas-entry-loading">加载中…</div>}
        </div>
      </div>

      {/* 步骤区：与入口动效衔接，展开后展示步骤卡片 */}
      <div className={`canvas-steps-reveal ${entryDismissed ? 'canvas-steps-reveal-open' : ''}`}>
      {!currentPipeline ? (
        <div className="canvas-setup">
          {canvasStep === 3 ? (
            <div className="canvas-flow">
              <p className="canvas-flow-hint">
                根据你在步骤 1、2 的输入，下方为编排层生成的训练计划；选择数据集即可启动流水线。
              </p>
              <Card className="canvas-step-card canvas-step-single" title={<span><span className="canvas-step-badge">步骤 3</span> 训练计划与执行</span>}>
                <h3 style={{ marginBottom: 8, fontWeight: 600, fontSize: 15 }}>计划摘要</h3>
                {generatedPlan ? (
                  <div className="canvas-plan-card">
                    <p style={{ color: 'rgba(0,0,0,0.65)', fontSize: 13, marginBottom: 12 }}>
                      <strong>目标：</strong>{generatedPlan.goal}
                    </p>
                    <Space wrap style={{ marginBottom: 8 }}>
                      <Tag color="blue">意图：{generatedPlan.inferred_intent}</Tag>
                      {generatedPlan.train_mode && <Tag color="purple">训练方式：{generatedPlan.train_mode === 'sft_lora' ? 'SFT+LoRA' : '经典分类'}</Tag>}
                      <Tag color="geekblue">预计耗时：{generatedPlan.estimated_duration_minutes || '--'} 分钟</Tag>
                      {generatedPlan.plan_id && <Tag color="processing">{generatedPlan.plan_id}</Tag>}
                    </Space>
                    {generatedPlan.task_spec && (
                      <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.6)', marginBottom: 8 }}>
                        <div>
                          <strong>问题族：</strong>{generatedPlan.task_spec.problem_family}；<strong>输出：</strong>{generatedPlan.task_spec.output_form}
                        </div>
                        <div>
                          <strong>最小数据列：</strong>{generatedPlan.task_spec.required_columns.join(' + ')}
                        </div>
                        {generatedPlan.task_spec.notes && <div style={{ marginTop: 4 }}>{generatedPlan.task_spec.notes}</div>}
                      </div>
                    )}
                    <ul className="canvas-plan-steps">
                      {generatedPlan.steps.map((s) => (
                        <li key={s.name}>
                          <strong>{s.agent}</strong> · {s.name}：{s.rationale}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p style={{ color: 'rgba(0,0,0,0.55)', fontSize: 13, marginBottom: 16 }}>
                    根据你的选择，我们将进行 <strong>{MODEL_TYPE_OPTIONS.find((o) => o.value === modelType)?.label ?? '文本'}</strong> + <strong>{INTENT_OPTIONS.find((o) => o.value === modelIntent)?.label ?? '分类'}</strong> 的训练。
                    {intentNote && (
                      <span> 你的补充：{intentNote.slice(0, 80)}{intentNote.length > 80 ? '…' : ''}</span>
                    )}
                  </p>
                )}
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
                    <Space>
                      <Button type="default" onClick={handleGeneratePlan} loading={planLoading}>
                        刷新计划
                      </Button>
                      <Button
                        type="primary"
                        size="large"
                        icon={<PlayCircleOutlined />}
                        onClick={() => handleStart()}
                        loading={loading}
                        disabled={!selectedDataset}
                      >
                        启动 Agent 流水线
                      </Button>
                    </Space>
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
                    <div className="canvas-goal-block">
                      <div className="canvas-goal-title">目标优先入口</div>
                      <Space wrap style={{ marginBottom: 10 }}>
                        <Button type={goalPreset === 'full_pipeline' ? 'primary' : 'default'} onClick={() => { setGoalPreset('full_pipeline'); setGoalInput(getPresetGoalText('full_pipeline')); }}>
                          从数据到评估
                        </Button>
                        <Button type={goalPreset === 'train_only' ? 'primary' : 'default'} onClick={() => { setGoalPreset('train_only'); setGoalInput(getPresetGoalText('train_only')); }}>
                          仅训练
                        </Button>
                        <Button type={goalPreset === 'evaluate_only' ? 'primary' : 'default'} onClick={() => { setGoalPreset('evaluate_only'); setGoalInput(getPresetGoalText('evaluate_only')); }}>
                          仅评估
                        </Button>
                      </Space>
                      <Input.TextArea
                        placeholder="例如：用电商评论训练一个情感分类模型，自动完成清洗、训练和评估"
                        value={goalInput}
                        onChange={(e) => setGoalInput(e.target.value)}
                        rows={2}
                        maxLength={300}
                        showCount
                      />
                      <div style={{ marginTop: 10 }}>
                        <div style={{ marginBottom: 6, fontWeight: 500 }}>训练方式（范式）</div>
                        <Radio.Group
                          value={trainMode}
                          onChange={(e) => setTrainMode(e.target.value)}
                          style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}
                        >
                          <Radio value="classic_clf">经典分类训练（分类头）</Radio>
                          <Radio value="sft_lora">SFT + LoRA 微调（参数高效）</Radio>
                        </Radio.Group>
                        <div style={{ marginTop: 6, fontSize: 12, color: 'rgba(0,0,0,0.55)' }}>
                          系统会把该选择转成可执行的训练脚本路由（`text_classification` / `sft_finetune`）。
                        </div>
                      </div>
                      <div className="canvas-goal-actions">
                        <Button type="default" onClick={handleGeneratePlan} loading={planLoading}>
                          生成执行计划
                        </Button>
                        {generatedPlan?.plan_id && <Tag color="processing">计划ID: {generatedPlan.plan_id}</Tag>}
                      </div>
                      {planError && <div className="canvas-required-hint">{planError}</div>}
                    </div>
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ marginBottom: 8, fontWeight: 500 }}>训练的是什么模型？</div>
                      <Radio.Group
                        value={modelType}
                        onChange={(e) => setModelType(e.target.value)}
                        style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}
                      >
                        {MODEL_TYPE_OPTIONS.map((opt) => {
                          const available = opt.value === 'text';
                          return (
                            <Radio key={opt.value} value={opt.value} disabled={!available} style={{ marginRight: 0 }} className={!available ? 'canvas-option-locked' : ''}>
                              <span>{opt.label}</span>
                              <span style={{ marginLeft: 6, fontWeight: 400, color: 'rgba(0,0,0,0.55)', fontSize: 12 }}>{opt.desc}</span>
                              {!available && <Tag color="default" style={{ marginLeft: 8, fontSize: 11 }}>开发中</Tag>}
                            </Radio>
                          );
                        })}
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
                          {intentOptionsFiltered.map((opt) => {
                            const available = opt.value === 'sentiment';
                            return (
                              <Radio key={opt.value} value={opt.value} disabled={!available} style={{ marginRight: 0 }} className={!available ? 'canvas-option-locked' : ''}>
                                <span>{opt.label}</span>
                                <span style={{ marginLeft: 6, fontWeight: 400, color: 'rgba(0,0,0,0.55)', fontSize: 12 }}>{opt.desc}</span>
                                {!available && <Tag color="default" style={{ marginLeft: 8, fontSize: 11 }}>开发中</Tag>}
                              </Radio>
                            );
                          })}
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
                        {!isDataAgentRequiredReady && (
                          <div className="canvas-required-hint">
                            请先完成必填项：{dataAgentRequiredMissing.join('、')}
                          </div>
                        )}
                        <Space direction="vertical" style={{ width: '100%' }} size={12}>
                          <div>
                            <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>
                              数据规模 <span className="canvas-field-required">必填</span>
                            </label>
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
                            <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>
                              语言 <span className="canvas-field-required">必填</span>
                            </label>
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
                            <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>
                              领域 <span className="canvas-field-required">必填</span>
                            </label>
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
                            <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>
                              时效 <span className="canvas-field-optional">选填</span>
                            </label>
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
                            <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>
                              质量要求 <span className="canvas-field-optional">选填</span>
                            </label>
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
                            <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>
                              来源偏好 <span className="canvas-field-optional">选填</span>
                            </label>
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
                            <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>
                              自定义要求 {dataAgentOptions.domain === 'other' ? <span className="canvas-field-required">必填</span> : <span className="canvas-field-optional">选填</span>}
                            </label>
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
                        || (materialSource === 'agent' && !isDataAgentRequiredReady)
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
                  <Steps.Step title="数据清洗" description={getStepRationale('clean_data') || 'Data Agent 处理中'} />
                  <Steps.Step title="模型训练" description={getStepRationale('train') || 'Training Agent 执行中'} />
                  <Steps.Step title="模型评估" description={getStepRationale('evaluate') || 'Evaluation Agent 分析中'} />
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
                    <p style={{ marginTop: 6, color: 'rgba(0,0,0,0.55)' }}>{getStepRationale('clean_data') || '清洗和标准化输入数据。'}</p>
                  </Timeline.Item>
                  <Timeline.Item color={getStepIndex(currentPipeline.current_step) >= 1 ? 'blue' : 'gray'}>
                    <p>Training Agent: train</p>
                    {currentPipeline.job_id && <Tag color="processing">Job #{currentPipeline.job_id}</Tag>}
                    <p style={{ marginTop: 6, color: 'rgba(0,0,0,0.55)' }}>{getStepRationale('train') || '按计划配置执行训练。'}</p>
                  </Timeline.Item>
                  <Timeline.Item color={getStepIndex(currentPipeline.current_step) >= 2 ? 'blue' : 'gray'}>
                    <p>Evaluation Agent: evaluate</p>
                    {currentPipeline.model_id && <Tag color="processing">Model #{currentPipeline.model_id}</Tag>}
                    <p style={{ marginTop: 6, color: 'rgba(0,0,0,0.55)' }}>{getStepRationale('evaluate') || '输出评估指标与报告。'}</p>
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
                    <div className="canvas-fallback-actions">
                      <Button
                        onClick={() => {
                          setSelectedDataset(currentPipeline.dataset_id);
                          handleStart();
                        }}
                      >
                        重新清洗后重跑
                      </Button>
                      <Button
                        onClick={() => {
                          setSelectedDataset(currentPipeline.dataset_id);
                          const baseLr = Number((generatedPlan?.train_config?.learning_rate as number) || 2e-5);
                          handleStart({ learning_rate: baseLr * 0.5, batch_size: 8 });
                        }}
                      >
                        降低学习率重试
                      </Button>
                      <Button
                        onClick={() => {
                          setMaterialSource('agent');
                          setCurrentPipeline(null);
                          setCanvasStep(2);
                        }}
                      >
                        切换数据来源策略
                      </Button>
                    </div>
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
      </div>

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
      </div>
    </div>
  );
};

export default AgentCanvas;
