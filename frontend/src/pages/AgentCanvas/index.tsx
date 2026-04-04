import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Collapse,
  Descriptions,
  Divider,
  Drawer,
  Dropdown,
  Input,
  InputNumber,
  List,
  Modal,
  Radio,
  Select,
  Space,
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
import type { MenuProps } from 'antd';
import {
  CheckCircleOutlined,
  EyeOutlined,
  InboxOutlined,
  LinkOutlined,
  MoreOutlined,
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
import type { Dataset, DatasetSpec, PlanSpec, RunCurrentState, RunSpec, TaskSpec } from '@/types';
import {
  MOCK_TRAIN_EXECUTION_MCP_STREAM,
  SAMPLE_MCP_EVENTS,
  SAMPLE_SCENARIOS,
  mcpEventToTrainExecutionRow,
  type AgentChatMessage,
  type McpEvent,
} from './sampleData';

/** 编排中心多 Agent 角色（仅展示层，不改变状态机） */
type OrchAgentKey = 'orchestrator' | 'planning' | 'data' | 'training' | 'eval';

const ORCH_AGENTS: Record<OrchAgentKey, { label: string; tagColor: string }> = {
  orchestrator: { label: 'Orchestrator', tagColor: 'geekblue' },
  planning: { label: 'Planning Agent', tagColor: 'blue' },
  data: { label: 'Data Agent', tagColor: 'cyan' },
  training: { label: 'Training Executor', tagColor: 'orange' },
  eval: { label: 'Evaluation Agent', tagColor: 'purple' },
};

function OrchAgentTag({ agentKey }: { agentKey: OrchAgentKey }) {
  const a = ORCH_AGENTS[agentKey];
  return (
    <Tag color={a.tagColor} style={{ marginInlineEnd: 0, fontSize: 11, lineHeight: '18px' }}>
      {a.label}
    </Tag>
  );
}

function chatStageToAgentKey(stage: AgentChatMessage['stage']): OrchAgentKey {
  switch (stage) {
    case 'goal_input':
      return 'orchestrator';
    case 'task_confirm':
      return 'planning';
    case 'data_prepare':
      return 'data';
    case 'plan_prepare':
    case 'plan_confirm':
      return 'planning';
    case 'train_execute':
      return 'training';
    case 'eval_confirm':
    case 'eval_result':
      return 'eval';
    default:
      return 'orchestrator';
  }
}
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
  /** 编排状态摘要：草稿 / 规划中 / 数据准备中 / … */
  status?: string;
  /** 如「阶段 2/6 · 数据准备」 */
  currentStage?: string;
  /** ISO 8601，用于「N 分钟前」 */
  updatedAt?: string;
};

type FlowMode = 'full' | 'train_only' | 'eval_only';

const FLOW_MODE_OPTIONS: { key: FlowMode; label: string }[] = [
  { key: 'full', label: '全流程（训练+评估）' },
  { key: 'train_only', label: '仅训练' },
  { key: 'eval_only', label: '仅评估' },
];

const RUN_LIST_STAGE_LABELS = ['目标输入', '任务确认', '数据准备', '计划确认', '训练执行', '评估与结果'] as const;

const runListStageLine = (step: number): string => {
  const i = Math.min(Math.max(step, 0), 5);
  return `阶段 ${i + 1}/6 · ${RUN_LIST_STAGE_LABELS[i]}`;
};

const mapFlowStateToRunListStatus = (s: FlowState): string => {
  switch (s) {
    case 'draft':
      return '草稿';
    case 'intent_submitted':
    case 'task_parsed':
    case 'task_confirmed':
    case 'data_ready':
    case 'plan_generating':
    case 'plan_previewed':
    case 'plan_frozen':
      return '规划中';
    case 'data_selecting':
      return '待数据确认';
    case 'data_validating':
      return '数据准备中';
    case 'training_queued':
    case 'training_running':
    case 'training_succeeded':
      return '训练中';
    case 'evaluating':
      return '评测中';
    case 'done':
      return '已完成';
    default:
      return '规划中';
  }
};

