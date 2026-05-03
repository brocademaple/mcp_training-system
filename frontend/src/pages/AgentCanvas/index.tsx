import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Empty,
  Input,
  List,
  Select,
  Space,
  Spin,
  Steps,
  Tag,
  Tooltip,
  Typography,
  Upload,
  message,
} from 'antd';
import {
  InboxOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  RobotOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import type { UploadFile } from 'antd/es/upload/interface';
import { agentService, type DataAgentReport, type EvaluationAdvice, type IntentResolveResult } from '@/services/agent';
import { datasetService } from '@/services/dataset';
import { trainingService } from '@/services/training';
import { evaluationService } from '@/services/evaluation';
import { modelService } from '@/services/model';
import { mcpService, type MCPSessionEvent } from '@/services/mcp';
import { projectService } from '@/services/project';
import { LlmApiSettingsTrigger } from '@/components/LlmApiSettings';
import type { Dataset, Evaluation, Project, TrainingJob } from '@/types';
import './index.css';

const { Dragger } = Upload;

type LogSource = 'ai' | 'system' | 'user' | 'mcp';

interface LogEntry {
  id: string;
  source: LogSource;
  text: string;
  time: string;
  seq?: number;
  phase?: number;
  mcp?: MCPSessionEvent['mcp'];
}

interface StageMeta {
  title: string;
  desc: string;
}

const STAGES: StageMeta[] = [
  { title: '任务理解', desc: 'AI 分析你的任务' },
  { title: '数据分析', desc: 'AI 检查数据问题' },
  { title: '训练执行', desc: '系统运行模型' },
  { title: '结果分析', desc: 'AI 给优化建议' },
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function phaseLabel(phase: number): string {
  return `[阶段${phase + 1}]`;
}

function intentToCN(intent?: string): string {
  const v = (intent || '').toLowerCase();
  if (v.includes('sentiment')) return '情感分析';
  if (v.includes('summary')) return '文本摘要';
  if (v.includes('ner')) return '命名实体识别';
  if (v.includes('class')) return '文本分类';
  if (v.includes('extract')) return '信息抽取';
  return '通用文本任务';
}

function formatRatio(value?: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  return `${(n * 100).toFixed(2)}%`;
}

function domainToCN(domain?: string): string {
  const v = (domain || '').toLowerCase();
  if (v.includes('finance') || v.includes('financial')) return '金融';
  if (v.includes('medical') || v.includes('health')) return '医疗';
  if (v.includes('edu')) return '教育';
  if (v.includes('retail') || v.includes('ecommerce')) return '零售';
  if (v.includes('legal')) return '法务';
  return '通用';
}

function formatTaskNameByDate(existing: Project[]): string {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const prefix = `${yy}${mm}${dd}-`;
  const seq = existing.reduce((max, p) => {
    if (!p.name.startsWith(prefix)) return max;
    const n = Number(p.name.slice(prefix.length));
    if (!Number.isFinite(n)) return max;
    return Math.max(max, n);
  }, 0);
  return `${prefix}${seq + 1}`;
}

function sessionEventToLogEntry(ev: MCPSessionEvent): LogEntry {
  const ph = ev.phase ?? 0;
  const tag = `${phaseLabel(ph)} `;
  const t = ev.ts
    ? new Date(ev.ts).toLocaleTimeString('zh-CN', { hour12: false })
    : new Date().toLocaleTimeString('zh-CN', { hour12: false });
  if (ev.kind === 'mcp' && ev.mcp) {
    const m = ev.mcp;
    const preview = m.payload_preview
      ? m.payload_preview.length > 160
        ? `${m.payload_preview.slice(0, 160)}…`
        : m.payload_preview
      : '';
    return {
      id: `srv-${ev.seq}`,
      source: 'mcp',
      text: `${tag}${m.type} ${m.from}→${m.to} action=${m.action}${preview ? ` · ${preview}` : ''}`,
      time: t,
      seq: ev.seq,
      phase: ph,
      mcp: m,
    };
  }
  if (ev.kind === 'user') {
    return { id: `srv-${ev.seq}`, source: 'user', text: `${tag}${(ev.text || '').trim()}`, time: t, seq: ev.seq, phase: ph };
  }
  return { id: `srv-${ev.seq}`, source: 'system', text: `${tag}${(ev.text || '').trim()}`, time: t, seq: ev.seq, phase: ph };
}

const AgentCanvas: React.FC = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectLoading, setProjectLoading] = useState(false);
  const [projectCreating, setProjectCreating] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [sessionId, setSessionId] = useState('');

  const [goal, setGoal] = useState('');
  const [taskType, setTaskType] = useState('text_classification');
  const [textColumn, setTextColumn] = useState('text');
  const [intent, setIntent] = useState<IntentResolveResult | null>(null);
  const [intentLoading, setIntentLoading] = useState(false);

  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [datasetLoading, setDatasetLoading] = useState(false);
  const [selectedDatasetId, setSelectedDatasetId] = useState<number | null>(null);
  const [dataReport, setDataReport] = useState<DataAgentReport | null>(null);
  const [dataAnalyzing, setDataAnalyzing] = useState(false);
  const [uploadFileList, setUploadFileList] = useState<UploadFile[]>([]);
  const [uploading, setUploading] = useState(false);

  const [trainingJob, setTrainingJob] = useState<TrainingJob | null>(null);
  const [trainingStarting, setTrainingStarting] = useState(false);
  const [modelId, setModelId] = useState<number | null>(null);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [evaluationAdvice, setEvaluationAdvice] = useState<EvaluationAdvice | null>(null);
  const [adviceLoading, setAdviceLoading] = useState(false);
  const [agentPreset, setAgentPreset] = useState<{ metric: string; learning_rate: number; batch_size: number; epochs: number } | null>(null);

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [stageIndex, setStageIndex] = useState(0);
  const [stageComplete, setStageComplete] = useState<[boolean, boolean, boolean, boolean]>([false, false, false, false]);

  const trainingStatusRef = useRef('');
  const evalStatusRef = useRef('');
  const adviceFetchedRef = useRef<number | null>(null);
  const loadedReportDatasetRef = useRef<number | null>(null);
  const resolvedGoalRef = useRef('');
  const stageIndexRef = useRef(0);
  const lastEventSeqRef = useRef(0);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  const appendLocalLog = (source: LogSource, text: string, phase?: number) => {
    const ph = phase ?? stageIndexRef.current;
    setLogs((prev) =>
      [
        ...prev,
        {
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          source,
          text: `${phaseLabel(ph)} ${text}`,
          time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
          phase: ph,
        },
      ].slice(-300)
    );
  };

  const pushUser = async (phase: number, plainMessage: string) => {
    appendLocalLog('user', plainMessage, phase);
    if (!sessionId) return;
    try {
      await mcpService.postUserEvent(sessionId, phase, plainMessage);
    } catch {
      // keep local only
    }
  };

  const invalidateFrom = (fromInclusive: number, systemNote?: string) => {
    setStageComplete((prev) => {
      const n: [boolean, boolean, boolean, boolean] = [...prev];
      for (let i = fromInclusive; i < 4; i += 1) n[i] = false;
      return n;
    });
    if (systemNote) appendLocalLog('system', systemNote, Math.max(0, fromInclusive - 1));
  };

  const ensureDefaultProject = async () => {
    const listed = await projectService.list();
    const arr = listed.data?.projects ?? [];
    if (arr.length > 0) return arr;
    const created = await projectService.create({ name: formatTaskNameByDate(arr), description: '自动创建的首个任务' });
    return [created.data as Project];
  };

  const refreshProjects = async () => {
    setProjectLoading(true);
    try {
      const arr = await ensureDefaultProject();
      setProjects(arr);
      const chosen = selectedProjectId != null ? arr.find((p) => p.id === selectedProjectId) : arr[0];
      if (chosen) {
        setSelectedProjectId(chosen.id);
        setSessionId(chosen.session_root);
        window.localStorage.setItem('mcp_session_id', chosen.session_root);
      }
    } catch (err: any) {
      message.error(err.message || '加载项目失败');
    } finally {
      setProjectLoading(false);
    }
  };

  const refreshDatasets = async () => {
    setDatasetLoading(true);
    try {
      const res = await datasetService.getDatasets('training');
      const list = res.data?.datasets ?? [];
      setDatasets(list);
      if (selectedDatasetId != null && !list.some((d) => d.id === selectedDatasetId)) {
        setSelectedDatasetId(null);
        setDataReport(null);
      }
    } catch (err: any) {
      message.error(err.message || '获取数据集失败');
    } finally {
      setDatasetLoading(false);
    }
  };

  useEffect(() => {
    void refreshProjects();
    void refreshDatasets();
    appendLocalLog('system', 'Agent 工作台已就绪。请选择项目并开始流程。', 0);
  }, []);

  useEffect(() => {
    stageIndexRef.current = stageIndex;
  }, [stageIndex]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [logs]);

  useEffect(() => {
    if (!sessionId) return undefined;
    lastEventSeqRef.current = 0;
    setLogs([]);
    const es = new EventSource(mcpService.buildSessionEventsStreamUrl(sessionId, 0));
    es.addEventListener('session-events', (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data || '{}') as { events?: MCPSessionEvent[]; next_after?: number };
        const events = data.events || [];
        if (events.length === 0) return;
        setLogs((prev) => {
          const seen = new Set(prev.filter((x) => x.seq != null).map((x) => x.seq as number));
          const next: LogEntry[] = [...prev];
          for (const ev of events) {
            if (seen.has(ev.seq)) continue;
            seen.add(ev.seq);
            next.push(sessionEventToLogEntry(ev));
          }
          return next.slice(-300);
        });
        if (typeof data.next_after === 'number') lastEventSeqRef.current = data.next_after;
      } catch {
        // ignore malformed chunk
      }
    });
    es.onerror = () => {
      // EventSource auto reconnect
    };
    return () => es.close();
  }, [sessionId]);

  useEffect(() => {
    if (!trainingJob?.id) return;
    if (trainingJob.status !== 'queued' && trainingJob.status !== 'running') return;
    const timer = window.setInterval(async () => {
      try {
        const res = await trainingService.getJobStatus(trainingJob.id);
        const next = res.data as TrainingJob | undefined;
        if (!next) return;
        setTrainingJob(next);
        if (trainingStatusRef.current !== next.status) trainingStatusRef.current = next.status;
      } catch {
        // silent
      }
    }, 2500);
    return () => window.clearInterval(timer);
  }, [trainingJob?.id, trainingJob?.status]);

  useEffect(() => {
    if (!trainingJob || trainingJob.status !== 'completed' || modelId != null) return;
    void (async () => {
      try {
        const res = await modelService.getModels();
        const found = (res.data?.models ?? []).find((m) => m.job_id === trainingJob.id);
        if (found) setModelId(found.id);
      } catch {
        // ignore
      }
    })();
  }, [trainingJob, modelId]);

  useEffect(() => {
    if (!modelId) return;
    const timer = window.setInterval(async () => {
      try {
        const res = await evaluationService.getEvaluations(selectedProjectId ?? undefined);
        const all = res.data?.evaluations ?? [];
        const candidates = all.filter((e) => e.model_id === modelId);
        if (candidates.length === 0) return;
        candidates.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
        const latest = candidates[0];
        setEvaluation(latest);
        const st = latest.status || '';
        if (evalStatusRef.current !== st) evalStatusRef.current = st;
      } catch {
        // ignore
      }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [modelId, selectedProjectId]);

  useEffect(() => {
    if (!evaluation?.id) return;
    if (!evaluation.status || !['completed', 'failed', 'cancelled'].includes(evaluation.status)) return;
    if (adviceFetchedRef.current === evaluation.id) return;
    adviceFetchedRef.current = evaluation.id;
    setAdviceLoading(true);
    void agentService
      .getEvaluationAdvice(evaluation.id)
      .then((advice) => {
        setEvaluationAdvice(advice);
        appendLocalLog('ai', advice.summary || 'Evaluation Agent 已生成结果解释。', 3);
      })
      .catch((err: any) => message.error(err.message || '获取结果分析失败'))
      .finally(() => setAdviceLoading(false));
  }, [evaluation]);

  useEffect(() => {
    if (trainingJob?.status === 'completed') {
      setStageComplete((s) => {
        const n: [boolean, boolean, boolean, boolean] = [...s];
        n[2] = true;
        return n;
      });
    }
  }, [trainingJob?.status]);

  useEffect(() => {
    if (evaluationAdvice) {
      setStageComplete((s) => {
        const n: [boolean, boolean, boolean, boolean] = [...s];
        n[3] = true;
        return n;
      });
    }
  }, [evaluationAdvice]);

  useEffect(() => {
    if (!selectedDatasetId) {
      setDataReport(null);
      loadedReportDatasetRef.current = null;
      return;
    }
    void (async () => {
      try {
        const cached = await agentService.getDatasetReport(selectedDatasetId);
        if (cached) {
          setDataReport(cached);
          setStageComplete((s) => {
            const n: [boolean, boolean, boolean, boolean] = [...s];
            n[1] = true;
            return n;
          });
          if (loadedReportDatasetRef.current !== selectedDatasetId) {
            appendLocalLog('system', '已加载历史数据分析结果。', 1);
            loadedReportDatasetRef.current = selectedDatasetId;
          }
        }
      } catch {
        // silent
      }
    })();
  }, [selectedDatasetId]);


  const handleResolveIntent = async () => {
    const g = goal.trim();
    if (!g) {
      message.warning('请先填写任务目标');
      return;
    }
    setIntentLoading(true);
    try {
      const payload = `${g}。任务类型=${taskType}。文本字段=${textColumn}`;
      const result = await agentService.resolveIntent(payload);
      setIntent(result);
      resolvedGoalRef.current = g;
      setStageComplete((s) => {
        const n: [boolean, boolean, boolean, boolean] = [...s];
        n[0] = true;
        return n;
      });
      appendLocalLog('ai', `识别任务类型：${intentToCN(result.inferred_intent)}（置信度 ${result.confidence}）`, 0);
      if (result.message) appendLocalLog('ai', result.message, 0);
      if (selectedProjectId) {
        const renamed = `${domainToCN(result.domain_hint)}-${intentToCN(result.inferred_intent)}`;
        try {
          const patched = await projectService.patch(selectedProjectId, { name: renamed });
          const np = patched.data as Project;
          setProjects((prev) => prev.map((p) => (p.id === np.id ? np : p)));
          appendLocalLog('system', `任务理解完成，任务自动命名为「${renamed}」。`, 0);
        } catch {
          // rename best-effort
        }
      }
      message.success('任务理解完成');
    } catch (err: any) {
      message.error(err.message || '任务理解失败');
    } finally {
      setIntentLoading(false);
    }
  };

  const handleUploadDataset = async () => {
    if (uploadFileList.length === 0) {
      message.warning('请先选择文件');
      return;
    }
    const fileObj = uploadFileList[0].originFileObj as File | undefined;
    if (!fileObj) {
      message.warning('文件无效');
      return;
    }
    setUploading(true);
    try {
      const name = uploadFileList[0].name.replace(/\.[^/.]+$/, '') || `dataset_${Date.now()}`;
      const res = await datasetService.uploadDataset(fileObj, name, 'text', 'training', sessionId);
      const datasetId = res.data?.dataset_id;
      if (!datasetId) throw new Error('上传成功但未返回 dataset_id');
      void pushUser(1, `上传数据集并提交处理（dataset_id=${datasetId}）`);
      appendLocalLog('system', `数据集上传成功（dataset_id=${datasetId}），正在清洗。`, 1);
      setUploadFileList([]);
      setSelectedDatasetId(datasetId);
      for (let i = 0; i < 45; i += 1) {
        await sleep(2000);
        const detail = await datasetService.getDatasetDetail(datasetId);
        const status = detail.data?.status;
        if (status === 'ready') {
          appendLocalLog('system', '数据清洗完成，可执行数据分析。', 1);
          await refreshDatasets();
          message.success('数据集已就绪');
          setUploading(false);
          return;
        }
        if (status === 'error') {
          const errMsg = detail.data?.error_message || '数据清洗失败';
          appendLocalLog('system', `数据处理失败：${errMsg}`, 1);
          throw new Error(errMsg);
        }
      }
      await refreshDatasets();
      message.info('数据仍在处理，可稍后刷新后选择。');
    } catch (err: any) {
      message.error(err.message || '上传失败');
    } finally {
      setUploading(false);
    }
  };

  const handleRunDataAnalysis = async () => {
    if (!selectedDatasetId) {
      message.warning('请先选择 ready 数据集');
      return;
    }
    setDataAnalyzing(true);
    try {
      const report = await agentService.analyzeDataset(selectedDatasetId);
      setDataReport(report);
      setStageComplete((s) => {
        const n: [boolean, boolean, boolean, boolean] = [...s];
        n[1] = true;
        return n;
      });
      appendLocalLog('ai', `识别任务类型：${intentToCN(report.task_type)}`, 1);
      if (Array.isArray(report.issues) && report.issues.length > 0) appendLocalLog('ai', `检测到数据问题：${report.issues.join('、')}`, 1);
      appendLocalLog('ai', report.summary || 'Data Agent 已完成分析。', 1);
      message.success('数据分析完成');
    } catch (err: any) {
      message.error(err.message || '数据分析失败');
    } finally {
      setDataAnalyzing(false);
    }
  };

  const handleStartTraining = async () => {
    if (!selectedDatasetId) {
      message.warning('请先选择数据集');
      return;
    }
    setTrainingStarting(true);
    try {
      const modelType = intent?.train_mode === 'sft_lora' ? 'sft_finetune' : 'text_classification';
      const hyperparams = agentPreset || { learning_rate: 0.00002, batch_size: 16, epochs: 3, metric: 'f1' };
      const res = await trainingService.createJob({
        project_id: selectedProjectId ?? undefined,
        session_id: sessionId,
        dataset_id: selectedDatasetId,
        model_type: modelType,
        name: `agent-workflow-${Date.now()}`,
        hyperparams: { learning_rate: hyperparams.learning_rate, batch_size: hyperparams.batch_size, epochs: hyperparams.epochs, metric: hyperparams.metric, text_column: textColumn },
      });
      const jobId = (res.data as any)?.job_id;
      if (!jobId) throw new Error('训练任务创建失败');
      setTrainingJob({
        id: jobId,
        user_id: 1,
        project_id: selectedProjectId,
        dataset_id: selectedDatasetId,
        model_type: modelType,
        hyperparams: { learning_rate: hyperparams.learning_rate, batch_size: hyperparams.batch_size, epochs: hyperparams.epochs, metric: hyperparams.metric, text_column: textColumn },
        status: 'queued',
        progress: 0,
        current_epoch: 0,
        total_epochs: hyperparams.epochs,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as TrainingJob);
      setModelId(null);
      setEvaluation(null);
      setEvaluationAdvice(null);
      adviceFetchedRef.current = null;
      trainingStatusRef.current = 'queued';
      evalStatusRef.current = '';
      void pushUser(2, '点击「开始训练」提交训练任务');
      appendLocalLog('system', '训练任务已提交；MCP 编排消息见右侧流式日志。', 2);
      message.success('训练已启动');
    } catch (err: any) {
      message.error(err.message || '训练启动失败');
    } finally {
      setTrainingStarting(false);
    }
  };

  const createProject = async () => {
    const name = projectName.trim() || formatTaskNameByDate(projects);
    setProjectCreating(true);
    try {
      const res = await projectService.create({ name });
      const p = res.data as Project;
      setProjectName('');
      setProjects((prev) => [p, ...prev]);
      setSelectedProjectId(p.id);
      setSessionId(p.session_root);
      window.localStorage.setItem('mcp_session_id', p.session_root);
      setStageComplete([false, false, false, false]);
      setStageIndex(0);
      setLogs([]);
      void pushUser(0, `创建新项目「${p.name}」`);
      message.success('任务已创建');
    } catch (err: any) {
      message.error(err.message || '创建项目失败');
    } finally {
      setProjectCreating(false);
    }
  };

  const switchProject = (project: Project) => {
    if (selectedProjectId === project.id) return;
    setSelectedProjectId(project.id);
    setSessionId(project.session_root);
    window.localStorage.setItem('mcp_session_id', project.session_root);
    setStageIndex(0);
    setStageComplete([false, false, false, false]);
    setTrainingJob(null);
    setEvaluation(null);
    setEvaluationAdvice(null);
    setModelId(null);
    setLogs([]);
    lastEventSeqRef.current = 0;
    void pushUser(0, `切换到项目「${project.name}」`);
  };

  const goNext = () => {
    if (!stageComplete[stageIndex]) {
      message.warning('请先完成当前阶段（满足门闩）后再进入下一步。');
      return;
    }
    void pushUser(stageIndex, `从「${STAGES[stageIndex].title}」进入下一步`);
    setStageIndex((i) => Math.min(STAGES.length - 1, i + 1));
  };

  const goPrev = () => {
    if (stageIndex <= 0) return;
    const target = stageIndex - 1;
    void pushUser(stageIndex, `从「${STAGES[stageIndex].title}」返回上一步`);
    appendLocalLog(
      'system',
      `返回至「${STAGES[target].title}」。后续阶段在服务器上的训练/评估记录仍保留（软回退）；若曾修改上游输入，下游完成标记可能已失效。`,
      target
    );
    setStageIndex(target);
  };

  const readyDatasets = useMemo(() => datasets.filter((d) => d.status === 'ready'), [datasets]);

  useEffect(() => {
    const rows = dataReport?.stats?.row_count ?? 0;
    const big = rows >= 50000;
    const low = rows > 0 && rows < 3000;
    const metric = taskType === 'sentiment_analysis' || taskType === 'text_classification' ? 'f1' : 'accuracy';
    setAgentPreset({
      metric,
      learning_rate: taskType === 'named_entity_recognition' ? 0.00001 : 0.00002,
      batch_size: low ? 8 : big ? 32 : 16,
      epochs: low ? 8 : 3,
    });
  }, [taskType, dataReport?.stats?.row_count]);
  const stepItems = useMemo(
    () =>
      STAGES.map((s, i) => {
        let status: 'wait' | 'process' | 'finish' = 'wait';
        if (stageComplete[i]) status = 'finish';
        else if (i === stageIndex) status = 'process';
        return { title: s.title, description: s.desc, status };
      }),
    [stageIndex, stageComplete]
  );

  const selectedProject = projects.find((p) => p.id === selectedProjectId) || null;

  return (
    <div className="agent-workbench-page">
      <div className="agent-workbench-bg" />
      <div className="agent-workbench">
        <Card className="agent-project-panel" title="任务列表" bordered={false}>
          <Space direction="vertical" style={{ width: '100%' }}>
            <Space.Compact style={{ width: '100%' }}>
              <Input
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="可自定义任务名称（默认自动生成）"
              />
            </Space.Compact>
            <Space>
              <Tooltip title="创建新任务块">
                <Button type="primary" icon={<PlusOutlined />} loading={projectCreating} onClick={createProject} />
              </Tooltip>
              <Tooltip title="刷新任务列表">
                <Button icon={<ReloadOutlined />} onClick={() => void refreshProjects()} loading={projectLoading} />
              </Tooltip>
              <Tooltip title="API 配置">
                <LlmApiSettingsTrigger />
              </Tooltip>
            </Space>
            <List
              size="small"
              dataSource={projects}
              locale={{ emptyText: '暂无项目' }}
              renderItem={(item) => (
                <List.Item
                  className={item.id === selectedProjectId ? 'agent-project-item active' : 'agent-project-item'}
                  onClick={() => switchProject(item)}
                >
                  <div>
                    <Typography.Text strong>{item.name}</Typography.Text>
                    <div className="agent-log-time">session: {item.session_root.slice(0, 8)}...</div>
                  </div>
                </List.Item>
              )}
            />
          </Space>
        </Card>

        <div className="agent-workbench-main">
          <Card className="agent-hero" bordered={false}>
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <Space align="center" size={8} style={{ justifyContent: 'space-between', width: '100%' }}>
                <Space align="center" size={8}>
                  <RobotOutlined style={{ color: '#0f766e' }} />
                  <Typography.Title level={4} style={{ margin: 0 }}>
                    AI 增强训练工作台
                  </Typography.Title>
                  <Tag color="blue">Agent 版</Tag>
                  {selectedProject && <Tag color="geekblue">{selectedProject.name}</Tag>}
                </Space>
                <Button
                  icon={<SwapOutlined />}
                  onClick={() => {
                    window.localStorage.setItem('app-version', 'classic');
                    window.location.href = '/';
                  }}
                >
                  切换到经典版
                </Button>
              </Space>
              <Typography.Text type="secondary">
                Agent 版：在 MCP 协调下完成意图理解、数据诊断、流水线策划与执行，并生成评估解释。经典版：维护数据集与训练/评估任务的操作面，数据与 Agent 版同源；后续可通过 MCP 服务将经典侧沉淀的数据暴露给 Agent 使用（接入方式可自行设计）。
              </Typography.Text>
            </Space>
          </Card>

          <Card className="agent-stage-card" title="流程阶段" bordered={false}>
            <Steps current={stageIndex} items={stepItems} />
          </Card>

          <Card
            className="agent-stage-card agent-wizard-card"
            title={STAGES[stageIndex].title}
            bordered={false}
            extra={<Typography.Text type="secondary">步骤 {stageIndex + 1} / {STAGES.length}</Typography.Text>}
          >
            {stageIndex === 0 && (
              <Space direction="vertical" style={{ width: '100%' }} size="middle">
                <Card size="small" title="任务理解（面向新手）">
                  <Space direction="vertical" style={{ width: '100%' }}>
                    <Input
                      value={goal}
                      onChange={(e) => {
                        const v = e.target.value;
                        setGoal(v);
                        if (intent && resolvedGoalRef.current && v.trim() !== resolvedGoalRef.current) {
                          invalidateFrom(1, '任务目标已变更：数据分析及之后阶段完成标记已清除。');
                          void pushUser(0, '调整了任务目标文本（与已确认意图不一致）');
                        }
                      }}
                      placeholder="一句话任务目标（例如：识别金融客服对话中的负向反馈）"
                    />
                    <Space wrap>
                      <Select
                        style={{ width: 190 }}
                        value={taskType}
                        onChange={(v) => setTaskType(v)}
                        options={[
                          { value: 'text_classification', label: '文本分类' },
                          { value: 'sentiment_analysis', label: '情感分析' },
                          { value: 'named_entity_recognition', label: '实体识别' },
                          { value: 'summarization', label: '文本摘要' },
                        ]}
                      />
                      <Input style={{ width: 180 }} value={textColumn} onChange={(e) => setTextColumn(e.target.value)} placeholder="文本列名（默认 text）" />
                    </Space>
                    <Alert type="info" showIcon message="样本规模、评估指标、约束变量将在数据上传后由 Agent 自动生成并用于训练/评测。" />
                  </Space>
                </Card>

                <Button type="primary" loading={intentLoading} onClick={() => void handleResolveIntent()}>
                  AI 理解任务
                </Button>
                {intent && (
                  <Descriptions size="small" column={2} bordered>
                    <Descriptions.Item label="推断任务">{intentToCN(intent.inferred_intent)}</Descriptions.Item>
                    <Descriptions.Item label="建议训练模式">{intent.train_mode}</Descriptions.Item>
                    <Descriptions.Item label="领域提示">{intent.domain_hint || '-'}</Descriptions.Item>
                    <Descriptions.Item label="置信度">{intent.confidence}</Descriptions.Item>
                  </Descriptions>
                )}
              </Space>
            )}

            {stageIndex === 1 && (
              <Space direction="vertical" style={{ width: '100%' }} size="middle">
                <Card size="small" title="上传训练数据">
                  <Space direction="vertical" style={{ width: '100%' }}>
                    <Dragger
                      maxCount={1}
                      accept=".csv,.json,.jsonl"
                      fileList={uploadFileList}
                      beforeUpload={() => false}
                      onChange={(info) => setUploadFileList(info.fileList)}
                    >
                      <p className="ant-upload-drag-icon">
                        <InboxOutlined />
                      </p>
                      <p className="ant-upload-text">拖拽或点击上传数据文件</p>
                      <p className="ant-upload-hint">支持 CSV / JSON / JSONL</p>
                    </Dragger>
                    <Space>
                      <Button onClick={() => void handleUploadDataset()} loading={uploading}>
                        上传并处理数据
                      </Button>
                      <Button onClick={() => void refreshDatasets()} loading={datasetLoading}>
                        刷新数据集
                      </Button>
                    </Space>
                  </Space>
                </Card>

                <Space align="center" wrap>
                  <span>选择 ready 数据集：</span>
                  <Select
                    style={{ minWidth: 320 }}
                    placeholder="请选择"
                    value={selectedDatasetId ?? undefined}
                    onChange={(v) => {
                      const prev = selectedDatasetId;
                      setSelectedDatasetId(v);
                      setDataReport(null);
                      if (prev != null && prev !== v) {
                        invalidateFrom(2, '上游数据集已切换：训练与结果分析完成标记已清除；已提交远端任务未删除（软回退）。');
                        void pushUser(1, `将所选数据集由 ID ${prev} 修改为 ID ${v}`);
                      }
                    }}
                    options={readyDatasets.map((d) => ({ value: d.id, label: `${d.name} (ID:${d.id})` }))}
                  />
                  <Button type="primary" onClick={() => void handleRunDataAnalysis()} loading={dataAnalyzing} disabled={!selectedDatasetId}>
                    执行数据分析
                  </Button>
                  <Button
                    onClick={async () => {
                      if (!selectedDatasetId) return;
                      const cached = await agentService.getDatasetReport(selectedDatasetId);
                      if (cached) {
                        setDataReport(cached);
                        setStageComplete((s) => {
                          const n: [boolean, boolean, boolean, boolean] = [...s];
                          n[1] = true;
                          return n;
                        });
                        appendLocalLog('system', '已读取历史数据分析结果。', 1);
                      } else {
                        message.info('该数据集暂无历史分析结果');
                      }
                    }}
                    disabled={!selectedDatasetId}
                  >
                    读取历史结果
                  </Button>
                </Space>

                {readyDatasets.length === 0 && !datasetLoading && (
                  <Alert type="info" showIcon message="暂无 ready 数据集，请先上传并等待处理完成。" />
                )}

                {dataReport && (
                  <Card size="small" title="Data Agent 结构化结果" className="agent-structured-card">
                    <Descriptions size="small" bordered column={2}>
                      <Descriptions.Item label="任务类型">{intentToCN(dataReport.task_type)}</Descriptions.Item>
                      <Descriptions.Item label="置信度">{Number(dataReport.confidence || 0).toFixed(2)}</Descriptions.Item>
                      <Descriptions.Item label="可训练性">{dataReport.trainability || '-'}</Descriptions.Item>
                      <Descriptions.Item label="可靠性">{dataReport.reliability || '-'}</Descriptions.Item>
                      <Descriptions.Item label="样本量">{dataReport.stats?.row_count ?? '-'}</Descriptions.Item>
                      <Descriptions.Item label="空文本比例">{formatRatio(dataReport.stats?.empty_text_ratio)}</Descriptions.Item>
                      <Descriptions.Item label="重复比例">{formatRatio(dataReport.stats?.duplicate_ratio)}</Descriptions.Item>
                      <Descriptions.Item label="解释来源">{dataReport.explanation_source || 'rule'}</Descriptions.Item>
                    </Descriptions>
                    <div className="agent-list-block">
                      <Typography.Text strong>主要问题</Typography.Text>
                      {dataReport.issues?.length ? (
                        <List size="small" dataSource={dataReport.issues} renderItem={(item) => <List.Item>{item}</List.Item>} />
                      ) : (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未识别到显著问题" />
                      )}
                    </div>
                    <div className="agent-list-block">
                      <Typography.Text strong>建议</Typography.Text>
                      <List size="small" dataSource={dataReport.recommendations || []} renderItem={(item) => <List.Item>{item}</List.Item>} />
                    </div>
                    <Alert type="success" showIcon message={dataReport.summary || '数据分析已完成'} />
                  </Card>
                )}
                {agentPreset && (
                  <Card size="small" title="Agent 生成的训练变量">
                    <Descriptions size="small" bordered column={2}>
                      <Descriptions.Item label="目标指标">{agentPreset.metric}</Descriptions.Item>
                      <Descriptions.Item label="学习率">{agentPreset.learning_rate}</Descriptions.Item>
                      <Descriptions.Item label="Batch Size">{agentPreset.batch_size}</Descriptions.Item>
                      <Descriptions.Item label="Epochs">{agentPreset.epochs}</Descriptions.Item>
                    </Descriptions>
                  </Card>
                )}
              </Space>
            )}

            {stageIndex === 2 && (
              <Space direction="vertical" style={{ width: '100%' }}>
                <Alert type="info" showIcon message="训练由系统脚本执行，不做 Agent 自动调参。" description="Data/Evaluation 才是 Agent 能力点，训练执行保持稳定主线。" />
                <Button type="primary" icon={<PlayCircleOutlined />} onClick={() => void handleStartTraining()} loading={trainingStarting} disabled={!selectedDatasetId}>
                  开始训练
                </Button>
                {trainingJob && (
                  <Descriptions size="small" bordered column={2}>
                    <Descriptions.Item label="训练任务 ID">{trainingJob.id}</Descriptions.Item>
                    <Descriptions.Item label="状态">{trainingJob.status}</Descriptions.Item>
                    <Descriptions.Item label="进度">{trainingJob.progress}%</Descriptions.Item>
                    <Descriptions.Item label="当前轮次">
                      {trainingJob.current_epoch}/{trainingJob.total_epochs}
                    </Descriptions.Item>
                    <Descriptions.Item label="模型 ID">{modelId ?? '-'}</Descriptions.Item>
                    <Descriptions.Item label="错误信息">{trainingJob.error_message || '-'}</Descriptions.Item>
                  </Descriptions>
                )}
              </Space>
            )}

            {stageIndex === 3 && (
              <Space direction="vertical" style={{ width: '100%' }}>
                {evaluation ? (
                  <Descriptions size="small" bordered column={2}>
                    <Descriptions.Item label="评估 ID">{evaluation.id}</Descriptions.Item>
                    <Descriptions.Item label="评估状态">{evaluation.status || '-'}</Descriptions.Item>
                    <Descriptions.Item label="Accuracy">{(evaluation.accuracy ?? 0).toFixed(4)}</Descriptions.Item>
                    <Descriptions.Item label="F1">{(evaluation.f1_score ?? 0).toFixed(4)}</Descriptions.Item>
                    <Descriptions.Item label="Precision">{(evaluation.precision ?? 0).toFixed(4)}</Descriptions.Item>
                    <Descriptions.Item label="Recall">{(evaluation.recall ?? 0).toFixed(4)}</Descriptions.Item>
                  </Descriptions>
                ) : (
                  <Alert type="warning" showIcon message="等待评估结果..." />
                )}
                {adviceLoading && <Spin tip="Evaluation Agent 正在生成建议..." />}
                {evaluationAdvice && (
                  <Card size="small" title="Evaluation Agent 建议" className="agent-structured-card">
                    <Space direction="vertical" style={{ width: '100%' }}>
                      <Tag color={evaluationAdvice.effect === 'good' ? 'success' : evaluationAdvice.effect === 'poor' ? 'error' : 'processing'}>
                        {evaluationAdvice.effect || 'fair'}
                      </Tag>
                      <Alert type="info" showIcon message={evaluationAdvice.summary || '已生成结果解释'} />
                      <div className="agent-list-block">
                        <Typography.Text strong>可能问题</Typography.Text>
                        <List size="small" dataSource={evaluationAdvice.possible_issues || []} renderItem={(item) => <List.Item>{item}</List.Item>} />
                      </div>
                      <div className="agent-list-block">
                        <Typography.Text strong>下一步建议</Typography.Text>
                        <List size="small" dataSource={evaluationAdvice.recommendations || []} renderItem={(item) => <List.Item>{item}</List.Item>} />
                      </div>
                    </Space>
                  </Card>
                )}
              </Space>
            )}

            <div className="agent-wizard-footer">
              <Space>
                <Button disabled={stageIndex <= 0} onClick={goPrev}>
                  上一步
                </Button>
                <Tooltip title={!stageComplete[stageIndex] ? '请先完成当前阶段（例如任务理解需先点击“AI 理解任务”）' : ''}>
                  <span>
                    <Button type="primary" disabled={stageIndex >= STAGES.length - 1 || !stageComplete[stageIndex]} onClick={goNext}>
                      下一步
                    </Button>
                  </span>
                </Tooltip>
              </Space>
            </div>
          </Card>
        </div>

        <Card className="agent-workbench-log" title="运行日志" bordered={false}>
          <List
            dataSource={logs}
            locale={{ emptyText: '暂无日志' }}
            renderItem={(item) => (
              <List.Item>
                <div className="agent-log-item">
                  <Space size={8} align="start">
                    <Tag color={item.source === 'ai' ? 'blue' : item.source === 'mcp' ? 'purple' : item.source === 'user' ? 'gold' : 'green'}>
                      {item.source === 'ai' ? '[AI]' : item.source === 'mcp' ? '[MCP]' : item.source === 'user' ? '[用户]' : '[系统]'}
                    </Tag>
                    <div>
                      <Typography.Text style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{item.text}</Typography.Text>
                      <div className="agent-log-time">{item.time}</div>
                    </div>
                  </Space>
                </div>
              </List.Item>
            )}
          />
          <div ref={logEndRef} />
        </Card>
      </div>
    </div>
  );
};

export default AgentCanvas;


