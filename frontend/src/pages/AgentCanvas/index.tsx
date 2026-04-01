import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  Drawer,
  Form,
  Input,
  InputNumber,
  List,
  Modal,
  Row,
  Select,
  Space,
  Statistic,
  Steps,
  Table,
  Tag,
  Timeline,
  Tabs,
  Typography,
  message,
} from 'antd';
import { Upload } from 'antd';
import type { UploadFile } from 'antd/es/upload/interface';
import {
  ArrowRightOutlined,
  CheckCircleOutlined,
  DatabaseOutlined,
  EditOutlined,
  EyeOutlined,
  LinkOutlined,
  PaperClipOutlined,
  PlusOutlined,
  PlayCircleOutlined,
  RobotOutlined,
  SyncOutlined,
  UploadOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import axios from 'axios';
import { agentService } from '@/services/agent';
import { datasetService } from '@/services/dataset';
import { DEFAULT_BASE_MODEL } from '@/constants/baseModels';
import type { Dataset, RunCurrentState, RunSpec } from '@/types';
import PageHero from '@/components/PageHero';
import { SAMPLE_AGENT_CONVERSATION, SAMPLE_MCP_EVENTS, SAMPLE_SCENARIOS, type AgentChatMessage, type McpEvent } from './sampleData';
import './index.css';

const API_BASE = '/api/v1';

type FlowState = RunCurrentState;

type TaskDraft = {
  semantic_task_type: string;
  domain: string;
  modality: 'text' | 'image_text';
  output_structure: string;
  recommended_metrics: string[];
  candidate_methods: string[];
  task_schema_id: string;
};

type ChatSessionItem = {
  id: string;
  title: string;
  subtitle: string;
  progress?: number;
};

type FlowMode = 'full' | 'train_only' | 'eval_only';

const DOMAIN_TAGS = ['通用', '金融', '医疗', '法律', '电商', '教育'];
const TASK_TAGS = ['分类', 'NER', '摘要', '匹配排序', '偏好对齐'];
const MODALITY_TAGS = ['文本', '图文'];
const TASK_TYPE_OPTIONS = ['classification', 'ner', 'summarization', 'rerank', 'preference_alignment'];
const DOMAIN_OPTIONS = ['general', 'finance', 'medical', 'legal', 'ecommerce', 'education'];
const MODALITY_OPTIONS = ['text', 'image_text'];

const schemaHintByTask = (taskType?: string): string => {
  const t = (taskType || '').toLowerCase();
  if (t.includes('ner')) return 'tokens + ner_tags（BIO）';
  if (t.includes('summar')) return 'source + summary';
  if (t.includes('rerank') || t.includes('match')) return 'query + candidate + relevance';
  return 'text + label';
};

const schemaHeadersByTask = (taskType?: string): string[] => {
  const t = (taskType || '').toLowerCase();
  if (t.includes('ner')) return ['tokens', 'ner_tags'];
  if (t.includes('summar')) return ['source', 'summary'];
  if (t.includes('rerank') || t.includes('match')) return ['query', 'candidate', 'relevance'];
  return ['text', 'label'];
};

const DOMAIN_CN_MAP: Record<string, string> = {
  general: '通用领域',
  finance: '金融领域',
  medical: '医疗领域',
  legal: '法律领域',
  ecommerce: '电商领域',
  education: '教育领域',
};

const TASK_CN_MAP: Record<string, string> = {
  sentiment: '情感分类',
  classification: '分类任务',
  ner: '命名实体识别',
  summarization: '文本摘要',
  rerank: '匹配排序',
  preference_alignment: '偏好对齐',
};

const MODALITY_CN_MAP: Record<string, string> = {
  text: '文本',
  image_text: '图文',
};

const METHOD_CN_MAP: Record<string, string> = {
  sft: '监督微调',
  lora: '低秩适配微调',
  qlora: '量化低秩适配',
  classic_clf: '经典分类训练',
  sft_lora: 'SFT + LoRA 微调',
};

const METRIC_CN_MAP: Record<string, string> = {
  accuracy: '准确率',
  macro_f1: '宏平均 F1',
  entity_f1: '实体级 F1',
  token_f1: 'Token 级 F1',
};

const mapDomainHintToTag = (hint?: string): string => {
  const h = (hint || '').toLowerCase();
  if (h.includes('fin')) return '金融';
  if (h.includes('med')) return '医疗';
  if (h.includes('legal') || h.includes('law')) return '法律';
  if (h.includes('edu')) return '教育';
  if (h.includes('ecom') || h.includes('retail')) return '电商';
  if (h.includes('general')) return '通用';
  return '';
};

const inferTaskTagFromText = (text: string): string => {
  const t = text.toLowerCase();
  if (t.includes('摘要') || t.includes('summar')) return '摘要';
  if (t.includes('ner') || t.includes('实体')) return 'NER';
  if (t.includes('匹配') || t.includes('排序') || t.includes('rerank')) return '匹配排序';
  if (t.includes('偏好') || t.includes('对齐')) return '偏好对齐';
  return '分类';
};

const bilingual = (raw?: string, dict?: Record<string, string>): string => {
  const key = (raw || '').trim();
  if (!key) return '-';
  const cn = dict?.[key.toLowerCase()];
  return cn ? `${key} / ${cn}` : key;
};

const bilingualList = (items?: string[], dict?: Record<string, string>): string => {
  if (!items?.length) return '-';
  return items.map((x) => bilingual(x, dict)).join('，');
};

const STEP_STATE_RULES: Record<number, FlowState[]> = {
  0: ['draft', 'intent_submitted', 'task_parsed'],
  1: ['task_parsed'],
  2: ['task_confirmed', 'data_selecting', 'data_validating'],
  3: ['data_ready', 'plan_generating', 'plan_previewed'],
  4: ['plan_frozen', 'training_queued', 'training_running', 'training_succeeded'],
  5: ['evaluating', 'done'],
};

const stepByState = (s: FlowState): number => {
  if (['draft', 'intent_submitted', 'task_parsed'].includes(s)) return 0;
  if (['task_confirmed'].includes(s)) return 1;
  if (['data_selecting', 'data_validating', 'data_ready'].includes(s)) return 2;
  if (['plan_generating', 'plan_previewed', 'plan_frozen'].includes(s)) return 3;
  if (['training_queued', 'training_running', 'training_succeeded'].includes(s)) return 4;
  return 5;
};

const AgentCanvas: React.FC = () => {
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [autoTagLoading, setAutoTagLoading] = useState(false);
  const [state, setState] = useState<FlowState>('draft');

  const [intentText, setIntentText] = useState('');
  const [uiSelectedTags, setUiSelectedTags] = useState<string[]>([]);
  const [modalityHint, setModalityHint] = useState('text');
  const [selectedDomainTag, setSelectedDomainTag] = useState<string>();
  const [selectedTaskTag, setSelectedTaskTag] = useState<string>();
  const [selectedModalityTag, setSelectedModalityTag] = useState<string | undefined>();
  const [customDomainInput, setCustomDomainInput] = useState('');
  const [customDomainTags, setCustomDomainTags] = useState<string[]>([]);

  const [taskDraft, setTaskDraft] = useState<TaskDraft | null>(null);
  const [taskSpec, setTaskSpec] = useState<TaskDraft | null>(null);
  const [showAdvancedTaskEditor, setShowAdvancedTaskEditor] = useState(false);
  const [parsedIntentSnapshot, setParsedIntentSnapshot] = useState('');
  const [readOnlyPreview, setReadOnlyPreview] = useState(false);

  const [datasetSourceMode, setDatasetSourceMode] = useState<'upload' | 'agent_search' | 'agent_convert'>('upload');
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState<number>();
  const [datasetValidationReport, setDatasetValidationReport] = useState<Record<string, string> | null>(null);
  const [rawColumnsInput, setRawColumnsInput] = useState('');
  const [agentColumnMap, setAgentColumnMap] = useState<Record<string, string>>({});

  const [planSpec, setPlanSpec] = useState({
    base_model: DEFAULT_BASE_MODEL,
    training_method: '',
    trainer_backend: 'llamafactory',
    learning_rate: 0.00002,
    batch_size: 16,
    epochs: 3,
    max_seq_length: 1024,
    eval_strategy: 'per_epoch',
    expected_outputs: ['adapter', 'metrics.json', 'eval_report.json'],
  });

  const [runSpec, setRunSpec] = useState<RunSpec | null>(null);
  const [pipeline, setPipeline] = useState<any>(null);
  const [runLogs, setRunLogs] = useState<string[]>([]);
  const [chatMessages, setChatMessages] = useState<AgentChatMessage[]>(SAMPLE_AGENT_CONVERSATION.slice(0, 2));
  const [mcpEvents, setMcpEvents] = useState<McpEvent[]>(SAMPLE_MCP_EVENTS.slice(0, 2));
  const [mcpDrawerOpen, setMcpDrawerOpen] = useState(false);
  const [evalConfirmed, setEvalConfirmed] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [flowMode, setFlowMode] = useState<FlowMode | null>(null);
  const [flowModeConfirmed, setFlowModeConfirmed] = useState(false);
  const [showStage1Card, setShowStage1Card] = useState(false);
  const [showStage2Card, setShowStage2Card] = useState(false);
  const [selectedDomain, setSelectedDomain] = useState('');
  const [selectedTaskType, setSelectedTaskType] = useState('');
  const [selectedTaskName, setSelectedTaskName] = useState('');
  const [taxonomyConfirmed, setTaxonomyConfirmed] = useState(false);
  const [planTimelineOpen, setPlanTimelineOpen] = useState(false);
  const [chatSessions, setChatSessions] = useState<ChatSessionItem[]>([
    { id: 'scenario_finance_full', title: '金融-文本-分类', subtitle: '训练任务-规划中' },
    { id: 'scenario_med_train', title: '医疗-文本-NER', subtitle: '训练任务-规划中' },
    { id: 'scenario_legal_eval', title: '法律-文本-摘要', subtitle: '评估任务-规划中' },
    { id: 'live_new', title: '新建实时对话', subtitle: '训练任务-规划中' },
  ]);
  const [activeSessionId, setActiveSessionId] = useState('scenario_finance_full');

  const [uploadOpen, setUploadOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [uploadForm] = Form.useForm();
  const [importForm] = Form.useForm();
  const [fileList, setFileList] = useState<UploadFile[]>([]);

  const selectedDataset = useMemo(() => datasets.find((d) => d.id === selectedDatasetId), [datasets, selectedDatasetId]);

  const readyDatasetCount = useMemo(() => datasets.filter((d) => d.status === 'ready').length, [datasets]);
  const stateColor = useMemo(() => {
    if (state === 'done') return 'success';
    if (state === 'training_running' || state === 'evaluating') return 'processing';
    if (state === 'plan_frozen' || state === 'training_queued') return 'warning';
    return 'default';
  }, [state]);

  const canEnterStep = (target: number, s: FlowState) => STEP_STATE_RULES[target]?.includes(s) ?? false;
  const currentFlowStep = useMemo(() => stepByState(state), [state]);
  const isLocked = readOnlyPreview;

  const goStep = (target: number) => {
    if (!canEnterStep(target, state)) {
      message.warning('当前状态不允许进入该页面');
      return;
    }
    setReadOnlyPreview(false);
    setStep(target);
  };

  const onStepClick = (target: number) => {
    if (target < currentFlowStep) {
      setReadOnlyPreview(true);
      setStep(target);
      return;
    }
    if (target === currentFlowStep) {
      setReadOnlyPreview(false);
      setStep(target);
      return;
    }
    goStep(target);
  };

  const appendSingleTagToIntent = (
    tag: string,
    groupTags: string[],
    setSelected: React.Dispatch<React.SetStateAction<string | undefined>>
  ) => {
    setSelected(tag);
    setUiSelectedTags((prev) => {
      const withoutGroup = prev.filter((x) => !groupTags.includes(x));
      return [...withoutGroup, tag];
    });
    setIntentText((prev) => {
      const parts = prev
        .split(/[，,]/)
        .map((x) => x.trim())
        .filter((x) => x && !groupTags.includes(x));
      return [...parts, tag].join('，');
    });
    if (tag === '图文') setModalityHint('image_text');
    if (tag === '文本') setModalityHint('text');
  };

  const allDomainTags = useMemo(() => [...DOMAIN_TAGS, ...customDomainTags], [customDomainTags]);

  const clearSelectedPromptOptions = () => {
    setSelectedDomainTag(undefined);
    setSelectedTaskTag(undefined);
    setSelectedModalityTag(undefined);
    setCustomDomainInput('');
    setUiSelectedTags([]);
    setIntentText('');
    setTaskDraft(null);
    setTaskSpec(null);
    setRunSpec(null);
    setPipeline(null);
    setDatasetValidationReport(null);
    setSelectedDatasetId(undefined);
    setParsedIntentSnapshot('');
    setState('draft');
    setStep(0);
    setReadOnlyPreview(false);
    setModalityHint('text');
  };

  const restartFromStep = (target: number) => {
    if (['training_queued', 'training_running', 'evaluating'].includes(state)) {
      message.warning('当前 run 正在执行，暂不支持重开。请先等待完成或终止执行。');
      return;
    }
    Modal.confirm({
      title: '确认从当前步骤重开流程？',
      content: '这会推翻后续步骤结果并回到可编辑状态。',
      okText: '确认重开',
      cancelText: '取消',
      onOk: () => {
        if (target <= 0) {
          setTaskDraft(null);
          setTaskSpec(null);
          setDatasetValidationReport(null);
          setSelectedDatasetId(undefined);
          setRunSpec(null);
          setPipeline(null);
          setRunLogs([]);
          setState('draft');
          setStep(0);
          setReadOnlyPreview(false);
          return;
        }
        if (target === 1) {
          if (taskSpec) setTaskDraft(taskSpec);
          setTaskSpec(null);
          setDatasetValidationReport(null);
          setSelectedDatasetId(undefined);
          setRunSpec(null);
          setPipeline(null);
          setRunLogs([]);
          setState('task_parsed');
          setStep(1);
          setReadOnlyPreview(false);
          return;
        }
        if (target === 2) {
          setDatasetValidationReport(null);
          setRunSpec(null);
          setPipeline(null);
          setRunLogs([]);
          setState('data_selecting');
          setStep(2);
          setReadOnlyPreview(false);
          return;
        }
        setRunSpec(null);
        setPipeline(null);
        setRunLogs([]);
        setState('plan_previewed');
        setStep(3);
        setReadOnlyPreview(false);
      },
    });
  };

  const refreshReadyDatasets = async () => {
    const res = await datasetService.getDatasets('training');
    setDatasets((res.data?.datasets || []).filter((d) => d.status === 'ready'));
  };

  const downloadTaskTemplate = () => {
    const headers = schemaHeadersByTask(taskSpec?.semantic_task_type);
    const sample = headers.map((h) => `sample_${h}`);
    const csv = `${headers.join(',')}\n${sample.join(',')}\n`;
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `task_template_${taskSpec?.semantic_task_type || 'default'}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const generateAgentColumnMap = () => {
    const expected = schemaHeadersByTask(taskSpec?.semantic_task_type);
    const rawCols = rawColumnsInput
      .split(/[，,\n]/)
      .map((x) => x.trim())
      .filter(Boolean);
    if (rawCols.length === 0) {
      message.warning('请先输入原始字段名（逗号分隔）');
      return;
    }
    const nextMap: Record<string, string> = {};
    expected.forEach((targetKey) => {
      const exact = rawCols.find((r) => r.toLowerCase() === targetKey.toLowerCase());
      if (exact) {
        nextMap[targetKey] = exact;
        return;
      }
      const fuzzy = rawCols.find((r) =>
        r.toLowerCase().includes(targetKey.toLowerCase()) ||
        targetKey.toLowerCase().includes(r.toLowerCase())
      );
      if (fuzzy) nextMap[targetKey] = fuzzy;
    });
    setAgentColumnMap(nextMap);
    message.success('已生成字段映射建议，可继续编辑后导入');
  };

  useEffect(() => {
    void refreshReadyDatasets();
  }, []);

  useEffect(() => {
    if (!pipeline?.id || !['queued', 'running'].includes(pipeline.status)) return;
    const timer = setInterval(async () => {
      try {
        const res = await axios.get(`${API_BASE}/pipelines/${pipeline.id}`);
        const next = res.data;
        setPipeline(next);
        if (next.status === 'queued') setState('training_queued');
        if (next.status === 'running') {
          if (next.current_step === 'evaluate') {
            setState('training_succeeded');
            setState('evaluating');
          } else {
            setState('training_running');
          }
        }
        if (next.status === 'completed') setState('done');
        if (next.status === 'failed') {
          if (state === 'evaluating') setState('training_succeeded');
          else setState('plan_frozen');
        }
      } catch {
        // ignore poll errors
      }
    }, 2500);
    return () => clearInterval(timer);
  }, [pipeline, state]);

  useEffect(() => {
    if (!pipeline?.id) return;
    if (pipeline?.logs && Array.isArray(pipeline.logs)) {
      setRunLogs(pipeline.logs.map((x: unknown) => String(x)));
      return;
    }
    if (pipeline?.log_lines && Array.isArray(pipeline.log_lines)) {
      setRunLogs(pipeline.log_lines.map((x: unknown) => String(x)));
    }
  }, [pipeline]);

  const parseIntent = async () => {
    if (!intentText.trim()) return message.warning('请先输入训练目标');

    setState('intent_submitted');
    setLoading(true);
    try {
      const plannerGoal = `${intentText.trim()}

【领域审查要求】
1) 先判断用户选择的领域“${selectedDomainTag || '（未指定）'}”是否合理且客观存在；
2) 若领域不合理或过于模糊，请给出更合适的领域建议并在结果中提示；
3) 若领域合理，请沿用该领域继续生成任务草稿。`;

      const plan = await agentService.createPlan({ goal: plannerGoal, model_type: 'text' });
      const inferred = (plan.inferred_intent || '').toLowerCase();
      const domain = (plan.intent_resolution?.domain_hint || 'general').toLowerCase();
      const method = (plan.train_mode || 'classic_clf').toLowerCase();
      const draft: TaskDraft = {
        semantic_task_type: inferred || 'classification',
        domain,
        modality: modalityHint === 'image_text' ? 'image_text' : 'text',
        output_structure: inferred.includes('ner') ? 'sequence_tags' : 'classification_label',
        recommended_metrics: inferred.includes('ner') ? ['entity_f1', 'token_f1'] : ['accuracy', 'macro_f1'],
        candidate_methods: method === 'sft_lora' ? ['lora', 'qlora'] : ['sft', 'lora'],
        task_schema_id: inferred.includes('ner') ? 'ner_bio_v1' : 'text_cls_v1',
      };
      setTaskDraft(draft);
      setParsedIntentSnapshot(intentText.trim());
      setState('task_parsed');
      setChatMessages((prev) => [
        ...prev,
        {
          id: `msg_${Date.now()}`,
          role: 'agent',
          stage: 'task_confirm',
          content: `我已识别为 ${draft.semantic_task_type}/${draft.domain}/${draft.modality}，请确认任务定义。`,
          timestamp: new Date().toLocaleTimeString('zh-CN'),
        },
      ]);
      message.success('已解析目标（草稿）');
    } catch (e: any) {
      setState('draft');
      message.error(e?.message || '解析失败');
    } finally {
      setLoading(false);
    }
  };

  const autoDetectOptions = async () => {
    const text = intentText.trim();
    if (!text) return message.warning('请先输入训练目标文本');
    setAutoTagLoading(true);
    try {
      const resolved = await agentService.resolveIntent(text);
      let domainTag = mapDomainHintToTag(resolved.domain_hint);
      if (!domainTag) {
        if (text.includes('法律')) domainTag = '法律';
        else if (text.includes('金融')) domainTag = '金融';
        else if (text.includes('医疗')) domainTag = '医疗';
        else if (text.includes('教育')) domainTag = '教育';
        else if (text.includes('电商')) domainTag = '电商';
      }
      if (!domainTag) {
        const custom = (resolved.domain_hint || '').trim();
        if (custom) {
          if (!allDomainTags.includes(custom)) setCustomDomainTags((prev) => [...prev, custom]);
          domainTag = custom;
        } else {
          domainTag = '通用';
        }
      }
      appendSingleTagToIntent(domainTag, [...allDomainTags, domainTag], setSelectedDomainTag);

      const taskTag = inferTaskTagFromText(`${text} ${resolved.inferred_intent || ''}`);
      appendSingleTagToIntent(taskTag, TASK_TAGS, setSelectedTaskTag);

      const modalityTag = text.includes('图像') || text.includes('图片') || text.includes('多模态') ? '图文' : '文本';
      if (modalityTag === '文本') {
        appendSingleTagToIntent('文本', MODALITY_TAGS, setSelectedModalityTag);
      } else {
        // 图文未开放，兜底仍选文本
        appendSingleTagToIntent('文本', MODALITY_TAGS, setSelectedModalityTag);
      }

      message.success('已自动识别并填充选项，可直接解析目标');
    } catch (e: any) {
      message.error(e?.message || '自动识别失败，请手动选择');
    } finally {
      setAutoTagLoading(false);
    }
  };

  const confirmTask = () => {
    if (state !== 'task_parsed' || !taskDraft) return message.warning('请先完成任务解析');
    setTaskSpec(taskDraft);
    setShowAdvancedTaskEditor(false);
    setState('data_selecting');
    setStep(2);
    setChatMessages((prev) => [
      ...prev,
      {
        id: `msg_${Date.now()}`,
        role: 'user',
        stage: 'task_confirm',
        content: '确认任务定义，进入数据准备。',
        timestamp: new Date().toLocaleTimeString('zh-CN'),
      },
      {
        id: `msg_${Date.now() + 1}`,
        role: 'agent',
        stage: 'data_prepare',
        content: `请准备符合 schema（${schemaHintByTask(taskDraft.semantic_task_type)}）的数据。`,
        timestamp: new Date().toLocaleTimeString('zh-CN'),
      },
    ]);
  };

  const confirmData = () => {
    if (!['task_confirmed', 'data_selecting', 'data_validating'].includes(state)) {
      return message.warning('当前状态不能确认数据');
    }
    if (!taskSpec) return message.warning('没有 task_confirmed，不能进入数据确认');
    if (!selectedDatasetId) return message.warning('请先选择数据集');

    setState('data_validating');

    const expectedSchema = schemaHintByTask(taskSpec.semantic_task_type);
    const expectedMinColumns =
      expectedSchema.includes('tokens') || expectedSchema.includes('query') ? 3 :
      expectedSchema.includes('source + summary') ? 2 : 2;
    const actualColumns = Number(selectedDataset?.column_count || 0);
    const fieldCheckPassed = actualColumns >= expectedMinColumns;

    if (!selectedDataset?.row_count || selectedDataset.row_count <= 0) {
      setState('data_selecting');
      return message.error('数据校验失败：样本数为 0');
    }
    if (!fieldCheckPassed) {
      setDatasetValidationReport({
        schema_check: 'failed',
        field_check: `failed（期望至少 ${expectedMinColumns} 列，当前 ${actualColumns} 列）`,
        sample_count: `${selectedDataset.row_count}`,
        label_distribution: 'unknown',
      });
      setState('data_selecting');
      return message.error('数据校验失败：字段数不满足当前任务 schema');
    }

    setDatasetValidationReport({
      schema_check: 'passed',
      field_check: `passed（${actualColumns} 列）`,
      sample_count: `${selectedDataset.row_count}`,
      label_distribution: 'ok',
    });

    setState('data_ready');
    setStep(3);
    setChatMessages((prev) => [
      ...prev,
      {
        id: `msg_${Date.now()}`,
        role: 'agent',
        stage: 'plan_confirm',
        content: '数据校验通过。我将基于任务与数据生成建议训练计划，请确认。',
        timestamp: new Date().toLocaleTimeString('zh-CN'),
      },
    ]);
  };

  const regeneratePlan = async () => {
    if (state !== 'data_ready' && state !== 'plan_previewed') {
      return message.warning('没有 data_ready，不能生成训练计划');
    }
    setState('plan_generating');
    try {
      const recommendedMethod = taskSpec?.candidate_methods?.[0] || planSpec.training_method || 'lora';
      setPlanSpec((prev) => ({
        ...prev,
        training_method: recommendedMethod,
        eval_strategy: taskSpec?.semantic_task_type?.includes('ner') ? 'per_epoch_entity_f1' : 'per_epoch',
      }));
      setState('plan_previewed');
      message.success('已基于当前任务与数据重新生成建议计划');
    } catch {
      setState('data_ready');
    }
  };

  const freezePlan = () => {
    if (state !== 'data_ready' && state !== 'plan_previewed') {
      return message.warning('当前状态不能冻结计划');
    }
    if (!taskSpec) return message.warning('任务未确认');
    if (!selectedDatasetId) return message.warning('数据未确认');
    if (!planSpec.training_method.trim()) return message.warning('请填写训练方法');

    const now = new Date().toISOString();
    const nextRunSpec: RunSpec = {
      run_id: `run_${Date.now()}`,
      task_spec: taskSpec,
      dataset_spec: {
        dataset_source_mode: datasetSourceMode,
        dataset_id: selectedDataset ? String(selectedDataset.id) : undefined,
        raw_file_path: selectedDataset?.original_file_path || undefined,
        normalized_dataset_path: selectedDataset?.cleaned_file_path || undefined,
        schema_valid: true,
        split_strategy: 'preset',
        train_path: selectedDataset?.cleaned_file_path || undefined,
        sample_count: selectedDataset?.row_count || undefined,
      },
      plan_spec: planSpec,
      current_state: 'plan_frozen',
      created_at: now,
      updated_at: now,
      owner: 'default_user',
      intent_draft: {
        intent_text: intentText,
        ui_selected_tags: uiSelectedTags,
        modality_hint: modalityHint,
      },
    };

    setRunSpec(nextRunSpec);
    setState('plan_frozen');
    setStep(4);
    setChatMessages((prev) => [
      ...prev,
      {
        id: `msg_${Date.now()}`,
        role: 'agent',
        stage: 'train_execute',
        content: '计划已冻结。你可以启动训练，训练完成后将进入评估确认。',
        timestamp: new Date().toLocaleTimeString('zh-CN'),
      },
    ]);
  };

  const startRun = async () => {
    if (state !== 'plan_frozen') return message.warning('没有 plan_frozen，不能启动训练');
    if (!selectedDatasetId || !runSpec) return;

    setLoading(true);
    try {
      const payload: Record<string, unknown> = {
        dataset_id: selectedDatasetId,
        train_config: {
          model_type: 'text_classification',
          base_model: planSpec.base_model,
          epochs: planSpec.epochs,
          batch_size: planSpec.batch_size,
          learning_rate: planSpec.learning_rate,
        },
        run_spec: runSpec,
      };

      setState('training_queued');
      const res = await axios.post(`${API_BASE}/pipelines`, payload);
      setPipeline(res.data);
      setState('training_running');
      setMcpEvents((prev) => [
        ...prev,
        {
          id: `mcp_${Date.now()}`,
          server: 'training',
          tool: 'trainer.start_job',
          summary: `提交训练任务成功，pipeline_id=${res.data?.id || '-'}`,
          status: 'running',
          timestamp: new Date().toLocaleTimeString('zh-CN'),
        },
      ]);
      message.success('训练已启动');
    } catch (e: any) {
      setState('plan_frozen');
      message.error(e?.message || '启动失败');
    } finally {
      setLoading(false);
    }
  };

  const statusSubtitleByState = (s: FlowState): string => {
    if (['draft', 'intent_submitted', 'task_parsed', 'task_confirmed', 'data_selecting', 'data_validating', 'data_ready', 'plan_generating', 'plan_previewed'].includes(s)) {
      return '训练任务-规划中';
    }
    if (['plan_frozen', 'training_queued', 'training_running', 'training_succeeded'].includes(s)) {
      return '训练任务-进行中';
    }
    if (['evaluating'].includes(s)) return '评估任务-进行中';
    if (s === 'done') return '评估任务-已完成';
    return '任务进行中';
  };

  const statusAccentBySubtitle = (subtitle: string): string => {
    if (subtitle.includes('已完成')) return '#52c41a';
    if (subtitle.includes('进行中')) return '#1677ff';
    return '#faad14';
  };

  useEffect(() => {
    setChatSessions((prev) =>
      prev.map((it) =>
        it.id === activeSessionId
          ? {
              ...it,
              subtitle: statusSubtitleByState(state),
              progress: state === 'training_running' ? 60 : state === 'evaluating' ? 90 : state === 'done' ? 100 : it.progress,
            }
          : it
      )
    );
  }, [state, activeSessionId]);

  useEffect(() => {
    const scenario = SAMPLE_SCENARIOS.find((s) => s.id === activeSessionId);
    if (!scenario) return;
    setFlowMode(scenario.flowMode);
    setFlowModeConfirmed(true);
    setSelectedDomain(scenario.taxonomy.domain);
    setSelectedTaskType(scenario.taxonomy.type);
    setSelectedTaskName(scenario.taxonomy.task);
    setTaxonomyConfirmed(true);
    setChatMessages(scenario.conversation);
    setMcpEvents(scenario.mcpTimeline);
    setShowStage1Card(false);
    setShowStage2Card(false);
  }, [activeSessionId]);

  const sendChat = async () => {
    const text = chatInput.trim();
    if (!text) return;
    if (!flowModeConfirmed) {
      message.warning('请先确认流程模式：全流程 / 仅训练 / 仅评估');
      return;
    }
    if (!taxonomyConfirmed) {
      message.warning('请先确认领域-类型-任务');
      return;
    }
    setChatMessages((prev) => [
      ...prev,
      {
        id: `msg_${Date.now()}`,
        role: 'user',
        stage: 'goal_input',
        content: text,
        timestamp: new Date().toLocaleTimeString('zh-CN'),
      },
    ]);
    setIntentText(text);
    setChatInput('');
    if (state === 'draft' || state === 'task_parsed') {
      await parseIntent();
    }
  };

  const flowModeLabel = (m: FlowMode): string => {
    if (m === 'full') return '全流程';
    if (m === 'train_only') return '仅训练';
    return '仅评估';
  };

  const confirmFlowMode = () => {
    if (!flowMode) {
      message.warning('请先选择流程模式');
      return;
    }
    setFlowModeConfirmed(true);
    setShowStage1Card(false);
    setShowStage2Card(true);
    setChatMessages((prev) => [
      ...prev,
      {
        id: `msg_${Date.now()}`,
        role: 'user',
        stage: 'goal_input',
        content: `我选择流程模式：${flowModeLabel(flowMode)}。`,
        timestamp: new Date().toLocaleTimeString('zh-CN'),
      },
      {
        id: `msg_${Date.now() + 1}`,
        role: 'agent',
        stage: 'goal_input',
        content: 'Flow mode confirmed. Next, please confirm domain / type / task.',
        timestamp: new Date().toLocaleTimeString('zh-CN'),
      },
    ]);
  };

  const confirmTaxonomy = () => {
    if (!selectedDomain || !selectedTaskType || !selectedTaskName) {
      message.warning('请完整选择领域、类型和任务');
      return;
    }
    setTaxonomyConfirmed(true);
    setShowStage2Card(false);
    setChatInput(`${selectedDomain}，${selectedTaskType}，${selectedTaskName}。`);
    setChatMessages((prev) => [
      ...prev,
      {
        id: `msg_${Date.now()}`,
        role: 'user',
        stage: 'task_confirm',
        content: `确认分类：${selectedDomain} / ${selectedTaskType} / ${selectedTaskName}`,
        timestamp: new Date().toLocaleTimeString('zh-CN'),
      },
      {
        id: `msg_${Date.now() + 1}`,
        role: 'agent',
        stage: 'task_confirm',
        content: '分类已记录。请在输入框补充业务目标、数据来源和约束，我会开始规划。',
        timestamp: new Date().toLocaleTimeString('zh-CN'),
      },
    ]);
  };

  const prototypeMode = true;
  if (prototypeMode) {
  const activeSession = chatSessions.find((s) => s.id === activeSessionId);
    return (
      <div className="agent-canvas" data-theme="light">
        <div className="canvas-main">
          <div className="agent-proto-header">
            <Typography.Title level={4} style={{ margin: 0 }}>
              Agent 训练编排中心
            </Typography.Title>
            <Button onClick={() => setMcpDrawerOpen(true)}>数据控制台</Button>
          </div>

          <Row gutter={[12, 12]}>
            <Col xs={24} md={7} lg={6}>
              <Card
                className="agent-proto-side-card"
                size="small"
                title={(
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>会话列表</span>
                    <Space size={4}>
                      <Button
                        type="text"
                        size="small"
                        icon={<PlusOutlined />}
                        onClick={() => {
                          const id = `s_${Date.now()}`;
                          setChatSessions((prev) => [{ id, title: '新建对话', subtitle: '训练任务-规划中' }, ...prev]);
                          setActiveSessionId(id);
                          clearSelectedPromptOptions();
                          setFlowMode(null);
                          setFlowModeConfirmed(false);
                          setShowStage1Card(true);
                          setShowStage2Card(false);
                          setSelectedDomain('');
                          setSelectedTaskType('');
                          setSelectedTaskName('');
                          setTaxonomyConfirmed(false);
                          setChatMessages([
                            {
                              id: `msg_${Date.now()}`,
                              role: 'agent',
                              stage: 'goal_input',
                              content:
                                'Hello! I am your training orchestration agent. Let us start with Stage 1: please choose a flow mode.',
                              timestamp: new Date().toLocaleTimeString('zh-CN'),
                            },
                          ]);
                          setMcpEvents([]);
                        }}
                      />
                    </Space>
                  </div>
                )}
              >
                <List
                  dataSource={chatSessions}
                  renderItem={(item) => (
                    <List.Item
                      className={`agent-proto-session-item ${item.id === activeSessionId ? 'agent-proto-session-item-active' : ''}`}
                      onClick={() => setActiveSessionId(item.id)}
                    >
                      <div style={{ width: '100%', position: 'relative' }}>
                        <div className="agent-proto-session-accent" style={{ background: statusAccentBySubtitle(item.subtitle) }} />
                        <div style={{ fontWeight: 600, paddingRight: 30, lineHeight: 1.45, marginBottom: 4 }}>{item.title}</div>
                        <Button
                          type="text"
                          size="small"
                          icon={<DeleteOutlined />}
                          className="agent-proto-session-delete"
                          onClick={(e) => {
                            e.stopPropagation();
                            setChatSessions((prev) => prev.filter((x) => x.id !== item.id));
                            if (activeSessionId === item.id) {
                              const next = chatSessions.find((x) => x.id !== item.id);
                              if (next) setActiveSessionId(next.id);
                            }
                          }}
                        />
                        <div style={{ fontSize: 12, color: '#52c41a', lineHeight: 1.45 }}>{item.subtitle}</div>
                        {typeof item.progress === 'number' && (
                          <>
                            <div style={{ fontSize: 12, color: '#8c8c8c' }}>进度：{item.progress}%</div>
                            <div className="agent-proto-progress-track">
                              <div className="agent-proto-progress-fill" style={{ width: `${Math.max(0, Math.min(100, item.progress))}%` }} />
                            </div>
                          </>
                        )}
                      </div>
                    </List.Item>
                  )}
                />
              </Card>
            </Col>

            <Col xs={24} md={17} lg={18}>
              <Card
                className="agent-proto-main-card"
                size="small"
                title={(
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Space>
                      <span style={{ fontWeight: 600 }}>{activeSession?.title || '当前对话'}</span>
                      <span style={{ color: '#52c41a' }}>{activeSession?.subtitle || ''}</span>
                    </Space>
                    <Space size={4}>
                      <Button type="text" size="small" icon={<EyeOutlined />} onClick={() => setPlanTimelineOpen(true)} />
                      <Button type="text" size="small" icon={<PaperClipOutlined />} onClick={() => setMcpDrawerOpen(true)} />
                      <Button
                        type="text"
                        size="small"
                        icon={<EditOutlined />}
                        onClick={() => {
                          const current = activeSession?.title || '';
                          const next = window.prompt('请输入新的对话名称', current);
                          if (!next) return;
                          setChatSessions((prev) => prev.map((s) => (s.id === activeSessionId ? { ...s, title: next } : s)));
                        }}
                      />
                      <Button
                        type="text"
                        size="small"
                        icon={<DeleteOutlined />}
                        onClick={() => {
                          setChatMessages([]);
                          clearSelectedPromptOptions();
                        }}
                      />
                    </Space>
                  </div>
                )}
              >
                <div className="agent-proto-chat-stream">
                  <List
                    dataSource={chatMessages}
                    renderItem={(m) => (
                      <List.Item className={`agent-proto-chat-row ${m.role === 'user' ? 'agent-proto-chat-row-user' : 'agent-proto-chat-row-agent'}`}>
                        <div className={`agent-proto-bubble ${m.role === 'agent' ? 'agent-proto-bubble-agent' : 'agent-proto-bubble-user'}`}>
                          <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 4 }}>
                            {m.role === 'agent' ? 'Agent' : m.role === 'user' ? '你' : '系统'} · {m.timestamp}
                          </div>
                          <div>{m.content}</div>
                        </div>
                      </List.Item>
                    )}
                  />
                  {showStage1Card && (
                    <Card size="small" title="阶段 1：确认流程模式" style={{ marginBottom: 10 }}>
                      <Space wrap>
                        {[
                          { key: 'full', label: '全流程（训练+评估）' },
                          { key: 'train_only', label: '仅训练' },
                          { key: 'eval_only', label: '仅评估' },
                        ].map((item) => (
                          <Button
                            key={item.key}
                            type={flowMode === item.key ? 'primary' : 'default'}
                            onClick={() => setFlowMode(item.key as FlowMode)}
                            disabled={flowModeConfirmed}
                          >
                            {item.label}
                          </Button>
                        ))}
                        <Button type="dashed" onClick={confirmFlowMode} disabled={flowModeConfirmed}>
                          {flowModeConfirmed ? '已确认流程模式' : '确认流程模式'}
                        </Button>
                      </Space>
                    </Card>
                  )}
                  {showStage2Card && (
                    <Card size="small" title="阶段 2：确认领域-类型-任务" style={{ marginBottom: 10 }}>
                      <Row gutter={[8, 8]}>
                        <Col span={8}>
                          <Select
                            value={selectedDomain || undefined}
                            onChange={setSelectedDomain}
                            placeholder="领域"
                            disabled={!flowModeConfirmed || taxonomyConfirmed}
                            style={{ width: '100%' }}
                            options={['金融', '医疗', '法律', '电商', '教育', '通用'].map((x) => ({ label: x, value: x }))}
                          />
                        </Col>
                        <Col span={8}>
                          <Select
                            value={selectedTaskType || undefined}
                            onChange={setSelectedTaskType}
                            placeholder="类型"
                            disabled={!flowModeConfirmed || taxonomyConfirmed}
                            style={{ width: '100%' }}
                            options={['文本', '图文', '语音文本'].map((x) => ({ label: x, value: x }))}
                          />
                        </Col>
                        <Col span={8}>
                          <Select
                            value={selectedTaskName || undefined}
                            onChange={setSelectedTaskName}
                            placeholder="任务"
                            disabled={!flowModeConfirmed || taxonomyConfirmed}
                            style={{ width: '100%' }}
                            options={['分类', 'NER', '摘要', '生成', '匹配排序'].map((x) => ({ label: x, value: x }))}
                          />
                        </Col>
                      </Row>
                      <div style={{ marginTop: 8 }}>
                        <Button type="dashed" onClick={confirmTaxonomy} disabled={!flowModeConfirmed || taxonomyConfirmed}>
                          {taxonomyConfirmed ? '已确认领域-类型-任务' : '确认领域-类型-任务'}
                        </Button>
                      </div>
                    </Card>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <Input.TextArea
                    rows={3}
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="请输入你的训练/评估目标、约束条件或修改意见…"
                    disabled={!flowModeConfirmed || !taxonomyConfirmed}
                  />
                  <Button type="primary" onClick={() => void sendChat()} disabled={!flowModeConfirmed || !taxonomyConfirmed}>
                    发送
                  </Button>
                </div>
              </Card>
            </Col>
          </Row>
        </div>

        <Drawer
          title="MCP 信息窗口（示例）"
          open={mcpDrawerOpen}
          onClose={() => setMcpDrawerOpen(false)}
          width={460}
        >
          <Tabs
            items={[
              {
                key: 'live',
                label: '当前事件',
                children: (
                  <List
                    size="small"
                    dataSource={mcpEvents}
                    renderItem={(evt) => (
                      <List.Item>
                        <div>
                          <Typography.Text strong>{evt.server}.{evt.tool}</Typography.Text>
                          <Tag style={{ marginLeft: 8 }} color={evt.status === 'success' ? 'success' : evt.status === 'failed' ? 'error' : 'processing'}>
                            {evt.status}
                          </Tag>
                          <div style={{ marginTop: 4, fontSize: 12 }}>{evt.summary}</div>
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>{evt.timestamp}</Typography.Text>
                        </div>
                      </List.Item>
                    )}
                  />
                ),
              },
              {
                key: 'sample',
                label: '全流程示例',
                children: (
                  <List
                    size="small"
                    dataSource={SAMPLE_MCP_EVENTS}
                    renderItem={(evt) => (
                      <List.Item>
                        <div>
                          <Typography.Text strong>{evt.server}.{evt.tool}</Typography.Text>
                          <div style={{ marginTop: 4, fontSize: 12 }}>{evt.summary}</div>
                        </div>
                      </List.Item>
                    )}
                  />
                ),
              },
            ]}
          />
        </Drawer>

        <Modal
          title="规划阶段时间线"
          open={planTimelineOpen}
          onCancel={() => setPlanTimelineOpen(false)}
          footer={null}
        >
          <Timeline
            items={[
              { color: flowModeConfirmed ? 'green' : 'gray', children: '已确认流程模式（全流程/仅训练/仅评估）' },
              { color: taxonomyConfirmed ? 'green' : 'gray', children: '已确认领域-类型-任务' },
              { color: chatMessages.some((m) => m.stage === 'plan_confirm') ? 'blue' : 'gray', children: 'Planner 已输出建议计划' },
              { color: mcpEvents.length > 0 ? 'blue' : 'gray', children: 'MCP 事件流已接入可视化窗口' },
            ]}
          />
        </Modal>
      </div>
    );
  }

  return (
    <div className="agent-canvas" data-theme="light">
      <div className="canvas-main">
        <PageHero
          className="canvas-header"
          icon={<RobotOutlined />}
          title="Agent 训练编排中心"
          subtitle="保留专业 UI 面板风格，使用状态机驱动五阶段流程。"
          extra={(
            <Button
              className="canvas-back-to-classic-btn"
              onClick={() => {
                localStorage.setItem('app-version', 'classic');
                window.location.href = '/';
              }}
            >
              返回经典版工作台
            </Button>
          )}
        />

        <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
          <Col xs={24} md={8}>
            <Card>
              <Statistic
                title="当前状态"
                value={state}
                valueStyle={{ fontSize: 18 }}
                suffix={<Tag color={stateColor}>{state === 'done' ? '已完成' : '进行中'}</Tag>}
              />
            </Card>
          </Col>
          <Col xs={24} md={8}>
            <Card>
              <Statistic title="就绪数据集" value={readyDatasetCount} prefix={<DatabaseOutlined />} />
            </Card>
          </Col>
          <Col xs={24} md={8}>
            <Card>
              <Statistic title="Run ID" value={runSpec?.run_id || '-'} valueStyle={{ fontSize: 16 }} />
            </Card>
          </Col>
        </Row>

        <div className="canvas-board canvas-flat-board">
          <Row gutter={[16, 16]}>
            <Col xs={24} lg={18}>
              <Card title="Agent 五阶段流程" className="step-card">
                <Steps
                  current={step}
                  onChange={onStepClick}
                  items={[
                    { title: '目标输入' },
                    { title: '任务确认' },
                    { title: '数据准备' },
                    { title: '计划确认' },
                    { title: '训练执行' },
                    { title: '评估确认与结果' },
                  ]}
                  style={{ marginBottom: 16 }}
                />
                <Card size="small" title="Agent 对话确认流" style={{ marginBottom: 12 }}>
                  <List
                    size="small"
                    dataSource={chatMessages}
                    renderItem={(m) => (
                      <List.Item>
                        <div style={{ width: '100%' }}>
                          <Typography.Text strong>{m.role === 'agent' ? 'Agent' : m.role === 'user' ? '你' : '系统'}</Typography.Text>
                          <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>{m.timestamp}</Typography.Text>
                          <div style={{ marginTop: 4 }}>{m.content}</div>
                        </div>
                      </List.Item>
                    )}
                  />
                </Card>
                {isLocked && (
                  <Alert
                    type="warning"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message="当前为历史回看模式，内容已锁定不可编辑"
                    action={
                      <Button size="small" type="link" onClick={() => restartFromStep(step)}>
                        从当前步骤重开流程
                      </Button>
                    }
                  />
                )}

                {step === 0 && (
                  <Row gutter={[12, 12]}>
                    <Col xs={24}>
                      <Space direction="vertical" style={{ width: '100%' }} size="middle">
                        <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                          单入口模式：快捷标签仅用于补全描述文本，不直接写入结构化字段或推进流程状态。
                        </Typography.Text>
                        <div style={{ position: 'relative' }}>
                          <Input.TextArea
                            rows={4}
                            value={intentText}
                            onChange={(e) => setIntentText(e.target.value)}
                            placeholder="请描述你想训练什么模型、解决什么任务、希望输出什么结果（例如：训练一个金融文本模型，用于识别财报中的公司、金额和时间实体）"
                            style={{ paddingRight: 40 }}
                            disabled={isLocked}
                          />
                          <Button
                            type="text"
                            icon={<DeleteOutlined />}
                            title="清空当前选项"
                            onClick={clearSelectedPromptOptions}
                            style={{ position: 'absolute', top: 6, right: 6, color: 'rgba(0,0,0,0.45)' }}
                            disabled={isLocked}
                          />
                        </div>
                        <div>
                          <Typography.Text strong style={{ marginRight: 8 }}>领域：</Typography.Text>
                          <Space wrap>
                            {allDomainTags.map((x) => (
                              <Tag className="flat-option-tag"
                                key={x}
                                color={selectedDomainTag === x ? 'blue' : 'default'}
                                onClick={isLocked ? undefined : () => appendSingleTagToIntent(x, allDomainTags, setSelectedDomainTag)}
                              >
                                {x}
                              </Tag>
                            ))}
                          </Space>
                          <Space style={{ marginTop: 8 }}>
                            <Input
                              size="small"
                              placeholder="自定义领域（如：政务、制造）"
                              value={customDomainInput}
                              onChange={(e) => setCustomDomainInput(e.target.value)}
                              style={{ width: 220 }}
                              disabled={isLocked}
                            />
                            <Button
                              size="small"
                              disabled={isLocked}
                              onClick={() => {
                                const v = customDomainInput.trim();
                                if (!v) return;
                                if (!allDomainTags.includes(v)) {
                                  setCustomDomainTags((prev) => [...prev, v]);
                                }
                                appendSingleTagToIntent(v, [...allDomainTags, v], setSelectedDomainTag);
                                setCustomDomainInput('');
                              }}
                            >
                              创建并选择
                            </Button>
                          </Space>
                        </div>
                        <div>
                          <Typography.Text strong style={{ marginRight: 8 }}>模态：</Typography.Text>
                          <Space wrap>
                            {MODALITY_TAGS.map((x) => (
                              <Tag className="flat-option-tag"
                                key={x}
                                color={selectedModalityTag === x ? 'blue' : 'default'}
                                style={x === '图文' ? { cursor: 'not-allowed', opacity: 0.6 } : undefined}
                                onClick={isLocked || x === '图文' ? undefined : () => appendSingleTagToIntent(x, MODALITY_TAGS, setSelectedModalityTag)}
                              >
                                {x}{x === '图文' ? '（未开放）' : ''}
                              </Tag>
                            ))}
                          </Space>
                        </div>
                        <div>
                          <Typography.Text strong style={{ marginRight: 8 }}>任务：</Typography.Text>
                          <Space wrap>
                            {TASK_TAGS.map((x) => (
                              <Tag className="flat-option-tag"
                                key={x}
                                color={selectedTaskTag === x ? 'blue' : 'default'}
                                onClick={isLocked ? undefined : () => appendSingleTagToIntent(x, TASK_TAGS, setSelectedTaskTag)}
                              >
                                {x}
                              </Tag>
                            ))}
                          </Space>
                        </div>
                        <Button
                          type="primary"
                          loading={loading}
                          disabled={isLocked}
                          icon={taskDraft && intentText.trim() === parsedIntentSnapshot ? <ArrowRightOutlined /> : undefined}
                          onClick={() => {
                            if (taskDraft && intentText.trim() === parsedIntentSnapshot) {
                              goStep(1);
                              return;
                            }
                            void parseIntent();
                          }}
                        >
                          {taskDraft && intentText.trim() === parsedIntentSnapshot ? '下一步：任务确认' : '请解析目标'}
                        </Button>
                        <Button
                          type="default"
                          loading={autoTagLoading}
                          disabled={isLocked}
                          onClick={() => void autoDetectOptions()}
                        >
                          Agent 自动识别选项
                        </Button>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          文本框是唯一主入口；下方选项仅用于快速补全输入，适合新手快速明确任务目标。
                        </Typography.Text>
                        <Card title="Planner 解析预览" size="small" className="planner-preview-flat">
                          {taskDraft ? (
                            <Descriptions column={1} size="small">
                              <Descriptions.Item label="intent_text">{intentText || '-'}</Descriptions.Item>
                              <Descriptions.Item label="parsed_task_draft">
                                {`${taskDraft.semantic_task_type} / ${taskDraft.domain} / ${taskDraft.modality}`}
                              </Descriptions.Item>
                              <Descriptions.Item label="输出结构">{taskDraft.output_structure}</Descriptions.Item>
                              <Descriptions.Item label="候选方法">{taskDraft.candidate_methods.join(', ') || '-'}</Descriptions.Item>
                            </Descriptions>
                          ) : (
                            <Alert
                              type="info"
                              showIcon
                              message="尚未解析"
                              description="输入训练目标并点击“解析目标”后，这里展示 parsed_task_draft。"
                            />
                          )}
                        </Card>
                      </Space>
                    </Col>
                  </Row>
                )}

                {step === 1 && taskDraft && (
                  <Space direction="vertical" style={{ width: '100%' }}>
                    <Card size="small" title="当前任务卡（Planner 草稿）">
                      <Descriptions bordered column={1} size="small">
                        <Descriptions.Item label="任务类型">{bilingual(taskDraft.semantic_task_type, TASK_CN_MAP)}</Descriptions.Item>
                        <Descriptions.Item label="领域">{bilingual(taskDraft.domain, DOMAIN_CN_MAP)}</Descriptions.Item>
                        <Descriptions.Item label="模态">{bilingual(taskDraft.modality, MODALITY_CN_MAP)}</Descriptions.Item>
                        <Descriptions.Item label="推荐训练方法">{bilingualList(taskDraft.candidate_methods, METHOD_CN_MAP)}</Descriptions.Item>
                        <Descriptions.Item label="推荐指标">{bilingualList(taskDraft.recommended_metrics, METRIC_CN_MAP)}</Descriptions.Item>
                      </Descriptions>
                    </Card>
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <Button
                        type="link"
                        size="small"
                        style={{ paddingRight: 0, color: 'rgba(0,0,0,0.45)' }}
                        onClick={() => setShowAdvancedTaskEditor((v) => !v)}
                      >
                        {showAdvancedTaskEditor ? '收起高级编辑' : '高级编辑（可选）'}
                      </Button>
                    </div>
                    {showAdvancedTaskEditor && (
                      <Card size="small" title="高级编辑区">
                        <Space direction="vertical" style={{ width: '100%' }}>
                          <div>
                            <Typography.Text strong>任务类型</Typography.Text>
                            <Select
                              style={{ width: '100%', marginTop: 6 }}
                              value={taskDraft.semantic_task_type}
                            disabled={isLocked}
                              onChange={(v) => setTaskDraft({ ...taskDraft, semantic_task_type: v })}
                              options={TASK_TYPE_OPTIONS.map((x) => ({ label: x, value: x }))}
                            />
                          </div>
                          <div>
                            <Typography.Text strong>领域</Typography.Text>
                            <Select
                              style={{ width: '100%', marginTop: 6 }}
                              value={taskDraft.domain}
                            disabled={isLocked}
                              onChange={(v) => setTaskDraft({ ...taskDraft, domain: v })}
                              options={DOMAIN_OPTIONS.map((x) => ({ label: x, value: x }))}
                            />
                          </div>
                          <div>
                            <Typography.Text strong>模态</Typography.Text>
                            <Select
                              style={{ width: '100%', marginTop: 6 }}
                              value={taskDraft.modality}
                            disabled={isLocked}
                              onChange={(v) => setTaskDraft({ ...taskDraft, modality: v })}
                              options={MODALITY_OPTIONS.map((x) => ({ label: x, value: x, disabled: x === 'image_text' }))}
                            />
                          </div>
                          <div>
                            <Typography.Text strong>方法建议（轻编辑）</Typography.Text>
                            <Select
                              mode="tags"
                              style={{ width: '100%', marginTop: 6 }}
                              value={taskDraft.candidate_methods}
                            disabled={isLocked}
                              onChange={(values) => setTaskDraft({ ...taskDraft, candidate_methods: values })}
                              options={taskDraft.candidate_methods.map((x) => ({ label: x, value: x }))}
                            />
                          </div>
                        </Space>
                      </Card>
                    )}
                    <Space>
                      <Button onClick={() => goStep(0)} disabled={isLocked}>返回</Button>
                      <Button type="primary" onClick={confirmTask} disabled={isLocked}>确认任务</Button>
                    </Space>
                  </Space>
                )}

                {step === 2 && (
                  <Space direction="vertical" style={{ width: '100%' }}>
                    <Card size="small" title="固定任务卡">
                      <Descriptions bordered column={1} size="small">
                        <Descriptions.Item label="当前任务">
                          {taskSpec ? `${taskSpec.domain} / ${taskSpec.semantic_task_type} / ${taskSpec.modality}` : '未确认'}
                        </Descriptions.Item>
                        <Descriptions.Item label="所需数据 schema">
                          {schemaHintByTask(taskSpec?.semantic_task_type)}
                        </Descriptions.Item>
                        <Descriptions.Item label="默认指标">
                          {taskSpec?.recommended_metrics?.join(', ') || '-'}
                        </Descriptions.Item>
                      </Descriptions>
                    </Card>

                    <Card size="small" title="数据来源方式">
                      <Space direction="vertical" style={{ width: '100%' }}>
                        <Select
                          value={datasetSourceMode}
                          disabled={isLocked}
                          onChange={setDatasetSourceMode}
                          options={[
                            { label: '上传符合 schema 的数据', value: 'upload' },
                            { label: '上传原始材料，由 Data Agent 转换', value: 'agent_convert' },
                            { label: '由 Data Agent 搜索公开数据集', value: 'agent_search' },
                          ]}
                        />
                        <Space>
                          <Button icon={<UploadOutlined />} onClick={() => setUploadOpen(true)} disabled={isLocked}>上传</Button>
                          <Button icon={<LinkOutlined />} onClick={() => setImportOpen(true)} disabled={isLocked}>URL 导入</Button>
                        </Space>
                        <Select
                          value={selectedDatasetId}
                          disabled={isLocked}
                          onChange={setSelectedDatasetId}
                          options={datasets.map((d) => ({ label: `${d.name} (ID:${d.id})`, value: d.id }))}
                          placeholder="选择已就绪数据集"
                        />
                        <Divider style={{ margin: '8px 0' }} />
                        <Typography.Text strong>模式A：标准模板填充（推荐）</Typography.Text>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          根据当前任务 schema 生成标准模板（CSV，可用 Excel 打开填写），填写后再上传可降低格式错误。
                        </Typography.Text>
                        <Button onClick={downloadTaskTemplate} disabled={isLocked}>下载任务模板（Excel 可打开）</Button>

                        <Divider style={{ margin: '8px 0' }} />
                        <Typography.Text strong>模式B：Agent 协助字段解析</Typography.Text>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          输入你原始数据的字段名，Agent 先给出字段映射建议，再执行导入/转换。
                        </Typography.Text>
                        <Input.TextArea
                          rows={2}
                          value={rawColumnsInput}
                          onChange={(e) => setRawColumnsInput(e.target.value)}
                          placeholder="例如：sentence, sentiment_label, source_id"
                          disabled={isLocked}
                        />
                        <Space>
                          <Button onClick={generateAgentColumnMap} disabled={isLocked}>Agent 解析字段映射</Button>
                          <Button onClick={() => setAgentColumnMap({})} disabled={isLocked}>清空映射</Button>
                        </Space>
                        {Object.keys(agentColumnMap).length > 0 && (
                          <Descriptions bordered size="small" column={1} title="字段映射建议（可用于导入）">
                            {Object.entries(agentColumnMap).map(([target, raw]) => (
                              <Descriptions.Item key={target} label={target}>
                                {raw}
                              </Descriptions.Item>
                            ))}
                          </Descriptions>
                        )}
                      </Space>
                    </Card>

                    <Card size="small" title="数据检查卡">
                      <Descriptions bordered column={1} size="small">
                        <Descriptions.Item label="字段检查">{datasetValidationReport?.field_check || '待检查'}</Descriptions.Item>
                        <Descriptions.Item label="schema 检查">{datasetValidationReport?.schema_check || '待检查'}</Descriptions.Item>
                        <Descriptions.Item label="样本数检查">{datasetValidationReport?.sample_count || '待检查'}</Descriptions.Item>
                        <Descriptions.Item label="标签分布检查">{datasetValidationReport?.label_distribution || '待检查'}</Descriptions.Item>
                      </Descriptions>
                    </Card>

                    <Card size="small" title="数据预览表">
                      <Table
                        size="small"
                        rowKey="id"
                        pagination={{ pageSize: 5 }}
                        dataSource={datasets}
                        columns={[
                          { title: 'ID', dataIndex: 'id', width: 72 },
                          { title: '名称', dataIndex: 'name' },
                          { title: '样本数', dataIndex: 'row_count', width: 100, render: (v: number | null) => v ?? '-' },
                          { title: '状态', dataIndex: 'status', width: 90 },
                        ]}
                      />
                    </Card>

                    <Space>
                      <Button onClick={() => {
                        if (taskSpec) setTaskDraft(taskSpec);
                        setState('task_parsed');
                        setStep(1);
                      }} disabled={isLocked}>返回</Button>
                      <Button type="primary" onClick={confirmData} disabled={isLocked}>检查并确认数据</Button>
                    </Space>
                  </Space>
                )}

                {step === 3 && (
                  <Space direction="vertical" style={{ width: '100%' }}>
                    <Alert type="warning" message="建议计划预览：确认前不会触发训练执行（provisional）" />
                    <Card size="small" title="计划预览卡（系统建议）">
                      <Descriptions bordered column={1} size="small">
                        <Descriptions.Item label="当前任务">
                          {taskSpec ? `${taskSpec.domain} / ${taskSpec.semantic_task_type} / ${taskSpec.modality}` : '-'}
                        </Descriptions.Item>
                        <Descriptions.Item label="数据集">
                          {selectedDataset ? `${selectedDataset.name} (ID:${selectedDataset.id})` : '-'}
                        </Descriptions.Item>
                        <Descriptions.Item label="推荐训练方法">
                          {planSpec.training_method || taskSpec?.candidate_methods?.[0] || '-'}
                        </Descriptions.Item>
                        <Descriptions.Item label="推荐基座模型">
                          {planSpec.base_model || DEFAULT_BASE_MODEL}
                        </Descriptions.Item>
                        <Descriptions.Item label="训练参数摘要">
                          {`epochs=${planSpec.epochs}, batch_size=${planSpec.batch_size}, learning_rate=${planSpec.learning_rate}`}
                        </Descriptions.Item>
                        <Descriptions.Item label="评估方式">
                          {planSpec.eval_strategy || 'per_epoch'}
                        </Descriptions.Item>
                      </Descriptions>
                    </Card>

                    <Card size="small" title="参数高级设置（可小幅调整）">
                      <Space direction="vertical" style={{ width: '100%' }}>
                        <Input
                          addonBefore="base model（基座模型）"
                          value={planSpec.base_model}
                          disabled={isLocked}
                          onChange={(e) => setPlanSpec({ ...planSpec, base_model: e.target.value })}
                        />
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          基座模型：训练前使用的原始模型底座，通常参数越大能力越强、资源消耗越高。
                        </Typography.Text>

                        <Input
                          addonBefore="method（训练方法）"
                          value={planSpec.training_method}
                          disabled={isLocked}
                          onChange={(e) => setPlanSpec({ ...planSpec, training_method: e.target.value })}
                        />
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          训练方法：如 LoRA / SFT，决定参数更新方式与训练成本。
                        </Typography.Text>

                        <InputNumber
                          addonBefore="epochs（训练轮数）"
                          value={planSpec.epochs}
                          disabled={isLocked}
                          onChange={(v) => setPlanSpec({ ...planSpec, epochs: Number(v || 1) })}
                        />
                        <InputNumber
                          addonBefore="batch size（批大小）"
                          value={planSpec.batch_size}
                          disabled={isLocked}
                          onChange={(v) => setPlanSpec({ ...planSpec, batch_size: Number(v || 1) })}
                        />
                        <InputNumber
                          addonBefore="learning rate（学习率）"
                          value={planSpec.learning_rate}
                          disabled={isLocked}
                          step={0.00001}
                          onChange={(v) => setPlanSpec({ ...planSpec, learning_rate: Number(v || 0.00002) })}
                        />
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          小白建议：先使用默认参数直接跑通；仅在效果不佳时再小幅调整（例如学习率减半、epochs +1）。
                        </Typography.Text>
                      </Space>
                    </Card>
                    <Space>
                      <Button onClick={() => void regeneratePlan()} disabled={isLocked}>重新生成计划</Button>
                      <Button onClick={() => {
                        setState('data_selecting');
                        setStep(2);
                      }} disabled={isLocked}>返回修改任务/数据</Button>
                      <Button type="primary" onClick={freezePlan} disabled={isLocked}>确认并冻结计划</Button>
                    </Space>
                  </Space>
                )}

                {step === 4 && (
                  <Space direction="vertical" style={{ width: '100%' }}>
                    <Alert type={state === 'done' ? 'success' : 'info'} message={state === 'done' ? '本次 Run 已完成' : '执行阶段：按当前 run 查看完整闭环'} />
                    <Card size="small" title="当前 Run 状态卡">
                      <Descriptions bordered column={1} size="small">
                        <Descriptions.Item label="run_id">{runSpec?.run_id || pipeline?.id || '-'}</Descriptions.Item>
                        <Descriptions.Item label="任务">{taskSpec ? `${taskSpec.domain} / ${taskSpec.semantic_task_type}` : '-'}</Descriptions.Item>
                        <Descriptions.Item label="数据">{selectedDataset?.name || '-'}</Descriptions.Item>
                        <Descriptions.Item label="方法">{planSpec.training_method || '-'}</Descriptions.Item>
                        <Descriptions.Item label="模型">{pipeline?.model_id || planSpec.base_model || '-'}</Descriptions.Item>
                        <Descriptions.Item label="当前阶段">{pipeline?.current_step || state}</Descriptions.Item>
                      </Descriptions>
                    </Card>

                    <Card size="small" title="Timeline（Run 全链路）">
                      <Timeline
                        items={[
                          { color: taskDraft ? 'green' : 'gray', children: '任务已解析（规划完成）' },
                          { color: state === 'data_ready' || !!pipeline ? 'green' : 'gray', children: '数据已就绪（校验通过）' },
                          { color: pipeline?.current_step === 'train' || state === 'done' ? 'blue' : 'gray', children: '训练已启动' },
                          { color: pipeline?.model_id ? 'blue' : 'gray', children: '模型检查点已保存' },
                          { color: state === 'done' ? 'green' : 'gray', children: '评估已完成' },
                        ]}
                      />
                    </Card>

                    <Card size="small" title="结果区">
                      <Typography.Text strong>metrics</Typography.Text>
                      <Descriptions bordered column={2} size="small" style={{ marginTop: 8, marginBottom: 12 }}>
                        <Descriptions.Item label="accuracy">{pipeline?.metrics?.accuracy ?? '-'}</Descriptions.Item>
                        <Descriptions.Item label="f1">{pipeline?.metrics?.f1 ?? '-'}</Descriptions.Item>
                        <Descriptions.Item label="loss">{pipeline?.metrics?.loss ?? '-'}</Descriptions.Item>
                        <Descriptions.Item label="status">{pipeline?.status || '-'}</Descriptions.Item>
                      </Descriptions>

                      <Typography.Text strong>产物下载</Typography.Text>
                      <div style={{ marginTop: 8 }}>
                        <Space wrap>
                          <Button disabled={!pipeline?.artifacts?.model_url} href={pipeline?.artifacts?.model_url} target="_blank">
                            下载模型产物
                          </Button>
                          <Button disabled={!pipeline?.artifacts?.metrics_url} href={pipeline?.artifacts?.metrics_url} target="_blank">
                            下载 metrics.json
                          </Button>
                          <Button disabled={!pipeline?.artifacts?.eval_report_url} href={pipeline?.artifacts?.eval_report_url} target="_blank">
                            下载 eval_report.json
                          </Button>
                        </Space>
                      </div>

                      <Divider style={{ margin: '12px 0' }} />
                      <Typography.Text strong>日志</Typography.Text>
                      <List
                        size="small"
                        style={{ marginTop: 8, maxHeight: 180, overflowY: 'auto', border: '1px solid #f0f0f0', borderRadius: 6, padding: 8 }}
                        dataSource={runLogs}
                        locale={{ emptyText: pipeline?.id ? '当前 run 暂无日志输出（可能后端尚未返回日志流）' : '尚未启动 run，暂无日志' }}
                        renderItem={(line) => <List.Item style={{ padding: '4px 0', border: 'none' }}>{line}</List.Item>}
                      />

                      <Divider style={{ margin: '12px 0' }} />
                      <Typography.Text strong>错误回放</Typography.Text>
                      <Alert
                        style={{ marginTop: 8 }}
                        type={pipeline?.error_message ? 'error' : 'info'}
                        message={pipeline?.error_message || '暂无错误'}
                        showIcon
                      />
                    </Card>
                    <Space>
                      <Button
                        type="primary"
                        icon={<PlayCircleOutlined />}
                        loading={loading}
                        disabled={state === 'training_queued' || state === 'training_running' || state === 'done'}
                        onClick={() => void startRun()}
                      >
                        启动执行
                      </Button>
                      <Button type="default"
                        icon={<SyncOutlined />}
                        onClick={() => {
                          if (!pipeline?.id) return;
                          void axios.get(`${API_BASE}/pipelines/${pipeline.id}`).then((res) => setPipeline(res.data)).catch(() => {});
                        }}
                      >
                        刷新状态
                      </Button>
                    </Space>
                    {state === 'training_succeeded' && (
                      <Button
                        type="primary"
                        onClick={() => {
                          setStep(5);
                          setState('evaluating');
                          setChatMessages((prev) => [
                            ...prev,
                            {
                              id: `msg_${Date.now()}`,
                              role: 'agent',
                              stage: 'eval_confirm',
                              content: '训练已成功，请确认评估策略后执行评估。',
                              timestamp: new Date().toLocaleTimeString('zh-CN'),
                            },
                          ]);
                        }}
                      >
                        进入评估确认
                      </Button>
                    )}
                  </Space>
                )}
                {step === 5 && (
                  <Space direction="vertical" style={{ width: '100%' }}>
                    <Card size="small" title="评估确认">
                      <Descriptions bordered column={1} size="small">
                        <Descriptions.Item label="评估策略">{planSpec.eval_strategy || 'per_epoch'}</Descriptions.Item>
                        <Descriptions.Item label="评估指标">{taskSpec?.recommended_metrics?.join(', ') || '-'}</Descriptions.Item>
                        <Descriptions.Item label="评估对象">{pipeline?.model_id || planSpec.base_model || '-'}</Descriptions.Item>
                      </Descriptions>
                      <Space style={{ marginTop: 12 }}>
                        <Button
                          type="primary"
                          onClick={() => {
                            setEvalConfirmed(true);
                            setState('done');
                            setChatMessages((prev) => [
                              ...prev,
                              {
                                id: `msg_${Date.now()}`,
                                role: 'agent',
                                stage: 'eval_result',
                                content: '评估流程已确认并完成（示例）。可在结果区下载报告与产物。',
                                timestamp: new Date().toLocaleTimeString('zh-CN'),
                              },
                            ]);
                          }}
                        >
                          确认评估并完成
                        </Button>
                        <Button onClick={() => setStep(4)}>返回训练阶段</Button>
                      </Space>
                    </Card>
                    <Card size="small" title="评估结果（Run 视图）">
                      <Descriptions bordered column={2} size="small">
                        <Descriptions.Item label="评估状态">{evalConfirmed ? '已完成' : '待确认'}</Descriptions.Item>
                        <Descriptions.Item label="run_id">{runSpec?.run_id || '-'}</Descriptions.Item>
                        <Descriptions.Item label="accuracy">{pipeline?.metrics?.accuracy ?? '-'}</Descriptions.Item>
                        <Descriptions.Item label="f1">{pipeline?.metrics?.f1 ?? '-'}</Descriptions.Item>
                      </Descriptions>
                    </Card>
                  </Space>
                )}
              </Card>
            </Col>

            <Col xs={24} lg={6}>
              <Card title="运行时间线" className="mcp-card compact-run-card">
                <Button type="link" style={{ paddingLeft: 0 }} onClick={() => setMcpDrawerOpen(true)}>
                  查看 MCP 信息窗口
                </Button>
                <div style={{ marginTop: 12 }}>
                  <Timeline
                    style={{ marginTop: 8 }}
                    items={[
                      { color: taskDraft ? 'green' : 'gray', children: '任务已解析（规划完成）' },
                      { color: state === 'data_ready' || !!pipeline ? 'green' : 'gray', children: '数据已就绪（校验通过）' },
                      { color: pipeline?.current_step === 'train' || state === 'done' ? 'blue' : 'gray', children: '训练已启动' },
                      { color: pipeline?.model_id ? 'blue' : 'gray', children: '模型检查点已保存' },
                      { color: state === 'done' ? 'green' : 'gray', children: '评估已完成' },
                    ]}
                  />
                  {state === 'done' && <Alert type="success" icon={<CheckCircleOutlined />} message="已完成" />}
                </div>
              </Card>
            </Col>
          </Row>
        </div>
      </div>
      <Drawer
        title="MCP 信息窗口（示例）"
        open={mcpDrawerOpen}
        onClose={() => setMcpDrawerOpen(false)}
        width={460}
      >
        <Tabs
          items={[
            {
              key: 'live',
              label: '当前事件',
              children: (
                <List
                  size="small"
                  dataSource={mcpEvents}
                  renderItem={(evt) => (
                    <List.Item>
                      <div>
                        <Typography.Text strong>{evt.server}.{evt.tool}</Typography.Text>
                        <Tag style={{ marginLeft: 8 }} color={evt.status === 'success' ? 'success' : evt.status === 'failed' ? 'error' : 'processing'}>
                          {evt.status}
                        </Tag>
                        <div style={{ marginTop: 4, fontSize: 12 }}>{evt.summary}</div>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>{evt.timestamp}</Typography.Text>
                      </div>
                    </List.Item>
                  )}
                />
              ),
            },
            {
              key: 'sample',
              label: '全流程示例',
              children: (
                <List
                  size="small"
                  dataSource={SAMPLE_MCP_EVENTS}
                  renderItem={(evt) => (
                    <List.Item>
                      <div>
                        <Typography.Text strong>{evt.server}.{evt.tool}</Typography.Text>
                        <div style={{ marginTop: 4, fontSize: 12 }}>{evt.summary}</div>
                      </div>
                    </List.Item>
                  )}
                />
              ),
            },
          ]}
        />
      </Drawer>

      <Modal title="上传训练数据" open={uploadOpen} onCancel={() => setUploadOpen(false)} onOk={() => uploadForm.submit()}>
        <Form
          form={uploadForm}
          layout="vertical"
          onFinish={async (values) => {
            if (!fileList.length) return message.warning('请选择文件');
            await datasetService.uploadDataset(fileList[0].originFileObj as File, values.name, values.type || 'text', 'training');
            setUploadOpen(false);
            setFileList([]);
            uploadForm.resetFields();
            await refreshReadyDatasets();
          }}
        >
          <Form.Item label="文件" required>
            <Upload beforeUpload={() => false} fileList={fileList} onChange={({ fileList: f }) => setFileList(f)} maxCount={1}>
              <Button icon={<UploadOutlined />}>选择文件</Button>
            </Upload>
          </Form.Item>
          <Form.Item name="name" label="名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="type" label="类型" initialValue="text">
            <Select options={[{ label: '文本', value: 'text' }]} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="从 URL 导入" open={importOpen} onCancel={() => setImportOpen(false)} onOk={() => importForm.submit()}>
        <Form
          form={importForm}
          layout="vertical"
          onFinish={async (values) => {
            await datasetService.importFromUrl({
              name: values.name,
              url: values.url,
              type: 'text',
              usage: 'training',
              column_map: Object.keys(agentColumnMap).length > 0 ? agentColumnMap : undefined,
            });
            setImportOpen(false);
            importForm.resetFields();
            setTimeout(() => void refreshReadyDatasets(), 1200);
          }}
        >
          <Form.Item name="name" label="名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="url" label="URL" rules={[{ required: true }, { type: 'url' }]}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default AgentCanvas;