const formatRunListRelativeTime = (iso?: string): string => {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const sec = Math.floor((Date.now() - t) / 1000);
  if (sec < 10) return '刚刚更新';
  if (sec < 60) return `${sec} 秒前`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时前`;
  return new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const runListAccentByStatus = (status?: string): string => {
  if (!status) return '#faad14';
  if (status === '已完成') return '#52c41a';
  if (status === '训练中' || status === '评测中') return '#1677ff';
  if (status === '已失败') return '#ff4d4f';
  if (status === '草稿') return '#8c8c8c';
  if (status === '数据准备中' || status === '待数据确认') return '#13c2c2';
  return '#faad14';
};

const DOMAIN_TAGS = ['通用', '金融', '医疗', '法律', '电商', '教育'];
/** 阶段 1 / 阶段 2 任务类型芯片：含分类、生成、提取等常用说法 */
const GOAL_TASK_CHIPS = ['分类', '生成', '提取', 'NER', '摘要', '匹配排序', '偏好对齐'];
const MODALITY_TAGS = ['文本', '图文'];

const GOAL_INTENT_SNIPPETS: { key: string; label: string; text: string }[] = [
  {
    key: 'fin_cls',
    label: '财报情感分类',
    text: '训练财报短文本情感分类模型，输出正面、中性、负面三类标签，用于研报与公告舆情辅助。',
  },
  {
    key: 'edu_cls',
    label: '教育知识点分类',
    text: '面向在线教育场景，将学员提问分类到预定义知识点标签，便于自动路由到对应讲义或助教。',
  },
  {
    key: 'legal_sum',
    label: '法律合同摘要',
    text: '训练法律领域摘要模型，输入合同或条款长文本，输出关键义务与风险点的简短摘要。',
  },
  {
    key: 'med_ner',
    label: '医学实体抽取',
    text: '训练医学文本命名实体识别，标注疾病、药物、剂量、检查项目等，输出 BIO 序列标签。',
  },
  {
    key: 'ecom_rerank',
    label: '商品检索排序',
    text: '训练查询-商品相关性排序模型，输入用户查询与候选商品描述，输出相关性分数或档位。',
  },
];
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

/** 本地模拟就绪数据集（不走后端列表） */
const MOCK_WORKSPACE_DATASET_ID = -9001;

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
  if (t.includes('生成')) return '生成';
  if (t.includes('提取') || t.includes('ner') || t.includes('实体')) return '提取';
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

const DOMAIN_EN_TO_CN: Record<string, string> = {
  general: '通用',
  finance: '金融',
  medical: '医疗',
  legal: '法律',
  ecommerce: '电商',
  education: '教育',
};

const DOMAIN_CN_TO_EN: Record<string, string> = {
  通用: 'general',
  金融: 'finance',
  医疗: 'medical',
  法律: 'legal',
  电商: 'ecommerce',
  教育: 'education',
};

const MODALITY_CN_TO_EN = (cn: string): 'text' | 'image_text' => (cn === '图文' ? 'image_text' : 'text');

const TASK_CN_TO_SEMANTIC: Record<string, string> = {
  分类: 'classification',
  NER: 'ner',
  摘要: 'summarization',
  生成: 'summarization',
  提取: 'ner',
  匹配排序: 'rerank',
  偏好对齐: 'preference_alignment',
};

const draftToTaxonomyCn = (draft: TaskDraft) => {
  const domainCn = DOMAIN_EN_TO_CN[draft.domain] || '通用';
  const typeCn = draft.modality === 'image_text' ? '图文' : '文本';
  let taskCn = '分类';
  const st = (draft.semantic_task_type || '').toLowerCase();
  if (st.includes('ner')) taskCn = 'NER';
  else if (st.includes('summar')) taskCn = '摘要';
  else if (st.includes('rerank')) taskCn = '匹配排序';
  else if (st.includes('preference')) taskCn = '偏好对齐';
  return { domainCn, typeCn, taskCn };
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
  if (['task_confirmed', 'data_selecting', 'data_validating'].includes(s)) return 2;
  if (['data_ready', 'plan_generating', 'plan_previewed'].includes(s)) return 3;
  if (['plan_frozen', 'training_queued', 'training_running', 'training_succeeded'].includes(s)) return 4;
  if (['evaluating', 'done'].includes(s)) return 5;
  return 0;
};

const AgentCanvas: React.FC = () => {
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [autoTagLoading, setAutoTagLoading] = useState(false);
  const [state, setState] = useState<FlowState>('draft');

  // 中间「编排对话」上下分栏：拖拽调整对话流与输入确认区高度
  const [chatSplitterTop, setChatSplitterTop] = useState(360);
  const chatSplitterRef = useRef<HTMLDivElement | null>(null);

  const [intentText, setIntentText] = useState('');
  const [uiSelectedTags, setUiSelectedTags] = useState<string[]>([]);
  const [modalityHint, setModalityHint] = useState('text');
  const [selectedDomainTag, setSelectedDomainTag] = useState<string>();
  const [customDomainTags, setCustomDomainTags] = useState<string[]>([]);

  const [taskDraft, setTaskDraft] = useState<TaskDraft | null>(null);
  const [taskSpec, setTaskSpec] = useState<TaskDraft | null>(null);
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
  // 默认从“空对话/空 MCP”开始，避免 sample 场景固定 respond 语句影响真实效果展示
  const [chatMessages, setChatMessages] = useState<AgentChatMessage[]>([]);
  const [mcpEvents, setMcpEvents] = useState<McpEvent[]>([]);
  const [mcpDrawerOpen, setMcpDrawerOpen] = useState(false);
  const [evalConfirmed, setEvalConfirmed] = useState(false);
  const [flowMode, setFlowMode] = useState<FlowMode | null>(null);
  const [flowModeConfirmed, setFlowModeConfirmed] = useState(false);
  const [selectedDomain, setSelectedDomain] = useState('');
  const [selectedTaskType, setSelectedTaskType] = useState('');
  const [selectedTaskName, setSelectedTaskName] = useState('');
  const [taxonomyConfirmed, setTaxonomyConfirmed] = useState(false);
  const [planTimelineOpen, setPlanTimelineOpen] = useState(false);
  const [splitStrategy, setSplitStrategy] = useState<'preset' | 'random'>('preset');
  const [chatSessions, setChatSessions] = useState<ChatSessionItem[]>([
    {
      id: 'scenario_finance_full',
      title: '金融 / 文本 / 分类',
      subtitle: '训练任务-规划中',
      status: '规划中',
      currentStage: runListStageLine(0),
      updatedAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
    },
    {
      id: 'scenario_med_train',
      title: '医疗 / 文本 / NER',
      subtitle: '训练任务-规划中',
      status: '训练中',
      currentStage: runListStageLine(4),
      updatedAt: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
    },
    {
      id: 'scenario_legal_eval',
      title: '法律 / 文本 / 摘要',
      subtitle: '评估任务-规划中',
      status: '评测中',
      currentStage: runListStageLine(5),
      updatedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    },
    {
      id: 'live_new',
      title: '新建 Run',
      subtitle: '训练任务-规划中',
      status: '草稿',
      currentStage: runListStageLine(0),
      updatedAt: new Date().toISOString(),
    },
  ]);
  const [activeSessionId, setActiveSessionId] = useState('live_new');
  const [runListRenameOpen, setRunListRenameOpen] = useState(false);
  const [runListRenameId, setRunListRenameId] = useState<string | null>(null);
  const [runListRenameTitle, setRunListRenameTitle] = useState('');

  const [dataWorkbenchMode, setDataWorkbenchMode] = useState<'summary' | 'edit'>('edit');
  const [workspaceUploadList, setWorkspaceUploadList] = useState<UploadFile[]>([]);
  const [localMockDataset, setLocalMockDataset] = useState<Dataset | null>(null);
  const [mockPreviewRows, setMockPreviewRows] = useState<Record<string, string>[]>([]);
  const [tvSplit, setTvSplit] = useState({ train: 80, valid: 10, test: 10 });
  const [importUrlName, setImportUrlName] = useState('');
  const [importUrlValue, setImportUrlValue] = useState('');
  const [realUploadDatasetName, setRealUploadDatasetName] = useState('');

  const selectedDataset = useMemo(() => {
    if (selectedDatasetId === MOCK_WORKSPACE_DATASET_ID && localMockDataset) {
      return localMockDataset;
    }
    return datasets.find((d) => d.id === selectedDatasetId);
  }, [datasets, selectedDatasetId, localMockDataset]);

  const readyDatasetCount = useMemo(() => datasets.filter((d) => d.status === 'ready').length, [datasets]);
  const activeSession = useMemo(
    () => chatSessions.find((s) => s.id === activeSessionId),
    [chatSessions, activeSessionId]
  );

  const handleRunListMenuClick = (item: ChatSessionItem): MenuProps['onClick'] => (info) => {
    info.domEvent.stopPropagation();
    const { key } = info;
    if (key === 'rename') {
      setRunListRenameId(item.id);
      setRunListRenameTitle(item.title);
      setRunListRenameOpen(true);
      return;
    }
    if (key === 'copy') {
      message.info('复制 Run：即将支持');
      return;
    }
    if (key === 'archive') {
      message.info('归档：即将支持');
      return;
    }
    if (key === 'delete') {
      Modal.confirm({
        title: '删除此 Run？',
        content: '删除后无法恢复，请确认后再操作。',
        okText: '删除',
        okType: 'danger',
        cancelText: '取消',
        onOk: () => {
          const filtered = chatSessions.filter((x) => x.id !== item.id);
          setChatSessions(filtered);
          if (activeSessionId === item.id && filtered.length > 0) {
            setActiveSessionId(filtered[0].id);
          }
        },
      });
    }
  };

  const stateColor = useMemo(() => {
    if (state === 'done') return 'success';
    if (state === 'training_running' || state === 'evaluating') return 'processing';
    if (state === 'plan_frozen' || state === 'training_queued') return 'warning';
    return 'default';
  }, [state]);

  const canEnterStep = (target: number, s: FlowState) => STEP_STATE_RULES[target]?.includes(s) ?? false;
  const currentFlowStep = useMemo(() => stepByState(state), [state]);
  const isLocked = readOnlyPreview;
  const isDataPrepPhase = state === 'data_selecting' || state === 'data_validating';
  /** 数据已确认之后：对话区不再展示「目标输入」大表单，只保留计划准备提示（由结构化 state 驱动） */
  const hideEarlyGoalInput =
    state === 'data_ready' || state === 'plan_generating' || state === 'plan_previewed';
  /** 右侧「训练计划工作台」：建议计划展示与确认（不含 data_ready 占位） */
  const isPlanWorkbenchPhase = state === 'plan_previewed' || state === 'plan_generating';
  /** 训练已启动后的编排状态（MCP/日志在右侧执行工作台展示，不混入主聊天） */
  const isTrainingExecutionActive = [
    'training_queued',
    'training_running',
    'training_succeeded',
    'evaluating',
    'done',
  ].includes(state);
  const isTrainingExecutionView = step === 4 && isTrainingExecutionActive;

  const trainExecutionMcpRows = useMemo(() => {
    const mapped = mcpEvents.map(mcpEventToTrainExecutionRow);
    if (!isTrainingExecutionView) return mapped;
    return [...MOCK_TRAIN_EXECUTION_MCP_STREAM, ...mapped];
  }, [mcpEvents, isTrainingExecutionView]);

  const primaryOrchAgent = useMemo((): OrchAgentKey => {
    if (['draft', 'intent_submitted', 'task_parsed', 'task_confirmed'].includes(state)) return 'planning';
    if (['data_selecting', 'data_validating'].includes(state)) return 'data';
    if (['data_ready', 'plan_generating', 'plan_previewed'].includes(state)) return 'planning';
    if (state === 'plan_frozen') return 'orchestrator';
    if (['training_queued', 'training_running', 'training_succeeded'].includes(state)) return 'training';
    if (state === 'evaluating' || state === 'done') return 'eval';
    return 'orchestrator';
  }, [state]);

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

  const onChatSplitterMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const container = chatSplitterRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const containerHeight = rect.height;
    const startY = e.clientY;
    const startTop = chatSplitterTop;

    const minTop = 220;
    const minBottom = 220;
    const maxTop = Math.max(minTop, containerHeight - minBottom);

    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientY - startY;
      const next = Math.max(minTop, Math.min(maxTop, startTop + delta));
      setChatSplitterTop(next);
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const appendSingleTagToIntent = (
    tag: string,
    groupTags: string[],
    setSelected?: React.Dispatch<React.SetStateAction<string | undefined>>
  ) => {
    setSelected?.(tag);
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

  const appendGoalSnippet = (text: string) => {
    setIntentText((prev) => {
      const t = prev.trim();
      return t ? `${t} ${text}` : text;
    });
  };

  const allDomainTags = useMemo(() => [...DOMAIN_TAGS, ...customDomainTags], [customDomainTags]);

  /** 根据当前描述 / 解析结果对模板做简单排序，优先展示更相关的推荐 */
  const recommendedGoalSnippets = useMemo(() => {
    const t = `${intentText} ${selectedDomainTag || ''} ${uiSelectedTags.join(' ')}`;
    const rank = (s: (typeof GOAL_INTENT_SNIPPETS)[number]) => {
      let score = 0;
      if (/金融|财报|情感/.test(t) && s.key === 'fin_cls') score += 5;
      if (/教育|知识点/.test(t) && s.key === 'edu_cls') score += 5;
      if (/法律|合同/.test(t) && s.key === 'legal_sum') score += 5;
      if (/医学|医疗|实体|NER/.test(t) && s.key === 'med_ner') score += 5;
      if (/商品|检索|排序|电商/.test(t) && s.key === 'ecom_rerank') score += 5;
      if (taskDraft?.domain === 'finance' && s.key === 'fin_cls') score += 3;
      if (taskDraft?.domain === 'education' && s.key === 'edu_cls') score += 3;
      if (taskDraft?.domain === 'legal' && s.key === 'legal_sum') score += 3;
      if (taskDraft?.domain === 'medical' && s.key === 'med_ner') score += 3;
      if (taskDraft?.domain === 'ecommerce' && s.key === 'ecom_rerank') score += 3;
      return score;
    };
    return [...GOAL_INTENT_SNIPPETS].sort((a, b) => rank(b) - rank(a));
  }, [intentText, selectedDomainTag, uiSelectedTags, taskDraft]);

  const [goalManualOpen, setGoalManualOpen] = useState(false);

  const goalParseChipRows = (
    <>
      <div className="agent-goal-parse-row">
        <Typography.Text className="agent-goal-parse-label">应用领域</Typography.Text>
        <Space wrap className="agent-goal-parse-chips">
          {allDomainTags.map((x) => (
            <Button
              key={x}
              size="small"
              type={selectedDomainTag === x ? 'primary' : 'default'}
              onClick={() => appendSingleTagToIntent(x, allDomainTags, setSelectedDomainTag)}
            >
              {x}
            </Button>
          ))}
        </Space>
      </div>
      <div className="agent-goal-parse-row">
        <Typography.Text className="agent-goal-parse-label">你想让模型完成什么任务</Typography.Text>
        <Space wrap className="agent-goal-parse-chips">
          {GOAL_TASK_CHIPS.map((x) => (
            <Button
              key={x}
              size="small"
              type={uiSelectedTags.includes(x) ? 'primary' : 'default'}
              onClick={() => appendSingleTagToIntent(x, GOAL_TASK_CHIPS)}
            >
              {x}
            </Button>
          ))}
        </Space>
      </div>
      <div className="agent-goal-parse-row">
        <Typography.Text className="agent-goal-parse-label">输入数据形式</Typography.Text>
        <Space wrap className="agent-goal-parse-chips">
          {MODALITY_TAGS.map((x) => (
            <Button
              key={x}
              size="small"
              type={uiSelectedTags.includes(x) ? 'primary' : 'default'}
              disabled={x === '图文'}
              onClick={() => x !== '图文' && appendSingleTagToIntent(x, MODALITY_TAGS)}
            >
              {x}
              {x === '图文' ? '（未开放）' : ''}
            </Button>
          ))}
        </Space>
      </div>
    </>
  );

  const clearSelectedPromptOptions = () => {
    setSelectedDomainTag(undefined);
    setUiSelectedTags([]);
    setIntentText('');
    setTaskDraft(null);
    setTaskSpec(null);
    setRunSpec(null);
    setPipeline(null);
    setDatasetValidationReport(null);
    setSelectedDatasetId(undefined);
    setState('draft');
    setStep(0);
    setReadOnlyPreview(false);
    setModalityHint('text');
    setFlowMode(null);
    setFlowModeConfirmed(false);
    setTaxonomyConfirmed(false);
    setSelectedDomain('');
    setSelectedTaskType('');
    setSelectedTaskName('');
    setDataWorkbenchMode('edit');
    setWorkspaceUploadList([]);
    setLocalMockDataset(null);
    setMockPreviewRows([]);
    setTvSplit({ train: 80, valid: 10, test: 10 });
    setImportUrlName('');
    setImportUrlValue('');
    setRealUploadDatasetName('');
    setGoalManualOpen(false);
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

  const applyMockWorkspaceValidation = () => {
    if (!taskSpec) {
      message.warning('无任务定义');
      return;
    }
    const headers = schemaHeadersByTask(taskSpec.semantic_task_type);
    const n = headers.length;
    const map: Record<string, string> = {};
    headers.forEach((h) => {
      map[h] = h;
    });
    setAgentColumnMap(map);
    const name = workspaceUploadList[0]?.name?.replace(/（URL）$/, '') || 'mock_staging_dataset';
    const now = new Date().toISOString();
    const mockDs: Dataset = {
      id: MOCK_WORKSPACE_DATASET_ID,
      user_id: 0,
      name,
      type: 'text',
      usage: 'training',
      source: 'mock_workspace',
      original_file_path: null,
      cleaned_file_path: '/mock/normalized.csv',
      row_count: 1200,
      column_count: n,
      file_size: 256000,
      status: 'ready',
      created_at: now,
      updated_at: now,
    };
    setLocalMockDataset(mockDs);
    setSelectedDatasetId(MOCK_WORKSPACE_DATASET_ID);
    setDatasetValidationReport({
      schema_check: 'passed（mock）',
      field_check: `passed（${n} 列对齐 schema）`,
      sample_count: '1200',
      label_distribution: 'balanced（mock）',
    });
    const samples = [0, 1, 2].map((i) =>
      Object.fromEntries(headers.map((h) => [h, `${h}_mock_${i + 1}`]))
    );
    setMockPreviewRows(samples);
    message.success('已应用模拟字段检测与 schema 校验');
  };

  const mockAgentSearchStaging = () => {
    const uid = `search_${Date.now()}`;
    setWorkspaceUploadList((prev) => [
      ...prev,
      {
        uid,
        name: 'mock_public_dataset.csv（检索）',
        status: 'done',
        url: 'https://example.com/datasets/mock_public_dataset.csv',
      },
    ]);
    message.success('（mock）已添加模拟公开数据集引用');
  };

  const addUrlToWorkspaceStaging = () => {
    const name = importUrlName.trim();
    const url = importUrlValue.trim();
    if (!name || !url) {
      message.warning('请填写名称与 URL');
      return;
    }
    try {
      // eslint-disable-next-line no-new
      new URL(url);
    } catch {
      message.warning('URL 格式不正确');
      return;
    }
    const uid = `url_${Date.now()}`;
    setWorkspaceUploadList((prev) => [
      ...prev,
      { uid, name: `${name}（URL）`, status: 'done', url },
    ]);
    setImportUrlName('');
    setImportUrlValue('');
    message.success('已加入待处理文件列表');
  };

  const submitRealDatasetUpload = async () => {
    const first = workspaceUploadList[0];
    const f = first?.originFileObj;
    if (!f || !(f instanceof File)) {
      message.warning('请先在上方拖拽或选择本地文件');
      return;
    }
    const nm = realUploadDatasetName.trim() || first.name || 'dataset';
    setLoading(true);
    try {
      await datasetService.uploadDataset(f, nm, 'text', 'training');
      message.success('已上传到服务器');
      setWorkspaceUploadList([]);
      setRealUploadDatasetName('');
      setLocalMockDataset(null);
      setMockPreviewRows([]);
      setSelectedDatasetId(undefined);
      await refreshReadyDatasets();
    } catch (e: any) {
      message.error(e?.message || '上传失败');
    } finally {
      setLoading(false);
    }
  };

  const updateAgentColumnMapField = (target: string, raw: string) => {
    setAgentColumnMap((prev) => ({ ...prev, [target]: raw }));
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
        const orchState = `${next?.orchestration_state || ''}`.toUpperCase();

        if (next.status === 'completed') {
          setState('done');
          setStep(stepByState('done'));
          return;
        }
        if (next.status === 'failed') {
          setState('plan_frozen');
          setStep(stepByState('plan_frozen'));
          return;
        }

        // 优先使用后端回填的 orchestration_state，以确保顺序展示：Plan -> Data -> Training -> Evaluation
        switch (orchState) {
          case 'DATA_VALIDATED':
            setState('data_ready');
            setStep(stepByState('data_ready'));
            return;
          case 'TRAINING_RUNNING':
            setState('training_running');
            setStep(stepByState('training_running'));
            return;
          case 'TRAINING_FINISHED':
            setState('training_succeeded');
            setStep(stepByState('training_succeeded'));
            return;
          case 'EVALUATING':
            setState('evaluating');
            setStep(stepByState('evaluating'));
            return;
          case 'COMPLETED':
            setState('done');
            setStep(stepByState('done'));
            return;
          default:
            break;
        }

        // fallback：老字段 current_step / status 映射（当 orchestration_state 为空时）
        if (next.current_step === 'clean_data') {
          setState('data_validating');
          setStep(stepByState('data_validating'));
          return;
        }
        if (next.current_step === 'train') {
          // 训练未开始之前 job_id 可能还未就绪，这里先显示 training_running
          setState('training_running');
          setStep(stepByState('training_running'));
          return;
        }
        if (next.current_step === 'evaluate') {
          setState('evaluating');
          setStep(stepByState('evaluating'));
          return;
        }
      } catch {
        // ignore poll errors
      }
    }, 2500);
    return () => clearInterval(timer);
  }, [pipeline]);

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
      setState('task_parsed');
      setTaxonomyConfirmed(false);
      setStep(0);
      const cn = draftToTaxonomyCn(draft);
      setSelectedDomain(cn.domainCn);
      setSelectedTaskType(cn.typeCn);
      setSelectedTaskName(cn.taskCn);
      setChatMessages((prev) => [
        ...prev,
        {
          id: `msg_${Date.now()}`,
          role: 'agent',
          stage: 'task_confirm',
          content: `Planner 初判：领域「${bilingual(draft.domain, DOMAIN_CN_MAP)}」、模态「${bilingual(draft.modality, MODALITY_CN_MAP)}」、任务「${bilingual(draft.semantic_task_type, TASK_CN_MAP)}」。请在下方用芯片调整并「确认流程」，确认后再点击「确认任务」。`,
          timestamp: new Date().toLocaleTimeString('zh-CN'),
        },
      ]);
      message.success('已解析目标（草稿）');
    } catch (e: any) {
      setState('draft');
      const errMsg = e?.message || '解析失败';
      message.error(errMsg);
      setChatMessages((prev) => [
        ...prev,
        {
          id: `msg_${Date.now()}`,
          role: 'agent',
          stage: 'goal_input',
          content: `解析未成功：${errMsg}。请检查描述是否完整，或稍后重试。`,
          timestamp: new Date().toLocaleTimeString('zh-CN'),
        },
      ]);
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
      appendSingleTagToIntent(taskTag, GOAL_TASK_CHIPS);

      const modalityTag = text.includes('图像') || text.includes('图片') || text.includes('多模态') ? '图文' : '文本';
      if (modalityTag === '文本') {
        appendSingleTagToIntent('文本', MODALITY_TAGS);
      } else {
        // 图文未开放，兜底仍选文本
        appendSingleTagToIntent('文本', MODALITY_TAGS);
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
    setState('task_confirmed');
    setStep(2);
    setChatMessages((prev) => [
      ...prev,
      {
        id: `msg_${Date.now()}`,
        role: 'user',
        stage: 'task_confirm',
        content: '确认任务定义。',
        timestamp: new Date().toLocaleTimeString('zh-CN'),
      },
      {
        id: `msg_${Date.now() + 1}`,
        role: 'agent',
        stage: 'task_confirm',
        content:
          '任务已确认。请在右侧工作台点击「进入数据准备」，完成上传、字段映射与 schema 校验。',
        timestamp: new Date().toLocaleTimeString('zh-CN'),
      },
    ]);
  };

  const enterDataPreparation = () => {
    if (state !== 'task_confirmed' || !taskSpec) {
      message.warning('请先确认任务');
      return;
    }
    setDataWorkbenchMode('edit');
    setWorkspaceUploadList([]);
    setLocalMockDataset(null);
    setMockPreviewRows([]);
    setDatasetValidationReport(null);
    setSelectedDatasetId(undefined);
    setAgentColumnMap({});
    setTvSplit({ train: 80, valid: 10, test: 10 });
    setState('data_selecting');
    setChatMessages((prev) => [
      ...prev,
      {
        id: `msg_${Date.now()}`,
        role: 'agent',
        stage: 'data_prepare',
        content: `已进入数据准备阶段。所需 schema：${schemaHintByTask(taskSpec.semantic_task_type)}。请使用右侧「数据工作台」完成上传、映射与校验；中间栏仅作说明，无需在此操作数据。`,
        timestamp: new Date().toLocaleTimeString('zh-CN'),
      },
    ]);
  };

  const confirmData = () => {
    if (!['data_selecting', 'data_validating'].includes(state)) {
      return message.warning('请先进入数据准备阶段');
    }
    if (!taskSpec) return message.warning('没有 task_confirmed，不能进入数据确认');
    if (!selectedDatasetId) return message.warning('请先选择数据集');
    const tvtSum = tvSplit.train + tvSplit.valid + tvSplit.test;
    if (tvtSum !== 100) {
      return message.warning('Train / Valid / Test 比例之和须为 100');
    }

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

    const now = new Date().toISOString();
    const splitStr = `${splitStrategy};tvt=${tvSplit.train}:${tvSplit.valid}:${tvSplit.test}`;
    const validationRecord: Record<string, string> = {
      schema_check: 'passed',
      field_check: `passed（${actualColumns} 列）`,
      sample_count: `${selectedDataset.row_count}`,
      label_distribution: 'ok',
      confirmed_at: now,
      dataset_id: String(selectedDataset.id),
      split_tvt: `${tvSplit.train}:${tvSplit.valid}:${tvSplit.test}`,
      split_strategy: splitStr,
      dataset_source_mode: datasetSourceMode,
      column_map_json:
        Object.keys(agentColumnMap).length > 0 ? JSON.stringify(agentColumnMap) : '{}',
    };
    setDatasetValidationReport(validationRecord);

    const nextDatasetSpec: DatasetSpec = {
      dataset_source_mode: datasetSourceMode,
      dataset_id: String(selectedDataset.id),
      raw_file_path: selectedDataset.original_file_path || undefined,
      normalized_dataset_path: selectedDataset.cleaned_file_path || undefined,
      schema_valid: true,
      split_strategy: splitStr,
      train_path: selectedDataset.cleaned_file_path || undefined,
      sample_count: selectedDataset.row_count ?? undefined,
    };

    const method =
      planSpec.training_method.trim() || taskSpec.candidate_methods?.[0] || 'lora';
    if (!planSpec.training_method.trim()) {
      setPlanSpec((prev) => ({ ...prev, training_method: method }));
    }
    const planForRun: PlanSpec = {
      base_model: planSpec.base_model,
      training_method: method,
      trainer_backend: planSpec.trainer_backend,
      learning_rate: planSpec.learning_rate,
      batch_size: planSpec.batch_size,
      epochs: planSpec.epochs,
      max_seq_length: planSpec.max_seq_length,
      eval_strategy: planSpec.eval_strategy,
      expected_outputs: planSpec.expected_outputs,
    };

    const taskForRun = taskSpec as unknown as TaskSpec;
    setRunSpec((prev) => {
      const rid = prev?.run_id ?? `run_${Date.now()}`;
      return {
        run_id: rid,
        task_spec: taskForRun,
        dataset_spec: nextDatasetSpec,
        dataset_validation_report: validationRecord,
        plan_spec: planForRun,
        current_state: 'data_ready',
        created_at: prev?.created_at ?? now,
        updated_at: now,
        owner: prev?.owner ?? 'default_user',
        intent_draft:
          prev?.intent_draft ?? {
            intent_text: intentText,
            ui_selected_tags: uiSelectedTags,
            modality_hint: modalityHint,
          },
        run_trace: prev?.run_trace,
      };
    });

    const sourceCn =
      datasetSourceMode === 'upload'
        ? '上传符合 schema'
        : datasetSourceMode === 'agent_convert'
          ? '原始材料由 Data Agent 转换'
          : 'Data Agent 检索公开数据';
    const agentSummary = [
      `结构化状态已更新为 data_ready（run 内 dataset_spec / dataset_validation_report 已写入）。`,
      `数据集：${selectedDataset.name}（id=${selectedDataset.id}），样本 ${selectedDataset.row_count}，列 ${actualColumns}。`,
      `切分：train/valid/test=${tvSplit.train}:${tvSplit.valid}:${tvSplit.test}，策略 ${splitStrategy}。`,
      `校验：schema=${validationRecord.schema_check}；字段=${validationRecord.field_check}。`,
      `数据来源：${sourceCn}。`,
      `下一步：请在右侧「阶段工作台」第 3 步查看/生成训练计划，无需再发消息。`,
    ].join('\n');

    setState('data_ready');
    setStep(3);
    setChatMessages((prev) => [
      ...prev,
      {
        id: `msg_${Date.now()}`,
        role: 'agent',
        stage: 'plan_prepare',
        content: agentSummary,
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
      message.success('已生成建议计划，请在右侧工作台核对');
    } catch {
      setState('data_ready');
    }
  };

  const freezePlan = () => {
    if (state !== 'plan_previewed') {
      return message.warning('请先在右侧生成并查看「建议计划」后再确认');
    }
    if (!taskSpec) return message.warning('任务未确认');
    if (!selectedDatasetId) return message.warning('数据未确认');
    if (!planSpec.training_method.trim()) return message.warning('请填写训练方法');

    const now = new Date().toISOString();
    const nextRunSpec: RunSpec = {
      run_id: runSpec?.run_id ?? `run_${Date.now()}`,
      task_spec: taskSpec as unknown as TaskSpec,
      dataset_spec: {
        dataset_source_mode: datasetSourceMode,
        dataset_id: selectedDataset ? String(selectedDataset.id) : undefined,
        raw_file_path: selectedDataset?.original_file_path || undefined,
        normalized_dataset_path: selectedDataset?.cleaned_file_path || undefined,
        schema_valid: true,
        split_strategy: `${splitStrategy};tvt=${tvSplit.train}:${tvSplit.valid}:${tvSplit.test}`,
        train_path: selectedDataset?.cleaned_file_path || undefined,
        sample_count: selectedDataset?.row_count || undefined,
      },
      dataset_validation_report: runSpec?.dataset_validation_report,
      plan_spec: planSpec as PlanSpec,
      current_state: 'plan_frozen',
      created_at: runSpec?.created_at ?? now,
      updated_at: now,
      owner: runSpec?.owner ?? 'default_user',
      intent_draft: runSpec?.intent_draft ?? {
        intent_text: intentText,
        ui_selected_tags: uiSelectedTags,
        modality_hint: modalityHint,
      },
      run_trace: runSpec?.run_trace,
    };

    setRunSpec(nextRunSpec);
    setState('plan_frozen');
    setStep(4);
    setChatMessages((prev) => [
      ...prev,
      {
        id: `msg_${Date.now()}`,
        role: 'agent',
        stage: 'plan_confirm',
        content:
          '计划已确认并锁定（plan_frozen），参数已写入 run_spec。当前阶段为「已确认计划」；后续执行需在工作台「训练执行」步骤单独发起，并非自动开始。',
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

      // MCP 流程内会先跑 Data Agent（clean_data），再进入 Training/Evaluation
      setState('data_validating');
      const res = await axios.post(`${API_BASE}/pipelines`, payload);
      setPipeline(res.data);
      // 后续状态由轮询 pipeline.orchestration_state 驱动
      setState('data_validating');
      message.success('流程已启动：开始 Data Agent 数据清洗');
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

  useEffect(() => {
    setChatSessions((prev) =>
      prev.map((it) =>
        it.id === activeSessionId
          ? {
              ...it,
              subtitle: statusSubtitleByState(state),
              progress: state === 'training_running' ? 60 : state === 'evaluating' ? 90 : state === 'done' ? 100 : it.progress,
              status: mapFlowStateToRunListStatus(state),
              currentStage: runListStageLine(step),
              updatedAt: new Date().toISOString(),
            }
          : it
      )
    );
  }, [state, step, activeSessionId]);

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
  }, [activeSessionId]);

  const sendChat = async () => {
    const text = intentText.trim();
    if (!text) return message.warning('请先输入训练目标描述');
    if (!flowModeConfirmed) {
      message.warning('请先在对话区上方确认任务范围（全流程 / 仅训练 / 仅评估）');
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
    if (flowModeConfirmed && ['draft', 'intent_submitted', 'task_parsed'].includes(state)) {
      await parseIntent();
    } else {
      setIntentText('');
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
    setChatMessages((prev) => [
      ...prev,
      {
        id: `msg_${Date.now()}`,
        role: 'user',
        stage: 'goal_input',
        content: `确认任务范围：${flowModeLabel(flowMode)}。`,
        timestamp: new Date().toLocaleTimeString('zh-CN'),
      },
      {
        id: `msg_${Date.now() + 1}`,
        role: 'agent',
        stage: 'goal_input',
        content: '范围已记录。请在下方输入训练/评估目标与约束，并点击「发送并解析」。',
        timestamp: new Date().toLocaleTimeString('zh-CN'),
      },
    ]);
  };

  const confirmTaxonomy = () => {
    if (!selectedDomain || !selectedTaskType || !selectedTaskName) {
      message.warning('请选择领域、模态与任务类型');
      return;
    }
    if (!taskDraft) {
      message.warning('请先完成阶段 1：输入目标并发送解析');
      return;
    }
    const enDomain = DOMAIN_CN_TO_EN[selectedDomain] || 'general';
    const modality = MODALITY_CN_TO_EN(selectedTaskType);
    const semanticType = TASK_CN_TO_SEMANTIC[selectedTaskName] || 'classification';
    const next: TaskDraft = {
      ...taskDraft,
      domain: enDomain,
      modality,
      semantic_task_type: semanticType,
      output_structure: semanticType === 'ner' ? 'sequence_tags' : taskDraft.output_structure,
      recommended_metrics: semanticType === 'ner' ? ['entity_f1', 'token_f1'] : taskDraft.recommended_metrics,
      task_schema_id: semanticType === 'ner' ? 'ner_bio_v1' : 'text_cls_v1',
    };
    setTaskDraft(next);
    setTaxonomyConfirmed(true);
    setStep(1);
    setModalityHint(modality === 'image_text' ? 'image_text' : 'text');
    setChatMessages((prev) => [
      ...prev,
      {
        id: `msg_${Date.now()}`,
        role: 'user',
        stage: 'task_confirm',
        content: `确认流程：${selectedDomain} · ${selectedTaskType} · ${selectedTaskName}`,
        timestamp: new Date().toLocaleTimeString('zh-CN'),
      },
      {
        id: `msg_${Date.now() + 1}`,
        role: 'agent',
        stage: 'task_confirm',
        content: '流程已对齐。请核对下方任务摘要，确认无误后点击「确认任务」。',
        timestamp: new Date().toLocaleTimeString('zh-CN'),
      },
    ]);
    message.success('流程已确认');
  };



  return (
    <div className="agent-canvas" data-theme="light">
      <div className="canvas-main canvas-main--orchestration">
        <div className="agent-orch-toolbar">
          <div className="agent-orch-toolbar-left">
            <Space align="center" size={12}>
              <RobotOutlined style={{ fontSize: 22, color: '#1677ff' }} />
              <div>
                <Typography.Title level={4} style={{ margin: 0 }}>
                  多 Agent 训练编排中心
                </Typography.Title>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  状态
                  <Tag color={stateColor} style={{ marginLeft: 6 }}>{state}</Tag>
                  <span style={{ margin: '0 6px' }}>·</span>
                  主责
                  <span style={{ marginLeft: 6 }}>
                    <OrchAgentTag agentKey={primaryOrchAgent} />
                  </span>
                  <span style={{ margin: '0 6px' }}>·</span>
                  就绪数据集 {readyDatasetCount}
                  <span style={{ margin: '0 6px' }}>·</span>
                  Run {runSpec?.run_id || '-'}
                </Typography.Text>
              </div>
            </Space>
          </div>
          <Space wrap className="agent-orch-toolbar-right">
            <Button type="text" icon={<EyeOutlined />} onClick={() => setPlanTimelineOpen(true)} />
            <Button onClick={() => setMcpDrawerOpen(true)}>MCP 侧信道</Button>
            <Button
              className="canvas-back-to-classic-btn"
              onClick={() => {
                localStorage.setItem('app-version', 'classic');
                window.location.href = '/';
              }}
            >
              返回经典版工作台
            </Button>
          </Space>
        </div>

        <div className="agent-orch-grid">
          <div className="agent-orch-col agent-orch-col-left">
            <Card
              size="small"
              className="agent-orch-session-card"
              title={(
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>会话 / Run</span>
                  <Button
                    type="text"
                    size="small"
                    icon={<PlusOutlined />}
                    onClick={() => {
                      const id = `s_${Date.now()}`;
                      setChatSessions((prev) => [
                        {
                          id,
                          title: '新建 Run',
                          subtitle: '训练任务-规划中',
                          status: '草稿',
                          currentStage: runListStageLine(0),
                          updatedAt: new Date().toISOString(),
                        },
                        ...prev,
                      ]);
                      setActiveSessionId(id);
                      clearSelectedPromptOptions();
                      setChatMessages([
                        {
                          id: `msg_${Date.now()}`,
                          role: 'agent',
                          stage: 'goal_input',
                          content:
                            '你好，我是 Orchestrator（编排中心），会协调 Planning Agent、Data Agent、Training Executor、Evaluation Agent 完成本 Run。请先在下方确认「全流程 / 仅训练 / 仅评估」，再输入训练目标并发送解析。',
                          timestamp: new Date().toLocaleTimeString('zh-CN'),
                        },
                      ]);
                      setMcpEvents([]);
                    }}
                  />
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
                      <div
                        className="agent-proto-session-accent"
                        style={{ background: runListAccentByStatus(item.status) }}
                      />
                      <div style={{ fontWeight: 600, paddingRight: 30, lineHeight: 1.45, marginBottom: 4 }}>{item.title}</div>
                      <Dropdown
                        menu={{
                          items: [
                            { key: 'rename', label: '重命名' },
                            { key: 'copy', label: '复制' },
                            { key: 'archive', label: '归档' },
                            { key: 'delete', label: '删除', danger: true },
                          ],
                          onClick: handleRunListMenuClick(item),
                        }}
                        trigger={['click']}
                        placement="bottomRight"
                      >
                        <Button
                          type="text"
                          size="small"
                          icon={<MoreOutlined />}
                          className="agent-proto-session-more"
                          aria-label="更多操作"
                          onClick={(e) => e.stopPropagation()}
                        />
                      </Dropdown>
                      <div
                        className="agent-run-list-item-meta"
                        style={{
                          fontSize: 11,
                          color: 'rgba(0, 0, 0, 0.45)',
                          lineHeight: 1.45,
                          paddingRight: 28,
                        }}
                      >
                        {item.status ?? '—'} · {item.currentStage ?? '—'} · {formatRunListRelativeTime(item.updatedAt)}
                      </div>
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
          </div>

          <div className="agent-orch-col agent-orch-col-chat">
            <Card
              size="small"
              className="agent-orch-chat-card"
              title={(
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Space align="center" size={8}>
                    <span style={{ fontWeight: 600 }}>编排对话</span>
                    <OrchAgentTag agentKey={primaryOrchAgent} />
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                      主责随阶段切换
                    </Typography.Text>
                  </Space>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }} ellipsis>
                    {activeSession?.title}
                  </Typography.Text>
                </div>
              )}
            >
              <div className="agent-orch-chat-splitter" ref={chatSplitterRef}>
                  <div className="agent-proto-chat-stream agent-orch-chat-stream" style={{ height: chatSplitterTop }}>
                    <List
                      dataSource={chatMessages}
                      renderItem={(m) => (
                        <List.Item
                          className={`agent-proto-chat-row ${m.role === 'user' ? 'agent-proto-chat-row-user' : 'agent-proto-chat-row-agent'}`}
                        >
                          <div
                            className={['agent-proto-bubble', m.role === 'agent' ? 'agent-proto-bubble-agent' : 'agent-proto-bubble-user'].join(
                              ' '
                            )}
                          >
                            <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 4 }}>
                              {m.role === 'agent' ? (
                                <Space size={6} align="center" wrap>
                                  <span>来自</span>
                                  <OrchAgentTag agentKey={chatStageToAgentKey(m.stage)} />
                                  <span>· {m.timestamp}</span>
                                </Space>
                              ) : m.role === 'user' ? (
                                <>你 · {m.timestamp}</>
                              ) : (
                                <>系统 · {m.timestamp}</>
                              )}
                            </div>
                            <div>{m.content}</div>
                          </div>
                        </List.Item>
                      )}
                    />
                  </div>
                <div className="agent-orch-chat-splitter-gutter" onMouseDown={onChatSplitterMouseDown} />
                {!isLocked ? (
                  <div className="agent-orch-chat-phase-stack">
                  {!isDataPrepPhase && !flowModeConfirmed && (
                    <Card
                      size="small"
                      className="agent-orch-chat-phase-card"
                      title={(
                        <Space size={8} align="center">
                          <span>阶段 1 · 任务范围</span>
                          <OrchAgentTag agentKey="orchestrator" />
                        </Space>
                      )}
                    >
                      <Typography.Paragraph type="secondary" style={{ marginBottom: 10, fontSize: 12 }}>
                        选择本轮训练与评估的组织方式，对应「训练任务 / 评测任务」范围。
                      </Typography.Paragraph>
                      <Space wrap>
                        {FLOW_MODE_OPTIONS.map((item) => (
                          <Button
                            key={item.key}
                            size="small"
                            type={flowMode === item.key ? 'primary' : 'default'}
                            onClick={() => setFlowMode(item.key)}
                          >
                            {item.label}
                          </Button>
                        ))}
                      </Space>
                      <Button type="primary" size="small" style={{ marginTop: 10 }} disabled={!flowMode} onClick={confirmFlowMode}>
                        确认范围
                      </Button>
                    </Card>
                  )}

                  {!isDataPrepPhase && flowModeConfirmed && !hideEarlyGoalInput && !isTrainingExecutionActive && (
                    <Card
                      size="small"
                      className="agent-orch-chat-phase-card"
                      title={(
                        <Space size={8} align="center">
                          <span>阶段 1 · 训练目标</span>
                          <OrchAgentTag agentKey="planning" />
                        </Space>
                      )}
                      style={{ marginTop: 12 }}
                    >
                      <Typography.Paragraph type="secondary" style={{ marginBottom: 12, fontSize: 12 }}>
                        先写清目标，Planning Agent 会解析出领域、任务与数据形式；解析结果可手动修正；确认后再进入「阶段 2」对齐流程。
                      </Typography.Paragraph>
                      <div className="agent-goal-panel">
                        <div className="agent-goal-panel-section agent-goal-panel-section--primary">
                          <Typography.Title level={5} className="agent-goal-panel-heading">
                            请用一句话描述你的训练目标
                          </Typography.Title>
                            <div className="agent-goal-primary-input-row">
                              <Input.TextArea
                                rows={3}
                                className="agent-goal-primary-textarea"
                                value={intentText}
                                onChange={(e) => setIntentText(e.target.value)}
                                placeholder="例：我想训练一个用于法律合同条款分类的中文文本模型"
                                showCount
                                maxLength={2000}
                              />
                              <Button
                                size="small"
                                type="default"
                                className="agent-goal-intent-btn"
                                loading={autoTagLoading}
                                disabled={isLocked || !intentText.trim()}
                                onClick={() => void autoDetectOptions()}
                              >
                                意图识别
                              </Button>
                            </div>
                        </div>

                        <Card
                          size="small"
                          className="agent-goal-parse-card"
                          title={(
                            <Space size={8}>
                              <RobotOutlined />
                              <span>Planning Agent 识别结果</span>
                              {taskDraft && state === 'task_parsed' ? <Tag color="processing">可编辑</Tag> : null}
                            </Space>
                          )}
                        >
                          <Typography.Paragraph type="secondary" style={{ marginBottom: 10, fontSize: 12 }}>
                            {taskDraft && state === 'task_parsed'
                              ? '以下为解析草稿，可直接点选标签修正；若改动较大，可再次点击「生成任务配置」重新解析。'
                              : '尚未解析或解析结果未就绪。可先点击「自动识别」；有目标描述时标签会直接展示在下方；无描述时可展开「手动配置」点选标签。'}
                          </Typography.Paragraph>
                          {intentText.trim() ? (
                            goalParseChipRows
                          ) : (
                            <Collapse
                              ghost
                              bordered={false}
                              className="agent-goal-manual-collapse"
                              activeKey={goalManualOpen ? ['manual'] : []}
                              onChange={(keys) => {
                                const arr = Array.isArray(keys) ? keys : [keys];
                                setGoalManualOpen(arr.includes('manual'));
                              }}
                              items={[
                                {
                                  key: 'manual',
                                  label: (
                                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                      手动配置（无目标描述时展开）
                                    </Typography.Text>
                                  ),
                                  children: (
                                    <>
                                      <Typography.Paragraph type="secondary" style={{ marginBottom: 10, fontSize: 12 }}>
                                        点选标签后，可配合「自动识别」写入描述，或自行在上方输入框补充自然语言后再解析。
                                      </Typography.Paragraph>
                                      {goalParseChipRows}
                                    </>
                                  ),
                                },
                              ]}
                            />
                          )}
                        </Card>

                        <div className="agent-goal-panel-section agent-goal-panel-section--templates">
                          <Typography.Text type="secondary" className="agent-goal-templates-title">
                            推荐描述模板（点击写入目标描述）
                          </Typography.Text>
                          <Space wrap className="agent-goal-cascade-actions">
                            {recommendedGoalSnippets.map((s) => (
                              <Button
                                key={s.key}
                                size="small"
                                type="default"
                                className="agent-goal-template-btn"
                                onClick={() => appendGoalSnippet(s.text)}
                              >
                                {s.label}
                              </Button>
                            ))}
                          </Space>
                        </div>

                        <div className="agent-goal-panel-actions">
                          <Button type="primary" size="middle" loading={loading} onClick={() => void sendChat()}>
                            {taskDraft && state === 'task_parsed' ? '生成任务配置' : '解析并继续'}
                          </Button>
                        </div>
                      </div>
                    </Card>
                  )}

                  {!isDataPrepPhase && flowModeConfirmed && state === 'task_parsed' && taskDraft && !taxonomyConfirmed && (
                    <Card
                      size="small"
                      className="agent-orch-chat-phase-card"
                      title={(
                        <Space size={8} align="center">
                          <span>阶段 2 · 任务流程</span>
                          <OrchAgentTag agentKey="planning" />
                        </Space>
                      )}
                      style={{ marginTop: 12 }}
                    >
                      <Typography.Paragraph type="secondary" style={{ marginBottom: 10, fontSize: 12 }}>
                        点选芯片确认应用领域、输入数据形式与任务类型；可与 Planner 初判不一致。
                      </Typography.Paragraph>
                      <Typography.Text strong style={{ fontSize: 12 }}>应用领域</Typography.Text>
                      <div style={{ marginTop: 6, marginBottom: 10 }}>
                        <Space wrap>
                          {['金融', '医疗', '法律', '电商', '教育', '通用'].map((x) => (
                            <Button
                              key={x}
                              size="small"
                              type={selectedDomain === x ? 'primary' : 'default'}
                              onClick={() => setSelectedDomain(x)}
                            >
                              {x}
                            </Button>
                          ))}
                        </Space>
                      </div>
                      <Typography.Text strong style={{ fontSize: 12 }}>输入数据形式</Typography.Text>
                      <div style={{ marginTop: 6, marginBottom: 10 }}>
                        <Space wrap>
                          {MODALITY_TAGS.map((x) => (
                            <Button
                              key={x}
                              size="small"
                              type={selectedTaskType === x ? 'primary' : 'default'}
                              disabled={x === '图文'}
                              onClick={() => x !== '图文' && setSelectedTaskType(x)}
                            >
                              {x}{x === '图文' ? '（未开放）' : ''}
                            </Button>
                          ))}
                        </Space>
                      </div>
                      <Typography.Text strong style={{ fontSize: 12 }}>你想让模型完成什么任务</Typography.Text>
                      <div style={{ marginTop: 6, marginBottom: 10 }}>
                        <Space wrap>
                          {GOAL_TASK_CHIPS.map((x) => (
                            <Button
                              key={x}
                              size="small"
                              type={selectedTaskName === x ? 'primary' : 'default'}
                              onClick={() => setSelectedTaskName(x)}
                            >
                              {x}
                            </Button>
                          ))}
                        </Space>
                      </div>
                      <Button type="primary" size="small" onClick={confirmTaxonomy}>
                        确认流程
                      </Button>
                    </Card>
                  )}

                  {!isDataPrepPhase && flowModeConfirmed && taxonomyConfirmed && step === 1 && taskDraft && state === 'task_parsed' && (
                    <Card
                      size="small"
                      className="agent-orch-chat-phase-card"
                      title={(
                        <Space size={8} align="center">
                          <span>阶段 2 · 确认任务</span>
                          <OrchAgentTag agentKey="planning" />
                        </Space>
                      )}
                      style={{ marginTop: 12 }}
                    >
                      <Descriptions column={1} size="small" style={{ marginBottom: 10 }}>
                        <Descriptions.Item label="领域">{bilingual(taskDraft.domain, DOMAIN_CN_MAP)}</Descriptions.Item>
                        <Descriptions.Item label="模态">{bilingual(taskDraft.modality, MODALITY_CN_MAP)}</Descriptions.Item>
                        <Descriptions.Item label="任务类型">{bilingual(taskDraft.semantic_task_type, TASK_CN_MAP)}</Descriptions.Item>
                        <Descriptions.Item label="推荐方法">{bilingualList(taskDraft.candidate_methods, METHOD_CN_MAP)}</Descriptions.Item>
                      </Descriptions>
                      <Space wrap>
                        <Button type="primary" size="small" onClick={confirmTask}>
                          确认任务
                        </Button>
                        <Button
                          size="small"
                          onClick={() => {
                            setTaxonomyConfirmed(false);
                            setStep(0);
                          }}
                        >
                          返回修改流程
                        </Button>
                      </Space>
                    </Card>
                  )}

                  {isDataPrepPhase && (
                    <Card
                      size="small"
                      className="agent-orch-chat-phase-card"
                      title={(
                        <Space size={8} align="center">
                          <span>数据准备（说明）</span>
                          <OrchAgentTag agentKey="data" />
                        </Space>
                      )}
                      style={{ marginTop: 12 }}
                    >
                      <Alert
                        type="info"
                        showIcon
                        message="主操作在右侧「数据工作台」"
                        description="上传、字段映射、schema 校验、切分与确认数据请在右侧完成；此处仅保留对话记录与提示。"
                      />
                      {state === 'data_validating' && (
                        <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0, fontSize: 12 }}>
                          正在校验数据时，请稍候并关注右侧校验结果区。
                        </Typography.Paragraph>
                      )}
                    </Card>
                  )}

                  {hideEarlyGoalInput && flowModeConfirmed && state === 'data_ready' && (
                    <Card
                      size="small"
                      className="agent-orch-chat-phase-card"
                      title={(
                        <Space size={8} align="center">
                          <span>计划准备（说明）</span>
                          <OrchAgentTag agentKey="planning" />
                        </Space>
                      )}
                      style={{ marginTop: 12 }}
                    >
                      <Alert
                        type="info"
                        showIcon
                        message="数据已就绪，下一步是「建议计划」"
                        description="请先在右侧第 3 步点击「生成建议计划」。生成后右侧会进入训练计划工作台；此处仅说明，不在此编辑参数。"
                      />
                      <Button type="primary" size="small" style={{ marginTop: 10 }} onClick={() => void regeneratePlan()}>
                        生成建议计划
                      </Button>
                    </Card>
                  )}

                  {hideEarlyGoalInput && flowModeConfirmed && isPlanWorkbenchPhase && (
                    <Card
                      size="small"
                      className="agent-orch-chat-phase-card"
                      title={(
                        <Space size={8} align="center">
                          <span>训练计划确认（说明）</span>
                          <OrchAgentTag agentKey="planning" />
                        </Space>
                      )}
                      style={{ marginTop: 12 }}
                    >
                      <Alert
                        type="info"
                        showIcon
                        message="主操作在右侧「训练计划工作台」"
                        description={
                          state === 'plan_generating'
                            ? '正在生成建议计划，请稍候。生成完成后请在右侧核对条目，再点击「确认计划并继续」将「建议计划」固化为「已确认计划」。'
                            : '右侧为「建议计划」：可微调参数或使用「重新生成计划」。未点击确认前不会锁定 run，也不会进入执行阶段。确认后计划变为「已确认计划」并进入下一步工作台。'
                        }
                      />
                      <Button
                        type="default"
                        size="small"
                        style={{ marginTop: 10 }}
                        loading={state === 'plan_generating'}
                        onClick={() => void regeneratePlan()}
                      >
                        重新生成建议计划
                      </Button>
                    </Card>
                  )}

                  {flowModeConfirmed &&
                    ['training_queued', 'training_running', 'training_succeeded'].includes(state) && (
                      <Card
                        size="small"
                        className="agent-orch-chat-phase-card"
                        title={(
                          <Space size={8} align="center">
                            <span>训练执行（说明）</span>
                            <OrchAgentTag agentKey="training" />
                          </Space>
                        )}
                        style={{ marginTop: 12 }}
                      >
                        <Alert
                          type="info"
                          showIcon
                          message="Training Executor 在右侧工作台输出"
                          description="概览、训练日志、MCP 消息与产物在右侧分栏查看；MCP 为多 Agent 侧信道，不进入下方对话流。"
                        />
                      </Card>
                    )}

                  {flowModeConfirmed && (state === 'evaluating' || (state === 'done' && step >= 5)) && (
                    <Card
                      size="small"
                      className="agent-orch-chat-phase-card"
                      title={(
                        <Space size={8} align="center">
                          <span>评估与结果（说明）</span>
                          <OrchAgentTag agentKey="eval" />
                        </Space>
                      )}
                      style={{ marginTop: 12 }}
                    >
                      <Alert
                        type="info"
                        showIcon
                        message="Evaluation Agent 主导本步"
                        description="指标与报告由评估侧汇总；Orchestrator 仅在阶段边界提示。请在右侧「评估与结果」步骤完成确认。"
                      />
                    </Card>
                  )}
                </div>
              ) : null}
              </div>
            </Card>
          </div>

          <div className="agent-orch-col agent-orch-col-workspace">
            <Card
              size="small"
              className="step-card agent-orch-workspace-card"
              title={(
                <Space align="center" wrap size={8}>
                  <span style={{ fontWeight: 600 }}>阶段工作台</span>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    主责
                  </Typography.Text>
                  <OrchAgentTag agentKey={primaryOrchAgent} />
                </Space>
              )}
            >
              <div className="agent-orch-workspace-body">
              {!(step === 4 && isTrainingExecutionView) && (
                <>
                  <Divider style={{ margin: '16px 0' }} />
                  <Button type="link" style={{ paddingLeft: 0 }} onClick={() => setMcpDrawerOpen(true)}>
                    打开 MCP 侧信道（多 Agent）
                  </Button>
                  <Typography.Text strong style={{ display: 'block', marginTop: 12, marginBottom: 8 }}>
                    运行时间线
                  </Typography.Text>
                  <Timeline
                    items={[
                      { color: taskDraft ? 'green' : 'gray', children: 'Planning：任务已解析（规划完成）' },
                      {
                        color: state === 'data_ready' || !!pipeline ? 'green' : 'gray',
                        children: 'Data Agent：数据已就绪（校验通过）',
                      },
                      {
                        color: pipeline?.current_step === 'train' || state === 'done' ? 'blue' : 'gray',
                        children: 'Training Executor：训练已启动',
                      },
                      {
                        color: pipeline?.model_id ? 'blue' : 'gray',
                        children: 'Training Executor：模型检查点已保存',
                      },
                      { color: state === 'done' ? 'green' : 'gray', children: 'Evaluation Agent：评估已完成' },
                    ]}
                  />
                  {state === 'done' && (
                    <Alert type="success" icon={<CheckCircleOutlined />} message="已完成" style={{ marginTop: 8 }} />
                  )}
                </>
              )}
              {(step === 0 || step === 1) && ['draft', 'intent_submitted', 'task_parsed'].includes(state) && (
                <Card size="small" title="编排摘要（只读）" style={{ marginBottom: 12 }} className="agent-orch-summary-card">
                  <Descriptions column={1} size="small" bordered>
                    <Descriptions.Item label="任务范围">
                      {flowModeConfirmed && flowMode ? flowModeLabel(flowMode) : '未确认'}
                    </Descriptions.Item>
                    <Descriptions.Item label="目标描述">{intentText?.trim() ? `${intentText.trim().slice(0, 120)}${intentText.trim().length > 120 ? '…' : ''}` : '—'}</Descriptions.Item>
                    {taskDraft ? (
                      <Descriptions.Item label="Planner 草案">{`${taskDraft.semantic_task_type} / ${taskDraft.domain} / ${taskDraft.modality}`}</Descriptions.Item>
                    ) : (
                      <Descriptions.Item label="Planner 草案">—</Descriptions.Item>
                    )}
                    <Descriptions.Item label="流程芯片">
                      {taxonomyConfirmed ? '已确认' : state === 'task_parsed' && taskDraft ? '待中间栏确认' : '—'}
                    </Descriptions.Item>
                  </Descriptions>
                  <Button
                    type="link"
                    size="small"
                    icon={<DeleteOutlined />}
                    onClick={clearSelectedPromptOptions}
                    disabled={isLocked}
                    style={{ paddingLeft: 0, marginTop: 8 }}
                  >
                    重置本轮编排
                  </Button>
                </Card>
              )}

              <Steps
                current={step}
                onChange={onStepClick}
                items={[
                  { title: '目标输入', description: 'Orchestrator / Planning' },
                  { title: '任务确认', description: 'Planning Agent' },
                  { title: '数据准备', description: 'Data Agent' },
                  { title: '计划确认', description: 'Planning Agent' },
                  { title: '训练执行', description: 'Training Executor' },
                  { title: '评估与结果', description: 'Evaluation Agent' },
                ]}
                style={{ marginBottom: 16 }}
              />
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

                {step === 2 && state === 'task_confirmed' && taskSpec && (
                  <Space direction="vertical" style={{ width: '100%' }}>
                    <Card
                      size="small"
                      title={(
                        <Space size={8} align="center">
                          <span>任务确认卡</span>
                          <OrchAgentTag agentKey="planning" />
                        </Space>
                      )}
                    >
                      <Descriptions bordered column={1} size="small">
                        <Descriptions.Item label="任务类型">{bilingual(taskSpec.semantic_task_type, TASK_CN_MAP)}</Descriptions.Item>
                        <Descriptions.Item label="领域">{bilingual(taskSpec.domain, DOMAIN_CN_MAP)}</Descriptions.Item>
                        <Descriptions.Item label="模态">{bilingual(taskSpec.modality, MODALITY_CN_MAP)}</Descriptions.Item>
                        <Descriptions.Item label="推荐方法">{bilingualList(taskSpec.candidate_methods, METHOD_CN_MAP)}</Descriptions.Item>
                        <Descriptions.Item label="推荐指标">{bilingualList(taskSpec.recommended_metrics, METRIC_CN_MAP)}</Descriptions.Item>
                      </Descriptions>
                      <Button type="primary" style={{ marginTop: 12 }} onClick={enterDataPreparation} disabled={isLocked}>
                        进入数据准备
                      </Button>
                    </Card>
                  </Space>
                )}

                {step === 2 && (state === 'data_selecting' || state === 'data_validating') && (
                  <Space direction="vertical" style={{ width: '100%' }} className="agent-data-workbench">
                    <Card
                      size="small"
                      title="数据工作台 · 当前任务"
                      extra={
                        <Space size={8} wrap align="center">
                          <OrchAgentTag agentKey="data" />
                          <Radio.Group
                            buttonStyle="solid"
                            size="small"
                            value={dataWorkbenchMode}
                            onChange={(e) => setDataWorkbenchMode(e.target.value)}
                            disabled={isLocked}
                          >
                            <Radio.Button value="summary">摘要</Radio.Button>
                            <Radio.Button value="edit">编辑</Radio.Button>
                          </Radio.Group>
                        </Space>
                      }
                    >
                      <Descriptions bordered column={1} size="small">
                        <Descriptions.Item label="领域">
                          {taskSpec ? bilingual(taskSpec.domain, DOMAIN_CN_MAP) : '—'}
                        </Descriptions.Item>
                        <Descriptions.Item label="模态">
                          {taskSpec ? bilingual(taskSpec.modality, MODALITY_CN_MAP) : '—'}
                        </Descriptions.Item>
                        <Descriptions.Item label="任务类型">
                          {taskSpec ? bilingual(taskSpec.semantic_task_type, TASK_CN_MAP) : '—'}
                        </Descriptions.Item>
                        <Descriptions.Item label="所需 schema">
                          {schemaHintByTask(taskSpec?.semantic_task_type)}
                        </Descriptions.Item>
                        <Descriptions.Item label="推荐指标">
                          {taskSpec?.recommended_metrics?.join('，') || '—'}
                        </Descriptions.Item>
                      </Descriptions>
                    </Card>

                    {dataWorkbenchMode === 'summary' && (
                      <Card size="small" title="数据工作台 · 摘要">
                        <Descriptions bordered column={1} size="small">
                          <Descriptions.Item label="数据来源">
                            {datasetSourceMode === 'upload' && '上传符合 schema 的数据'}
                            {datasetSourceMode === 'agent_convert' && '上传原始材料，由 Data Agent 转换'}
                            {datasetSourceMode === 'agent_search' && '由 Data Agent 搜索公开数据集'}
                          </Descriptions.Item>
                          <Descriptions.Item label="已选数据集">
                            {selectedDataset ? `${selectedDataset.name}${selectedDatasetId === MOCK_WORKSPACE_DATASET_ID ? '（本地 mock）' : ''}` : '未选择'}
                          </Descriptions.Item>
                          <Descriptions.Item label="待处理文件">
                            {workspaceUploadList.length ? `${workspaceUploadList.length} 个` : '无'}
                          </Descriptions.Item>
                          <Descriptions.Item label="切分策略">
                            {splitStrategy === 'preset' ? '预设（preset）' : '随机（random）'} · train/valid/test {tvSplit.train}:{tvSplit.valid}:{tvSplit.test}
                          </Descriptions.Item>
                          <Descriptions.Item label="Schema 校验">
                            {datasetValidationReport?.schema_check || '未执行'}
                          </Descriptions.Item>
                        </Descriptions>
                        <Space style={{ marginTop: 12 }}>
                          <Button size="small" onClick={() => setDataWorkbenchMode('edit')} disabled={isLocked}>
                            展开编辑
                          </Button>
                          <Button type="primary" onClick={confirmData} disabled={isLocked} loading={state === 'data_validating'}>
                            确认数据
                          </Button>
                        </Space>
                      </Card>
                    )}

                    {dataWorkbenchMode === 'edit' && (
                      <>
                        <Card size="small" title="数据来源方式">
                          <Space direction="vertical" style={{ width: '100%' }}>
                            <Select
                              value={datasetSourceMode}
                              disabled={isLocked}
                              onChange={setDatasetSourceMode}
                              style={{ width: '100%' }}
                              options={[
                                { label: '上传符合 schema 的数据', value: 'upload' },
                                { label: '上传原始材料，由 Data Agent 转换', value: 'agent_convert' },
                                { label: '由 Data Agent 搜索公开数据集', value: 'agent_search' },
                              ]}
                            />
                            {datasetSourceMode === 'agent_convert' && (
                              <Alert type="info" showIcon message="（mock）Data Agent 转换链路为占位，可先上传文件并点击「应用模拟检测与校验」体验工作台。" />
                            )}
                            {datasetSourceMode === 'agent_search' && (
                              <Alert type="info" showIcon message="（mock）公开数据集检索为占位，可使用下方按钮加入模拟检索结果。" />
                            )}
                          </Space>
                        </Card>

                        <Card size="small" title="上传入口">
                          <Space direction="vertical" style={{ width: '100%' }}>
                            <Upload.Dragger
                              multiple
                              maxCount={8}
                              disabled={isLocked}
                              fileList={workspaceUploadList}
                              beforeUpload={() => false}
                              onChange={({ fileList }) => setWorkspaceUploadList(fileList)}
                            >
                              <p className="ant-upload-drag-icon">
                                <InboxOutlined />
                              </p>
                              <p className="ant-upload-text">拖拽文件到此处，或点击选择本地文件</p>
                              <p className="ant-upload-hint">同一列表与下方 URL 导入合并展示；提交上传仅使用列表中第一个本地文件</p>
                            </Upload.Dragger>
                            <Divider orientation="left" plain style={{ margin: '4px 0 8px' }}>
                              URL 导入（加入待处理列表）
                            </Divider>
                            <Space wrap style={{ width: '100%' }}>
                              <Input
                                style={{ width: 160 }}
                                placeholder="数据集名称"
                                value={importUrlName}
                                onChange={(e) => setImportUrlName(e.target.value)}
                                disabled={isLocked}
                              />
                              <Input
                                style={{ minWidth: 220, flex: 1 }}
                                placeholder="https://..."
                                value={importUrlValue}
                                onChange={(e) => setImportUrlValue(e.target.value)}
                                disabled={isLocked}
                              />
                              <Button type="primary" icon={<LinkOutlined />} onClick={addUrlToWorkspaceStaging} disabled={isLocked}>
                                加入列表
                              </Button>
                            </Space>
                            <Space wrap align="center">
                              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                上传到服务器（首个本地文件）：
                              </Typography.Text>
                              <Input
                                style={{ width: 200 }}
                                placeholder="数据集显示名称"
                                value={realUploadDatasetName}
                                onChange={(e) => setRealUploadDatasetName(e.target.value)}
                                disabled={isLocked}
                              />
                              <Button icon={<UploadOutlined />} onClick={() => void submitRealDatasetUpload()} disabled={isLocked || loading}>
                                提交上传
                              </Button>
                            </Space>
                            {datasetSourceMode === 'agent_search' && (
                              <Button onClick={mockAgentSearchStaging} disabled={isLocked}>
                                （mock）模拟检索并加入列表
                              </Button>
                            )}
                          </Space>
                        </Card>

                        <Card size="small" title="文件列表">
                          <Table
                            size="small"
                            pagination={false}
                            rowKey="uid"
                            dataSource={workspaceUploadList}
                            locale={{ emptyText: '暂无待处理文件' }}
                            columns={[
                              { title: '名称', dataIndex: 'name', ellipsis: true },
                              {
                                title: 'URL',
                                dataIndex: 'url',
                                ellipsis: true,
                                render: (u: string | undefined) => u || '—',
                              },
                              {
                                title: '操作',
                                width: 72,
                                render: (_, r: UploadFile) => (
                                  <Button
                                    type="link"
                                    danger
                                    size="small"
                                    icon={<DeleteOutlined />}
                                    disabled={isLocked}
                                    onClick={() =>
                                      setWorkspaceUploadList((prev) => prev.filter((x) => x.uid !== r.uid))
                                    }
                                  />
                                ),
                              },
                            ]}
                          />
                        </Card>

                        <Card size="small" title="选择已就绪数据集">
                          <Select
                            allowClear
                            style={{ width: '100%' }}
                            value={selectedDatasetId}
                            disabled={isLocked}
                            placeholder="从服务器列表选择，或使用下方 mock 校验生成本地就绪集"
                            onChange={(id) => {
                              setSelectedDatasetId(id);
                              if (id !== MOCK_WORKSPACE_DATASET_ID) {
                                setLocalMockDataset(null);
                                setMockPreviewRows([]);
                              }
                            }}
                            options={[
                              ...(localMockDataset
                                ? [{ label: `${localMockDataset.name}（工作台 mock）`, value: MOCK_WORKSPACE_DATASET_ID }]
                                : []),
                              ...datasets.map((d) => ({ label: `${d.name} (ID:${d.id})`, value: d.id })),
                            ]}
                          />
                        </Card>

                        <Card size="small" title="标准模板（可选）">
                          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
                            按当前任务 schema 下载 CSV 模板，填写后再上传可降低格式错误。
                          </Typography.Paragraph>
                          <Button onClick={downloadTaskTemplate} disabled={isLocked}>
                            下载任务模板
                          </Button>
                        </Card>

                        <Card size="small" title="字段检测与映射">
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            输入原始列名后生成建议，或在表格中直接编辑映射。
                          </Typography.Text>
                          <Input.TextArea
                            rows={2}
                            style={{ marginTop: 8 }}
                            value={rawColumnsInput}
                            onChange={(e) => setRawColumnsInput(e.target.value)}
                            placeholder="例如：sentence, sentiment_label"
                            disabled={isLocked}
                          />
                          <Space style={{ marginTop: 8 }}>
                            <Button onClick={generateAgentColumnMap} disabled={isLocked}>
                              Agent 解析字段映射
                            </Button>
                            <Button onClick={() => setAgentColumnMap({})} disabled={isLocked}>
                              清空映射
                            </Button>
                          </Space>
                          <Table
                            style={{ marginTop: 12 }}
                            size="small"
                            pagination={false}
                            rowKey="target"
                            dataSource={schemaHeadersByTask(taskSpec?.semantic_task_type).map((h) => ({ target: h }))}
                            locale={{ emptyText: '无 schema 字段' }}
                            columns={[
                              { title: 'Schema 字段', dataIndex: 'target', width: 140 },
                              {
                                title: '映射到数据列',
                                render: (_, row: { target: string }) => (
                                  <Input
                                    size="small"
                                    value={agentColumnMap[row.target] ?? ''}
                                    placeholder="列名"
                                    disabled={isLocked}
                                    onChange={(e) => updateAgentColumnMapField(row.target, e.target.value)}
                                  />
                                ),
                              },
                            ]}
                          />
                        </Card>

                        <Card size="small" title="Schema 校验结果">
                          <Descriptions bordered column={1} size="small">
                            <Descriptions.Item label="字段检查">{datasetValidationReport?.field_check || '待检查'}</Descriptions.Item>
                            <Descriptions.Item label="schema 检查">{datasetValidationReport?.schema_check || '待检查'}</Descriptions.Item>
                            <Descriptions.Item label="样本数检查">{datasetValidationReport?.sample_count || '待检查'}</Descriptions.Item>
                            <Descriptions.Item label="标签分布检查">{datasetValidationReport?.label_distribution || '待检查'}</Descriptions.Item>
                          </Descriptions>
                          <Button style={{ marginTop: 12 }} onClick={applyMockWorkspaceValidation} disabled={isLocked}>
                            应用模拟检测与校验
                          </Button>
                        </Card>

                        <Card size="small" title="Train / Valid / Test 切分">
                          <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
                            写入 run_spec：与策略字段拼接为 <Typography.Text code>tvt=…</Typography.Text>
                          </Typography.Paragraph>
                          <Radio.Group
                            value={splitStrategy}
                            onChange={(e) => setSplitStrategy(e.target.value)}
                            disabled={isLocked}
                            style={{ marginBottom: 12 }}
                          >
                            <Space direction="vertical">
                              <Radio value="preset">预设切分（preset）</Radio>
                              <Radio value="random">随机切分（random）</Radio>
                            </Space>
                          </Radio.Group>
                          <Space wrap align="center">
                            <Typography.Text>Train</Typography.Text>
                            <InputNumber
                              min={0}
                              max={100}
                              value={tvSplit.train}
                              onChange={(v) => setTvSplit((s) => ({ ...s, train: Number(v) || 0 }))}
                              disabled={isLocked}
                            />
                            <Typography.Text>Valid</Typography.Text>
                            <InputNumber
                              min={0}
                              max={100}
                              value={tvSplit.valid}
                              onChange={(v) => setTvSplit((s) => ({ ...s, valid: Number(v) || 0 }))}
                              disabled={isLocked}
                            />
                            <Typography.Text>Test</Typography.Text>
                            <InputNumber
                              min={0}
                              max={100}
                              value={tvSplit.test}
                              onChange={(v) => setTvSplit((s) => ({ ...s, test: Number(v) || 0 }))}
                              disabled={isLocked}
                            />
                            <Typography.Text type="secondary">合计须为 100</Typography.Text>
                          </Space>
                        </Card>

                        <Card size="small" title="样本预览">
                          <Table
                            size="small"
                            pagination={{ pageSize: 5 }}
                            rowKey="__row"
                            dataSource={mockPreviewRows.map((row, i) => ({ ...row, __row: i }))}
                            locale={{ emptyText: '尚无预览：可先「应用模拟检测与校验」或选择服务器数据集' }}
                            columns={
                              mockPreviewRows[0]
                                ? Object.keys(mockPreviewRows[0]).map((k) => ({
                                    title: k,
                                    dataIndex: k,
                                    ellipsis: true,
                                  }))
                                : []
                            }
                          />
                        </Card>

                        <Space wrap>
                          <Button
                            onClick={() => {
                              if (taskSpec) setTaskDraft(taskSpec);
                              setState('task_confirmed');
                              setStep(2);
                            }}
                            disabled={isLocked}
                          >
                            返回任务确认
                          </Button>
                          <Button type="primary" onClick={confirmData} disabled={isLocked} loading={state === 'data_validating'}>
                            确认数据
                          </Button>
                        </Space>
                      </>
                    )}
                  </Space>
                )}

                {step === 3 && state === 'data_ready' && (
                  <Space direction="vertical" style={{ width: '100%' }} className="agent-plan-workbench-prep">
                    <Alert
                      type="info"
                      showIcon
                      message="尚未生成建议计划"
                      description="建议计划由系统根据当前任务与数据生成，生成后可在本页核对与微调。未确认前不会锁定配置，也不会进入执行阶段。"
                    />
                    <Card size="small" title="操作">
                      <Button type="primary" onClick={() => void regeneratePlan()} disabled={isLocked}>
                        生成建议计划
                      </Button>
                      <Button
                        style={{ marginLeft: 8 }}
                        onClick={() => {
                          setState('data_selecting');
                          setStep(2);
                        }}
                        disabled={isLocked}
                      >
                        返回数据准备
                      </Button>
                    </Card>
                  </Space>
                )}

                {step === 3 && isPlanWorkbenchPhase && (
                  <Space direction="vertical" style={{ width: '100%' }} className="agent-plan-workbench">
                    <Card
                      size="small"
                      title={(
                        <Space size={8} align="center">
                          <span>训练计划工作台</span>
                          <OrchAgentTag agentKey="planning" />
                        </Space>
                      )}
                      extra={
                        <Space size={4} wrap align="center">
                          <Tag color="gold">建议计划</Tag>
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            确认前可改；确认后写入「已确认计划」
                          </Typography.Text>
                        </Space>
                      }
                    >
                      {state === 'plan_generating' && (
                        <Alert type="info" showIcon style={{ marginBottom: 12 }} message="正在生成建议计划…" />
                      )}
                      <Alert
                        type="info"
                        showIcon
                        message="与「已确认计划」的区别"
                        description="当前为建议计划（provisional）：仅预览与编辑。点击「确认计划并继续」后，本页配置将锁定为已确认计划（plan_frozen）并进入下一阶段；不会自动开始训练。"
                        style={{ marginBottom: 12 }}
                      />
                    </Card>

                    <Card size="small" title="当前任务摘要">
                      <Descriptions bordered column={1} size="small">
                        <Descriptions.Item label="领域">
                          {taskSpec ? bilingual(taskSpec.domain, DOMAIN_CN_MAP) : '—'}
                        </Descriptions.Item>
                        <Descriptions.Item label="模态">
                          {taskSpec ? bilingual(taskSpec.modality, MODALITY_CN_MAP) : '—'}
                        </Descriptions.Item>
                        <Descriptions.Item label="任务类型">
                          {taskSpec ? bilingual(taskSpec.semantic_task_type, TASK_CN_MAP) : '—'}
                        </Descriptions.Item>
                        <Descriptions.Item label="任务 schema">
                          {taskSpec ? taskSpec.task_schema_id : '—'}
                        </Descriptions.Item>
                      </Descriptions>
                    </Card>

                    <Card size="small" title="当前数据摘要">
                      <Descriptions bordered column={1} size="small">
                        <Descriptions.Item label="数据集">
                          {selectedDataset ? `${selectedDataset.name}（ID: ${selectedDataset.id}）` : '—'}
                        </Descriptions.Item>
                        <Descriptions.Item label="样本数">
                          {selectedDataset?.row_count ?? '—'}
                        </Descriptions.Item>
                        <Descriptions.Item label="列数">
                          {selectedDataset?.column_count ?? '—'}
                        </Descriptions.Item>
                        <Descriptions.Item label="数据来源模式">{datasetSourceMode}</Descriptions.Item>
                        <Descriptions.Item label="切分">
                          {splitStrategy} · tvt {tvSplit.train}:{tvSplit.valid}:{tvSplit.test}
                        </Descriptions.Item>
                      </Descriptions>
                    </Card>

                    <Card size="small" title="建议训练配置（只读摘要）">
                      <Descriptions bordered column={1} size="small">
                        <Descriptions.Item label="推荐基座模型">
                          {planSpec.base_model || DEFAULT_BASE_MODEL}
                        </Descriptions.Item>
                        <Descriptions.Item label="推荐训练方法">
                          {bilingual(planSpec.training_method || taskSpec?.candidate_methods?.[0], METHOD_CN_MAP)}
                        </Descriptions.Item>
                        <Descriptions.Item label="epochs">{planSpec.epochs}</Descriptions.Item>
                        <Descriptions.Item label="batch size">{planSpec.batch_size}</Descriptions.Item>
                        <Descriptions.Item label="learning rate">{planSpec.learning_rate}</Descriptions.Item>
                        <Descriptions.Item label="评估策略（运行节奏）">{planSpec.eval_strategy || 'per_epoch'}</Descriptions.Item>
                        <Descriptions.Item label="预期评估指标">
                          {taskSpec?.recommended_metrics?.length
                            ? bilingualList(taskSpec.recommended_metrics, METRIC_CN_MAP)
                            : '—'}
                        </Descriptions.Item>
                      </Descriptions>
                    </Card>

                    <Card size="small" title="调整建议参数（可选）">
                      <Space direction="vertical" style={{ width: '100%' }}>
                        <Input
                          addonBefore="基座模型"
                          value={planSpec.base_model}
                          disabled={isLocked || state === 'plan_generating'}
                          onChange={(e) => setPlanSpec({ ...planSpec, base_model: e.target.value })}
                        />
                        <Input
                          addonBefore="训练方法"
                          value={planSpec.training_method}
                          disabled={isLocked || state === 'plan_generating'}
                          onChange={(e) => setPlanSpec({ ...planSpec, training_method: e.target.value })}
                        />
                        <InputNumber
                          addonBefore="epochs"
                          value={planSpec.epochs}
                          disabled={isLocked || state === 'plan_generating'}
                          onChange={(v) => setPlanSpec({ ...planSpec, epochs: Number(v || 1) })}
                        />
                        <InputNumber
                          addonBefore="batch size"
                          value={planSpec.batch_size}
                          disabled={isLocked || state === 'plan_generating'}
                          onChange={(v) => setPlanSpec({ ...planSpec, batch_size: Number(v || 1) })}
                        />
                        <InputNumber
                          addonBefore="learning rate"
                          value={planSpec.learning_rate}
                          disabled={isLocked || state === 'plan_generating'}
                          step={0.00001}
                          onChange={(v) => setPlanSpec({ ...planSpec, learning_rate: Number(v || 0.00002) })}
                        />
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          微调后仍属于「建议计划」；确认后才会写入已确认计划。
                        </Typography.Text>
                      </Space>
                    </Card>

                    <Space wrap>
                      <Button
                        icon={<SyncOutlined />}
                        onClick={() => void regeneratePlan()}
                        disabled={isLocked || state === 'plan_generating'}
                      >
                        重新生成计划
                      </Button>
                      <Button
                        onClick={() => {
                          setState('data_selecting');
                          setStep(2);
                        }}
                        disabled={isLocked || state === 'plan_generating'}
                      >
                        返回修改数据
                      </Button>
                      <Button
                        type="primary"
                        onClick={freezePlan}
                        disabled={isLocked || state === 'plan_generating'}
                      >
                        确认计划并继续
                      </Button>
                    </Space>
                  </Space>
                )}

                {step === 4 && isTrainingExecutionView && (
                  <div className="agent-train-exec-workbench">
                    <Card
                      size="small"
                      title={(
                        <Space size={8} align="center">
                          <span>训练执行工作台</span>
                          <OrchAgentTag agentKey="training" />
                        </Space>
                      )}
                      extra={
                        <Space size={6} wrap align="center">
                          <OrchAgentTag agentKey="orchestrator" />
                          <Tag color="processing">{state}</Tag>
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            pipeline #{pipeline?.id ?? '—'}
                          </Typography.Text>
                        </Space>
                      }
                    >
                      <Typography.Paragraph type="secondary" style={{ marginBottom: 12, fontSize: 12 }}>
                        Training Executor 已接管训练侧执行；Orchestrator 负责阶段编排。请用下方分栏查看概览、日志、MCP
                        消息与产物（MCP 为各 Agent 侧信道，不进入中间对话）。
                      </Typography.Paragraph>
                      <Tabs
                        items={[
                          {
                            key: 'overview',
                            label: '概览',
                            children: (
                              <Space direction="vertical" style={{ width: '100%' }} size="middle">
                                {runSpec?.plan_spec && (
                                  <Descriptions bordered column={1} size="small" title="已确认计划（快照）">
                                    <Descriptions.Item label="基座模型">{runSpec.plan_spec.base_model}</Descriptions.Item>
                                    <Descriptions.Item label="训练方法">{runSpec.plan_spec.training_method}</Descriptions.Item>
                                    <Descriptions.Item label="epochs / batch / lr">
                                      {runSpec.plan_spec.epochs} / {runSpec.plan_spec.batch_size} / {runSpec.plan_spec.learning_rate}
                                    </Descriptions.Item>
                                  </Descriptions>
                                )}
                                <Descriptions bordered column={1} size="small" title="Run 状态">
                                  <Descriptions.Item label="run_id">{runSpec?.run_id || pipeline?.id || '-'}</Descriptions.Item>
                                  <Descriptions.Item label="任务">
                                    {taskSpec ? `${taskSpec.domain} / ${taskSpec.semantic_task_type}` : '-'}
                                  </Descriptions.Item>
                                  <Descriptions.Item label="数据">{selectedDataset?.name || '-'}</Descriptions.Item>
                                  <Descriptions.Item label="当前阶段">{pipeline?.current_step || state}</Descriptions.Item>
                                  <Descriptions.Item label="metrics 速览">
                                    acc {pipeline?.metrics?.accuracy ?? '—'} · f1 {pipeline?.metrics?.f1 ?? '—'} · loss{' '}
                                    {pipeline?.metrics?.loss ?? '—'}
                                  </Descriptions.Item>
                                </Descriptions>
                                <Timeline
                                  items={[
                                    {
                                      color: taskDraft ? 'green' : 'gray',
                                      children: taskDraft ? 'Planning：任务解析完成' : 'Planning：等待解析',
                                    },
                                    {
                                      color:
                                        state === 'data_ready' || pipeline?.orchestration_state === 'DATA_VALIDATED'
                                          ? 'green'
                                          : state === 'data_validating' || pipeline?.current_step === 'clean_data'
                                            ? 'blue'
                                            : 'gray',
                                      children:
                                        state === 'data_ready' || pipeline?.orchestration_state === 'DATA_VALIDATED'
                                          ? 'Data Agent：数据就绪（清洗完成）'
                                          : state === 'data_validating' || pipeline?.current_step === 'clean_data'
                                            ? 'Data Agent：数据清洗中'
                                            : 'Data Agent：等待清洗',
                                    },
                                    {
                                      color:
                                        state === 'training_succeeded'
                                          ? 'green'
                                          : state === 'training_running' || pipeline?.current_step === 'train'
                                            ? 'blue'
                                            : 'gray',
                                      children:
                                        state === 'training_succeeded'
                                          ? 'Training Executor：训练完成'
                                          : state === 'training_running' || pipeline?.current_step === 'train'
                                            ? 'Training Executor：训练中'
                                            : 'Training Executor：等待训练',
                                    },
                                    {
                                      color: pipeline?.model_id ? 'blue' : 'gray',
                                      children: pipeline?.model_id ? 'Training Executor：模型检查点已保存' : 'Training Executor：模型检查点（待生成）',
                                    },
                                    {
                                      color:
                                        state === 'done' || pipeline?.orchestration_state === 'COMPLETED'
                                          ? 'green'
                                          : state === 'evaluating' || pipeline?.current_step === 'evaluate'
                                            ? 'blue'
                                            : 'gray',
                                      children:
                                        state === 'done' || pipeline?.orchestration_state === 'COMPLETED'
                                          ? 'Evaluation Agent：评估完成'
                                          : state === 'evaluating' || pipeline?.current_step === 'evaluate'
                                            ? 'Evaluation Agent：评估中'
                                            : 'Evaluation Agent：等待评估',
                                    },
                                  ]}
                                />
                                <Alert
                                  type={pipeline?.error_message ? 'error' : 'info'}
                                  showIcon
                                  message={pipeline?.error_message || '暂无错误信息'}
                                />
                                <Space wrap>
                                  <Button
                                    type="default"
                                    icon={<SyncOutlined />}
                                    onClick={() => {
                                      if (!pipeline?.id) return;
                                      void axios
                                        .get(`${API_BASE}/pipelines/${pipeline.id}`)
                                        .then((res) => setPipeline(res.data))
                                        .catch(() => {});
                                    }}
                                  >
                                    刷新状态
                                  </Button>
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
                              </Space>
                            ),
                          },
                          {
                            key: 'logs',
                            label: '训练日志',
                            children: (
                              <>
                              <Alert
                                type="info"
                                showIcon
                                style={{ marginBottom: 10 }}
                                message="日志来源：Training Executor"
                                description="以下为训练进程标准输出（示例/后端推送）；与 Orchestrator 对话流相互独立。"
                              />
                              <List
                                size="small"
                                style={{
                                  maxHeight: 320,
                                  overflowY: 'auto',
                                  border: '1px solid #f0f0f0',
                                  borderRadius: 6,
                                  padding: 8,
                                }}
                                dataSource={runLogs}
                                locale={{
                                  emptyText: pipeline?.id
                                    ? '当前 run 暂无日志输出（可能后端尚未返回日志流）'
                                    : '等待 pipeline 信息…',
                                }}
                                renderItem={(line) => (
                                  <List.Item style={{ padding: '4px 0', border: 'none', fontFamily: 'monospace', fontSize: 12 }}>
                                    {line}
                                  </List.Item>
                                )}
                              />
                              </>
                            ),
                          },
                          {
                            key: 'mcp',
                            label: 'MCP 消息',
                            children: (
                              <>
                                <Alert
                                  type="info"
                                  showIcon
                                  style={{ marginBottom: 10 }}
                                  message="多 Agent 侧信道"
                                  description="每行对应某一角色经 MCP Server 发起的动作；与中间「编排对话」分离，便于对照 Planning / Data / Training / Evaluation / Orchestrator。"
                                />
                                <Table
                                  size="small"
                                  pagination={{ pageSize: 6 }}
                                  rowKey="id"
                                  scroll={{ x: 900 }}
                                  dataSource={trainExecutionMcpRows}
                                  columns={[
                                    { title: '时间', dataIndex: 'time', width: 100, ellipsis: true },
                                    { title: 'Agent（角色）', dataIndex: 'agent', width: 148, ellipsis: true },
                                    { title: 'MCP Server', dataIndex: 'mcpServer', width: 100 },
                                    { title: 'Action', dataIndex: 'action', width: 160, ellipsis: true },
                                    {
                                      title: '状态',
                                      dataIndex: 'status',
                                      width: 88,
                                      render: (s: string) => {
                                        const color =
                                          s === 'success'
                                            ? 'success'
                                            : s === 'running'
                                              ? 'processing'
                                              : s === 'failed'
                                                ? 'error'
                                                : 'default';
                                        return <Tag color={color}>{s}</Tag>;
                                      },
                                    },
                                    { title: '输出摘要', dataIndex: 'outputSummary', ellipsis: true },
                                  ]}
                                />
                              </>
                            ),
                          },
                          {
                            key: 'artifacts',
                            label: 'Checkpoint / 产物',
                            children: (
                              <Space direction="vertical" style={{ width: '100%' }}>
                                <Alert
                                  type="info"
                                  showIcon
                                  message="产物来源：Training Executor"
                                  description="checkpoint 与 adapter 由训练侧写入；下载链接来自 pipeline 产物（若有）。"
                                />
                                <Space wrap>
                                  <Button disabled={!pipeline?.artifacts?.model_url} href={pipeline?.artifacts?.model_url} target="_blank">
                                    下载模型产物
                                  </Button>
                                  <Button disabled={!pipeline?.artifacts?.metrics_url} href={pipeline?.artifacts?.metrics_url} target="_blank">
                                    下载 metrics.json
                                  </Button>
                                  <Button
                                    disabled={!pipeline?.artifacts?.eval_report_url}
                                    href={pipeline?.artifacts?.eval_report_url}
                                    target="_blank"
                                  >
                                    下载 eval_report.json
                                  </Button>
                                </Space>
                                <Table
                                  size="small"
                                  pagination={false}
                                  rowKey="key"
                                  dataSource={[
                                    {
                                      key: 'ckpt-mock-1',
                                      name: 'checkpoint-400（示例）',
                                      path: '/outputs/mock/ckpt-400',
                                      note: '占位：接入后端后展示真实 checkpoint 列表',
                                    },
                                    {
                                      key: 'ckpt-mock-2',
                                      name: 'adapter-latest（示例）',
                                      path: '/outputs/mock/adapter',
                                      note: '—',
                                    },
                                  ]}
                                  columns={[
                                    { title: '名称', dataIndex: 'name' },
                                    { title: '路径', dataIndex: 'path', ellipsis: true },
                                    { title: '说明', dataIndex: 'note', ellipsis: true },
                                  ]}
                                />
                              </Space>
                            ),
                          },
                          {
                            key: 'eval',
                            label: '评测结果',
                            children: (
                              <Space direction="vertical" style={{ width: '100%' }}>
                                <Alert
                                  type="info"
                                  showIcon
                                  message="Evaluation Agent · 评测结果（占位）"
                                  description="正式流程中由 Evaluation Agent 汇总验证/测试指标；当前为静态示意，完整评估在「评估与结果」步骤确认。"
                                />
                                <Descriptions bordered column={2} size="small">
                                  <Descriptions.Item label="accuracy">{pipeline?.metrics?.accuracy ?? '—'}</Descriptions.Item>
                                  <Descriptions.Item label="f1">{pipeline?.metrics?.f1 ?? '—'}</Descriptions.Item>
                                  <Descriptions.Item label="loss">{pipeline?.metrics?.loss ?? '—'}</Descriptions.Item>
                                  <Descriptions.Item label="状态">{pipeline?.status ?? '—'}</Descriptions.Item>
                                </Descriptions>
                              </Space>
                            ),
                          },
                        ]}
                      />
                    </Card>
                  </div>
                )}

                {step === 4 && !isTrainingExecutionView && (
                  <Space direction="vertical" style={{ width: '100%' }}>
                    <Alert
                      type="info"
                      message="执行阶段（Orchestrator 调度）"
                      description="确认计划后由你触发启动；随后 Training Executor 接管训练侧，右侧切换为分栏工作台。Evaluation Agent 在后续评估步骤介入。"
                    />
                    {runSpec?.plan_spec && (
                      <Card size="small" title="已确认计划（快照）" extra={<Tag color="success">已锁定</Tag>}>
                        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
                          以下为确认计划并继续后写入 run_spec 的配置，与右侧曾展示的「建议计划」对应；执行需单独发起。
                        </Typography.Paragraph>
                        <Descriptions bordered column={1} size="small">
                          <Descriptions.Item label="基座模型">{runSpec.plan_spec.base_model}</Descriptions.Item>
                          <Descriptions.Item label="训练方法">{runSpec.plan_spec.training_method}</Descriptions.Item>
                          <Descriptions.Item label="epochs">{runSpec.plan_spec.epochs}</Descriptions.Item>
                          <Descriptions.Item label="batch size">{runSpec.plan_spec.batch_size}</Descriptions.Item>
                          <Descriptions.Item label="learning rate">{runSpec.plan_spec.learning_rate}</Descriptions.Item>
                          <Descriptions.Item label="评估策略">{runSpec.plan_spec.eval_strategy}</Descriptions.Item>
                          <Descriptions.Item label="预期产出">
                            {(runSpec.plan_spec.expected_outputs || []).join('，')}
                          </Descriptions.Item>
                        </Descriptions>
                      </Card>
                    )}
                    <Card size="small" title="当前 Run 状态卡">
                      <Descriptions bordered column={1} size="small">
                        <Descriptions.Item label="run_id">{runSpec?.run_id || '-'}</Descriptions.Item>
                        <Descriptions.Item label="任务">{taskSpec ? `${taskSpec.domain} / ${taskSpec.semantic_task_type}` : '-'}</Descriptions.Item>
                        <Descriptions.Item label="数据">{selectedDataset?.name || '-'}</Descriptions.Item>
                        <Descriptions.Item label="方法">{planSpec.training_method || '-'}</Descriptions.Item>
                        <Descriptions.Item label="模型">{planSpec.base_model || '-'}</Descriptions.Item>
                        <Descriptions.Item label="当前阶段">{state}</Descriptions.Item>
                      </Descriptions>
                    </Card>
                    <Card size="small" title="Timeline（Run 全链路）">
                      <Timeline
                        items={[
                          {
                            color: taskDraft ? 'green' : 'gray',
                            children: taskDraft ? 'Planning：任务解析完成' : 'Planning：等待解析',
                          },
                          {
                            color:
                              state === 'data_ready' || pipeline?.orchestration_state === 'DATA_VALIDATED'
                                ? 'green'
                                : state === 'data_validating' || pipeline?.current_step === 'clean_data'
                                  ? 'blue'
                                  : 'gray',
                            children:
                              state === 'data_ready' || pipeline?.orchestration_state === 'DATA_VALIDATED'
                                ? 'Data Agent：数据就绪（清洗完成）'
                                : state === 'data_validating' || pipeline?.current_step === 'clean_data'
                                  ? 'Data Agent：数据清洗中'
                                  : 'Data Agent：等待清洗',
                          },
                          {
                            color:
                              state === 'training_succeeded'
                                ? 'green'
                                : state === 'training_running' || pipeline?.current_step === 'train'
                                  ? 'blue'
                                  : 'gray',
                            children:
                              state === 'training_succeeded'
                                ? 'Training Executor：训练完成'
                                : state === 'training_running' || pipeline?.current_step === 'train'
                                  ? 'Training Executor：训练中'
                                  : 'Training Executor：等待训练',
                          },
                          {
                            color: pipeline?.model_id ? 'blue' : 'gray',
                            children: pipeline?.model_id ? 'Training Executor：模型检查点已保存' : 'Training Executor：模型检查点（待生成）',
                          },
                          {
                            color:
                              state === 'done' || pipeline?.orchestration_state === 'COMPLETED'
                                ? 'green'
                                : state === 'evaluating' || pipeline?.current_step === 'evaluate'
                                  ? 'blue'
                                  : 'gray',
                            children:
                              state === 'done' || pipeline?.orchestration_state === 'COMPLETED'
                                ? 'Evaluation Agent：评估完成'
                                : state === 'evaluating' || pipeline?.current_step === 'evaluate'
                                  ? 'Evaluation Agent：评估中'
                                  : 'Evaluation Agent：等待评估',
                          },
                        ]}
                      />
                    </Card>
                    <Space wrap>
                      <Button
                        type="primary"
                        icon={<PlayCircleOutlined />}
                        loading={loading}
                        disabled={['data_validating', 'data_ready', 'training_queued', 'training_running', 'training_succeeded', 'evaluating', 'done'].includes(state)}
                        onClick={() => void startRun()}
                      >
                        启动执行
                      </Button>
                    </Space>
                  </Space>
                )}
                {step === 5 && (
                  <Space direction="vertical" style={{ width: '100%' }}>
                    <Card
                      size="small"
                      title={(
                        <Space size={8} align="center">
                          <span>评估确认</span>
                          <OrchAgentTag agentKey="eval" />
                        </Space>
                      )}
                    >
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
                    <Card
                      size="small"
                      title={(
                        <Space size={8} align="center">
                          <span>评估结果（Run 视图）</span>
                          <OrchAgentTag agentKey="eval" />
                        </Space>
                      )}
                    >
                      <Descriptions bordered column={2} size="small">
                        <Descriptions.Item label="评估状态">{evalConfirmed ? '已完成' : '待确认'}</Descriptions.Item>
                        <Descriptions.Item label="run_id">{runSpec?.run_id || '-'}</Descriptions.Item>
                        <Descriptions.Item label="accuracy">{pipeline?.metrics?.accuracy ?? '-'}</Descriptions.Item>
                        <Descriptions.Item label="f1">{pipeline?.metrics?.f1 ?? '-'}</Descriptions.Item>
                      </Descriptions>
                    </Card>
                  </Space>
                )}
              
              </div>
              </Card>
          </div>
        </div>
      </div>
      <Drawer
        title="MCP 侧信道 · 多 Agent（示例）"
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
                  renderItem={(evt) => {
                    const row = mcpEventToTrainExecutionRow(evt);
                    return (
                      <List.Item>
                        <div>
                          <Space size={6} wrap>
                            <Typography.Text strong>{row.agent}</Typography.Text>
                            <Typography.Text type="secondary">{row.mcpServer}</Typography.Text>
                            <Typography.Text code style={{ fontSize: 11 }}>{row.action}</Typography.Text>
                            <Tag
                              color={
                                row.status === 'success' ? 'success' : row.status === 'failed' ? 'error' : 'processing'
                              }
                            >
                              {row.status}
                            </Tag>
                          </Space>
                          <div style={{ marginTop: 4, fontSize: 12 }}>{row.outputSummary}</div>
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            {row.time}
                          </Typography.Text>
                        </div>
                      </List.Item>
                    );
                  }}
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
        title="重命名 Run"
        open={runListRenameOpen}
        okText="确定"
        cancelText="取消"
        onOk={() => {
          const t = runListRenameTitle.trim();
          if (!t || !runListRenameId) {
            setRunListRenameOpen(false);
            return;
          }
          setChatSessions((prev) =>
            prev.map((s) => (s.id === runListRenameId ? { ...s, title: t } : s))
          );
          setRunListRenameOpen(false);
          message.success('已更新标题');
        }}
        onCancel={() => setRunListRenameOpen(false)}
        destroyOnClose
      >
        <Input
          value={runListRenameTitle}
          onChange={(e) => setRunListRenameTitle(e.target.value)}
          placeholder="Run 标题"
          maxLength={120}
          showCount
        />
      </Modal>

      <Modal
        title="规划阶段时间线"
        open={planTimelineOpen}
        onCancel={() => setPlanTimelineOpen(false)}
        footer={null}
      >
        <Timeline
          items={[
            {
              color: flowModeConfirmed ? 'green' : 'gray',
              children: 'Orchestrator：已确认流程模式（全流程 / 仅训练 / 仅评估）',
            },
            {
              color: taxonomyConfirmed ? 'green' : 'gray',
              children: 'Planning Agent：已确认领域-类型-任务',
            },
            {
              color: chatMessages.some((m) => m.stage === 'plan_confirm') ? 'blue' : 'gray',
              children: 'Planning Agent：已输出建议/确认计划',
            },
            {
              color: mcpEvents.length > 0 ? 'blue' : 'gray',
              children: '多 Agent MCP 侧信道已接入数据控制台',
            },
          ]}
        />
      </Modal>
    </div>
  );
};

export default AgentCanvas;
