import React, { useEffect, useRef, useState } from 'react';
import {
  Card,
  Table,
  Button,
  Modal,
  Form,
  Input,
  Select,
  InputNumber,
  message,
  Tag,
  Progress,
  Tooltip,
  Steps,
  Spin,
  Popconfirm,
} from 'antd';
import { PlusOutlined, ReloadOutlined, EyeOutlined, RedoOutlined, DeleteOutlined, SyncOutlined, StopOutlined } from '@ant-design/icons';
import { trainingService } from '@/services/training';
import { datasetService } from '@/services/dataset';
import type { TrainingJob, Dataset } from '@/types';

type StepStatus = 'wait' | 'process' | 'finish' | 'error';

const TrainingManagement: React.FC = () => {
  const [jobs, setJobs] = useState<TrainingJob[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [loading, setLoading] = useState(false);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [progressModalJobId, setProgressModalJobId] = useState<number | null>(null);
  const [form] = Form.useForm();
  const wsRefs = useRef<Record<number, WebSocket>>({});

  useEffect(() => {
    fetchDatasets();
    fetchJobs();
  }, []);

  // 即时更新：存在「排队中」或「训练中」时每 4 秒静默拉取一次列表，便于看到状态变为失败/完成
  useEffect(() => {
    const hasPending = jobs.some((j) => j.status === 'queued' || j.status === 'running');
    if (!hasPending) return;
    const timer = setInterval(() => fetchJobs(true), 4000);
    return () => clearInterval(timer);
  }, [jobs]);

  // 若当前打开的进度弹窗对应的任务已不在列表中（如被删除），自动关闭弹窗
  useEffect(() => {
    if (progressModalJobId == null) return;
    const exists = jobs.some((j) => j.id === progressModalJobId);
    if (!exists) setProgressModalJobId(null);
  }, [jobs, progressModalJobId]);

  // 打开进度弹窗时拉取一次该任务状态（含 log_lines），便于展示已有过程输出
  useEffect(() => {
    if (progressModalJobId == null) return;
    trainingService.getJobStatus(progressModalJobId).then((res) => {
      if (res.code === 200 && res.data) {
        const d = res.data as TrainingJob;
        setJobs((prev) =>
          prev.map((j) => (j.id === progressModalJobId ? { ...j, ...d } : j))
        );
      }
    }).catch(() => {});
  }, [progressModalJobId]);

  // 进度弹窗常驻时自动轮询：弹窗打开且该任务为「排队中」或「训练中」时，每 2 秒拉取最新状态，使实时进度持续更新无需点刷新
  useEffect(() => {
    if (progressModalJobId == null) return;
    const job = jobs.find((j) => j.id === progressModalJobId);
    if (job?.status !== 'queued' && job?.status !== 'running') return;
    const timer = setInterval(() => {
      trainingService.getJobStatus(progressModalJobId).then((res) => {
        if (res.code === 200 && res.data) {
          const d = res.data as TrainingJob;
          setJobs((prev) =>
            prev.map((j) => (j.id === progressModalJobId ? { ...j, ...d } : j))
          );
        }
      }).catch(() => {});
    }, 2000);
    return () => clearInterval(timer);
  }, [progressModalJobId, jobs]);

  const fetchJobs = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const response = await trainingService.getJobs();
      if (response.code === 200 && response.data?.jobs) {
        setJobs(response.data.jobs);
      }
    } catch (error: any) {
      if (!silent) message.error(error.message || '获取训练任务列表失败');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const fetchDatasets = async () => {
    try {
      const response = await datasetService.getDatasets('training');
      if (response.code === 200 && response.data) {
        const readyDatasets = response.data.datasets.filter(
          (d: Dataset) => d.status === 'ready'
        );
        setDatasets(readyDatasets);
      }
    } catch (error: any) {
      message.error(error.message || '获取数据集列表失败');
    }
  };

  // 打开进度弹窗时若该任务为「排队中」，拉取一次最新状态（后端会修正为失败等）并更新列表，避免显示滞后
  const refreshJobWhenOpeningProgress = async (jobId: number) => {
    const job = jobs.find((j) => j.id === jobId);
    if (job?.status !== 'queued') return;
    try {
      const res = await trainingService.getJobStatus(jobId);
      if (res.code === 200 && res.data) {
        const d = res.data as TrainingJob;
        setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, ...d } : j)));
      }
    } catch (_) {
      // 忽略，列表轮询会继续更新
    }
  };

  // 进度弹窗内「刷新状态」：主动拉取该任务最新状态并更新展示（走后端 GetJobStatus，会做就绪检查并返回最新 status/error_message）
  const [progressModalRefreshing, setProgressModalRefreshing] = useState(false);
  const refreshProgressModalStatus = async () => {
    if (progressModalJobId == null) return;
    setProgressModalRefreshing(true);
    try {
      const res = await trainingService.getJobStatus(progressModalJobId);
      if (res.code === 200 && res.data) {
        const d = res.data as TrainingJob;
        setJobs((prev) =>
          prev.map((j) => (j.id === progressModalJobId ? { ...j, ...d } : j))
        );
        message.success('已刷新状态');
      }
    } catch (e: any) {
      const msg = e?.message || '刷新失败';
      const isNotFound = msg.includes('not found') || msg.includes('Job not found');
      if (isNotFound) {
        setProgressModalJobId(null);
        fetchJobs();
        message.info('该任务不存在或已被删除，已关闭进度窗口并刷新列表');
      } else {
        message.error(msg);
      }
    } finally {
      setProgressModalRefreshing(false);
    }
  };

  const getDefaultJobName = () => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `训练任务 ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  };

  const handleCreateJob = async (values: any) => {
    try {
      await trainingService.createJob({
        name: values.name?.trim() || undefined,
        dataset_id: values.dataset_id,
        model_type: values.model_type,
        hyperparams: {
          learning_rate: values.learning_rate,
          batch_size: values.batch_size,
          epochs: values.epochs,
        },
      });
      message.success('训练任务创建成功');
      setCreateModalVisible(false);
      form.resetFields();
      setTimeout(fetchJobs, 500);
    } catch (error: any) {
      message.error(error.message || '创建任务失败');
    }
  };

  // WebSocket: subscribe to progress for running jobs
  useEffect(() => {
    const runningIds = new Set(jobs.filter((j) => j.status === 'running').map((j) => j.id));
    const currentWs = wsRefs.current;

    runningIds.forEach((jobId) => {
      if (currentWs[jobId]) return;
      const url = trainingService.getProgressWsUrl(jobId);
      const ws = new WebSocket(url);
      currentWs[jobId] = ws;
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const epoch = data.epoch != null ? Number(data.epoch) : undefined;
          const progress = data.progress != null ? Number(data.progress) : undefined;
          const status = data.status;

          setJobs((prev) =>
            prev.map((j) => {
              if (j.id !== jobId) return j;
              const next = { ...j };
              if (typeof epoch === 'number' && !Number.isNaN(epoch)) {
                next.current_epoch = Math.floor(epoch);
                if (j.total_epochs > 0 && progress === undefined) {
                  next.progress = Math.min(100, Math.round((epoch / j.total_epochs) * 100));
                }
              }
              if (typeof progress === 'number' && !Number.isNaN(progress)) next.progress = progress;
              if (status === 'completed') {
                next.status = 'completed';
                next.progress = 100;
                next.current_epoch = j.total_epochs;
              }
              if (status === 'failed') {
                next.status = 'failed';
                // 后端失败时会推 {"status":"failed","error_message":"..."}，这里要写入，保证弹窗能显示具体原因
                if (typeof data?.error_message === 'string' && data.error_message.trim()) {
                  next.error_message = data.error_message;
                }
              }
              if (status === 'cancelled') {
                next.status = 'cancelled';
                if (typeof data?.error_message === 'string' && data.error_message.trim()) {
                  next.error_message = data.error_message;
                }
              }
              // 过程日志：WebSocket 推送的 LOG 行追加到 log_lines
              if (data?.type === 'log' && typeof data?.line === 'string') {
                next.log_lines = [...(j.log_lines || []), data.line];
                return next;
              }
              // 合并实时指标，供进度弹窗展示 loss/step/learning_rate/accuracy
              if (status !== 'completed' && status !== 'failed' && data && typeof data === 'object') {
                next.redis_progress = { ...(j.redis_progress || {}), ...data };
              }
              return next;
            })
          );
          if (status === 'completed' || status === 'failed' || status === 'cancelled') {
            ws.close();
            delete currentWs[jobId];
          }
        } catch (_) {
          // ignore parse errors
        }
      };
      ws.onerror = () => {
        ws.close();
        delete currentWs[jobId];
      };
      ws.onclose = () => {
        delete currentWs[jobId];
      };
    });

    Object.keys(currentWs).forEach((key) => {
      const id = Number(key);
      if (!runningIds.has(id)) {
        currentWs[id].close();
        delete currentWs[id];
      }
    });
  }, [jobs]);

  const modelTypeLabel: Record<string, string> = {
    text_classification: '文本分类',
  };

  // 将常见后端错误转为易懂的中文说明，方便非技术用户理解
  const getErrorExplanation = (errorMessage: string | undefined | null): string | null => {
    if (!errorMessage || typeof errorMessage !== 'string') return null;
    const msg = errorMessage.toLowerCase();
    if (msg.includes('cleaned file path') || msg.includes('status not ready')) {
      return '所选数据集尚未完成清洗，请先在「数据集管理」中等待清洗完成或重新执行清洗后再创建训练任务。';
    }
    if (msg.includes('no such file') || msg.includes('file not found')) {
      return '训练使用的数据文件不存在或已被删除，请重新上传并清洗数据集。';
    }
    if (msg.includes('python') || msg.includes('exec') || msg.includes('not found')) {
      return '未找到 Python 或训练环境未正确安装，请检查后端配置（如 PYTHON_PATH）与依赖。';
    }
    if (msg.includes('column') && msg.includes('does not exist')) {
      return '数据格式不符合要求（如缺少文本/标签列），请检查数据集列名是否包含 text/content 与 label。';
    }
    if (
      msg.includes('parsererror') ||
      msg.includes('error tokenizing data') ||
      (msg.includes('expected') && msg.includes('fields') && msg.includes('saw'))
    ) {
      return '数据文件解析失败：很可能选择了 JSON 数据集去训练“文本分类（CSV）”任务，或 CSV 分隔符/引号不规范。请优先使用 CSV（含 text/label 列），或将该 JSON 转换为 CSV 后再训练。';
    }
    if (msg.includes('cuda') || msg.includes('gpu') || msg.includes('out of memory')) {
      return '显存不足或 GPU 环境异常，可尝试减小 batch_size 或使用 CPU 训练。';
    }
    if (msg.includes('accelerate')) {
      return '训练依赖 accelerate 库。请在项目 Python 环境中执行: pip install \'accelerate>=0.26.0\'，然后重启训练。';
    }
    if (msg.includes('原数据集已删除')) {
      return '该任务对应的数据集已被删除；任务与模型已保留，可继续用于评估或下载，无法重新训练。';
    }
    return null;
  };

  const getProgressDetail = (record: TrainingJob): string => {
    const { status, current_epoch, total_epochs } = record;
    if (status === 'queued') return '排队中';
    if (status === 'running') {
      if (total_epochs > 0) {
        return `Epoch ${current_epoch}/${total_epochs} 训练中`;
      }
      return '训练中';
    }
    if (status === 'completed') return '已完成';
    if (status === 'failed') return '训练失败';
    if (status === 'cancelled') return '已取消';
    return '-';
  };

  // 进度弹窗：根据 job 状态生成时间线节点（类似外卖进度）
  const getProgressSteps = (job: TrainingJob | undefined) => {
    if (!job) return [];
    const { status, current_epoch, total_epochs, created_at, error_message } = job;
    const steps: { title: string; description?: string; status: StepStatus }[] = [];

    // 1. 任务创建
    steps.push({
      title: '任务已创建',
      description: created_at ? new Date(created_at).toLocaleString('zh-CN') : undefined,
      status: 'finish',
    });

    // 2. 排队中
    const queuedStatus: StepStatus =
      status === 'queued' ? 'process' : status === 'running' || status === 'completed' || status === 'failed' || status === 'cancelled' ? 'finish' : 'wait';
    steps.push({
      title: '排队中',
      description: status === 'queued' ? '等待调度...' : undefined,
      status: queuedStatus,
    });

    // 3. 训练中 - 按 Epoch 分步
    const total = Math.max(Number(total_epochs) || 0, 1);
    const current = Math.max(0, Number(current_epoch) || 0);
    if (total > 1) {
      for (let i = 1; i <= total; i++) {
        let epochStatus: StepStatus = 'wait';
        if (status === 'completed') epochStatus = 'finish';
        else if ((status === 'failed' || status === 'cancelled') && current >= i) epochStatus = 'finish';
        else if ((status === 'failed' || status === 'cancelled') && current + 1 === i) epochStatus = 'error';
        else if (status === 'running' && current >= i) epochStatus = 'finish';
        else if (status === 'running' && current + 1 === i) epochStatus = 'process';
        steps.push({
          title: `Epoch ${i}/${total}`,
          description: epochStatus === 'process' ? '训练中...' : epochStatus === 'finish' ? '已完成' : undefined,
          status: epochStatus,
        });
      }
    } else {
      const trainStatus: StepStatus =
        status === 'running' ? 'process' : status === 'completed' ? 'finish' : status === 'failed' || status === 'cancelled' ? 'error' : 'wait';
      steps.push({
        title: '训练中',
        description: status === 'running' ? '进行中...' : undefined,
        status: trainStatus,
      });
    }

    // 4. 训练完成
    const doneStatus: StepStatus =
      status === 'completed' ? 'finish' : status === 'failed' || status === 'cancelled' ? 'error' : status === 'running' ? 'process' : 'wait';
    steps.push({
      title: status === 'completed' ? '已完成' : status === 'failed' ? '训练失败' : status === 'cancelled' ? '已取消' : '训练完成',
      description: (status === 'failed' || status === 'cancelled') && error_message ? error_message : undefined,
      status: doneStatus,
    });

    return steps;
  };

  const columns = [
    {
      title: '序号',
      key: 'index',
      width: 70,
      render: (_: unknown, __: TrainingJob, index: number) => index + 1,
    },
    {
      title: '训练名称',
      dataIndex: 'name',
      key: 'name',
      width: 140,
      render: (name: string | undefined, record: TrainingJob) =>
        (name && name.trim()) ? name.trim() : `训练任务 #${record.id}`,
    },
    {
      title: '模型类型',
      dataIndex: 'model_type',
      key: 'model_type',
      width: 110,
      render: (type: string) => modelTypeLabel[type] ?? type,
    },
    {
      title: '数据集',
      dataIndex: 'dataset_id',
      key: 'dataset_id',
      width: 120,
      render: (id: number | null | undefined) =>
        id == null ? <span style={{ color: '#999' }}>原数据集已删除</span> : `#${id}`,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (status: string, record: TrainingJob) => {
        const colorMap: Record<string, string> = {
          queued: 'default',
          running: 'processing',
          completed: 'success',
          failed: 'error',
          cancelled: 'default',
        };
        const textMap: Record<string, string> = {
          queued: '排队中',
          running: '训练中',
          completed: '已完成',
          failed: '失败',
          cancelled: '已取消',
        };
        const tag = <Tag color={colorMap[status]}>{textMap[status] ?? status}</Tag>;
        if ((status === 'failed' || status === 'cancelled') && record.error_message) {
          return (
            <Tooltip title={record.error_message} placement="topLeft">
              <span>{tag}</span>
            </Tooltip>
          );
        }
        return tag;
      },
    },
    {
      title: '进度',
      dataIndex: 'progress',
      key: 'progress',
      width: 140,
      render: (progress: number, record: TrainingJob) => (
        <Progress percent={progress} size="small" />
      ),
    },
    {
      title: '进度详情',
      key: 'progress_detail',
      width: 220,
      render: (_: unknown, record: TrainingJob) => {
        const hint = (record.status === 'failed' || record.status === 'cancelled') && record.error_message
          ? getErrorExplanation(record.error_message) || (record.error_message.length > 40 ? record.error_message.slice(0, 40) + '…' : record.error_message)
          : null;
        return (
          <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: '#666' }}>{getProgressDetail(record)}</span>
              <Button
                type="link"
                size="small"
                icon={<EyeOutlined />}
                onClick={() => {
                  setProgressModalJobId(record.id);
                  refreshJobWhenOpeningProgress(record.id);
                }}
                style={{ padding: 0, height: 'auto' }}
                title="查看进度详情"
              />
            </span>
            {hint && (
              <Tooltip title={record.error_message}>
                <span style={{ fontSize: 11, color: '#cf1322', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {hint}
                </span>
              </Tooltip>
            )}
          </span>
        );
      },
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 170,
      render: (text: string) => new Date(text).toLocaleString('zh-CN'),
    },
    {
      title: '操作',
      key: 'actions',
      width: 160,
      fixed: 'right',
      render: (_: unknown, record: TrainingJob) => {
        const canRestart = ['failed', 'completed', 'cancelled'].includes(record.status);
        const isRunning = record.status === 'running';
        return (
          <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
            {isRunning && (
              <Popconfirm
                title="确定要取消当前训练？"
                description="取消后任务将标记为「已取消」，可稍后点击「重启训练」重新开始。"
                onConfirm={async () => {
                  try {
                    await trainingService.cancelJob(record.id);
                    message.success('已取消训练');
                    setJobs((prev) =>
                      prev.map((j) =>
                        j.id === record.id ? { ...j, status: 'cancelled', error_message: '用户取消' } : j
                      )
                    );
                  } catch (e: any) {
                    message.error(e?.message || '取消失败');
                  }
                }}
                okText="确定取消"
                cancelText="不取消"
                okButtonProps={{ danger: true }}
              >
                <Button type="link" size="small" danger icon={<StopOutlined />} style={{ padding: 0 }}>
                  取消训练
                </Button>
              </Popconfirm>
            )}
            {canRestart && (
              record.dataset_id == null ? (
                <Tooltip title="原数据集已删除，无法重新训练；模型已保留可继续评估或下载">
                  <span>
                    <Button type="link" size="small" icon={<RedoOutlined />} style={{ padding: 0 }} disabled>
                      重启训练
                    </Button>
                  </span>
                </Tooltip>
              ) : (
                <Popconfirm
                  title="确定要重新训练该任务？"
                  description="将使用相同配置在当前任务上重新开始训练，不会新建任务。"
                  onConfirm={async () => {
                    try {
                      await trainingService.restartJob(record.id);
                      message.success('已提交重启，任务将重新开始训练');
                      setJobs((prev) =>
                        prev.map((j) =>
                          j.id === record.id
                            ? {
                                ...j,
                                status: 'queued',
                                progress: 0,
                                current_epoch: 0,
                                error_message: undefined,
                              }
                            : j
                        )
                      );
                    } catch (e: any) {
                      message.error(e?.message || '重启失败');
                    }
                  }}
                  okText="确定重启"
                  cancelText="取消"
                >
                  <Button type="link" size="small" icon={<RedoOutlined />} style={{ padding: 0 }}>
                    重启训练
                  </Button>
                </Popconfirm>
              )
            )}
            <Popconfirm
            title="确定删除该训练任务？"
            description="删除后无法恢复，关联的日志与模型记录会一并清除。"
            onConfirm={async () => {
              try {
                await trainingService.deleteJob(record.id);
                message.success('已删除');
                // 立刻从本地列表移除，保证用户“确认删除”后即时看到消失
                setJobs((prev) => prev.filter((j) => j.id !== record.id));
                // 若进度弹窗正打开该任务，关闭弹窗；并断开对应 WebSocket
                if (progressModalJobId === record.id) setProgressModalJobId(null);
                if (wsRefs.current[record.id]) {
                  try {
                    wsRefs.current[record.id].close();
                  } catch (_) {}
                  delete wsRefs.current[record.id];
                }
                // 再拉一次服务端列表，确保与后端最终一致（例如分页/排序变化）
                fetchJobs(true);
              } catch (e: any) {
                message.error(e?.message || '删除失败');
              }
            }}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />} style={{ padding: 0 }}>
              删除任务
            </Button>
          </Popconfirm>
        </span>
        );
      },
    },
  ];

  return (
    <div>
      <Card
        title="训练任务管理"
        extra={
          <div>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => fetchJobs(false)}
              style={{ marginRight: 8 }}
            >
              刷新
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                setCreateModalVisible(true);
                form.setFieldsValue({ name: getDefaultJobName() });
              }}
            >
              创建训练任务
            </Button>
          </div>
        }
      >
        <Table
          columns={columns}
          dataSource={jobs}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
        />
      </Card>

      {/* 训练进度详情弹窗：时间线 + 关键节点 + 实时状态；标题栏带「刷新状态」走 GetJobStatus 即时拉取 */}
      <Modal
        title={
          progressModalJobId != null ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingRight: 28 }}>
              <span>
                训练进度 · {(jobs.find((j) => j.id === progressModalJobId)?.name || '').trim() || `任务 #${progressModalJobId}`}
              </span>
              <Tooltip title="刷新状态（从服务端拉取最新进度与结果）">
                <Button
                  type="text"
                  size="small"
                  icon={<SyncOutlined spin={progressModalRefreshing} />}
                  onClick={refreshProgressModalStatus}
                  disabled={progressModalRefreshing}
                  style={{ paddingInline: 6 }}
                />
              </Tooltip>
            </div>
          ) : (
            '训练进度'
          )
        }
        open={progressModalJobId != null}
        onCancel={() => setProgressModalJobId(null)}
        footer={[
          <Button key="close" onClick={() => setProgressModalJobId(null)}>
            关闭
          </Button>,
        ]}
        width={560}
        destroyOnClose
      >
        {progressModalJobId != null && (() => {
          const job = jobs.find((j) => j.id === progressModalJobId);
          if (!job) return <Spin tip="加载中..." />;
          const steps = getProgressSteps(job);
          const rp = job.redis_progress || {};
          const toNum = (v: unknown): number | null =>
            v == null ? null : typeof v === 'number' ? (Number.isNaN(v) ? null : v) : typeof v === 'string' ? (parseFloat(v) as number) : null;
          const loss = toNum(rp.loss);
          const step = toNum(rp.step);
          const maxSteps = toNum(rp.max_steps);
          const lr = toNum(rp.learning_rate);
          const acc = toNum(rp.accuracy ?? rp.eval_accuracy);
          const hasMetrics = loss != null || step != null || lr != null || acc != null;
          return (
            <div style={{ padding: '8px 0' }}>
              <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
                <Tag color={job.status === 'completed' ? 'success' : job.status === 'failed' ? 'error' : job.status === 'cancelled' ? 'default' : 'processing'}>
                  {job.status === 'queued' ? '排队中' : job.status === 'running' ? '训练中' : job.status === 'completed' ? '已完成' : job.status === 'cancelled' ? '已取消' : '失败'}
                </Tag>
                <Progress percent={job.progress} size="small" style={{ flex: 1, maxWidth: 200 }} />
                <span style={{ fontSize: 12, color: '#666' }}>{job.progress}%</span>
              </div>
              {job.status === 'running' && !hasMetrics && (
                <div style={{ marginBottom: 16, padding: 10, background: '#e6f7ff', borderRadius: 8, fontSize: 13, color: '#0050b3' }}>
                  训练已启动，正在加载数据或计算首步，请稍候… 进度会随训练自动更新。
                </div>
              )}
              {job.status === 'running' && hasMetrics && (
                <div style={{ marginBottom: 16, padding: 12, background: '#f5f5f5', borderRadius: 8, fontSize: 13 }}>
                  <div style={{ fontWeight: 600, marginBottom: 8, color: '#333' }}>当前训练指标</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px 24px' }}>
                    {loss != null && loss > 0 && <span><strong>Loss:</strong> {loss.toFixed(4)}</span>}
                    {acc != null && <span><strong>Accuracy:</strong> {(acc * 100).toFixed(2)}%</span>}
                    {step != null && maxSteps != null && <span><strong>Step:</strong> {Math.floor(step)} / {Math.floor(maxSteps)}</span>}
                    {step != null && maxSteps == null && <span><strong>Step:</strong> {Math.floor(step)}</span>}
                    {lr != null && <span><strong>Learning rate:</strong> {lr.toExponential(2)}</span>}
                  </div>
                </div>
              )}
              <Steps
                direction="vertical"
                size="small"
                items={steps.map((s) => ({
                  title: s.title,
                  description: s.description,
                  status: s.status,
                }))}
              />
              {(job.log_lines?.length ?? 0) > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontWeight: 600, marginBottom: 8, color: '#333', fontSize: 13 }}>训练过程输出</div>
                  <div
                    style={{
                      maxHeight: 180,
                      overflow: 'auto',
                      padding: '8px 12px',
                      background: '#fafafa',
                      borderRadius: 8,
                      border: '1px solid #f0f0f0',
                      fontSize: 12,
                      fontFamily: 'monospace',
                      lineHeight: 1.6,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                    }}
                  >
                    {job.log_lines.map((line, i) => (
                      <div key={i}>{line}</div>
                    ))}
                  </div>
                </div>
              )}
              {(job.status === 'failed' || job.status === 'cancelled') && (
                <div style={{ marginTop: 16, padding: 12, background: '#fff2f0', border: '1px solid #ffccc7', borderRadius: 8 }}>
                  <div style={{ fontWeight: 600, color: '#cf1322', marginBottom: 6 }}>失败原因说明</div>
                  {job.error_message && (
                    <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>{job.error_message}</div>
                  )}
                  {getErrorExplanation(job.error_message) && (
                    <div style={{ fontSize: 13, color: '#cf1322' }}>
                      <strong>可能原因：</strong>{getErrorExplanation(job.error_message)}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })()}
      </Modal>

      <Modal
        title="创建训练任务"
        open={createModalVisible}
        onCancel={() => {
          setCreateModalVisible(false);
          form.resetFields();
        }}
        onOk={() => form.submit()}
        okText="创建"
        cancelText="取消"
        width={600}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleCreateJob}
          initialValues={{
            model_type: 'text_classification',
            learning_rate: 0.00002,
            batch_size: 16,
            epochs: 3,
          }}
        >
          <Form.Item
            name="name"
            label="训练任务名称"
            rules={[{ max: 200, message: '最多 200 个字符' }]}
          >
            <Input
              placeholder="例如：情感分类实验 v1"
              allowClear
              onFocus={() => {
                const cur = form.getFieldValue('name');
                if (cur == null || String(cur).trim() === '') {
                  form.setFieldsValue({ name: getDefaultJobName() });
                }
              }}
            />
          </Form.Item>
          <Form.Item
            name="dataset_id"
            label="选择数据集"
            rules={[{ required: true, message: '请选择数据集' }]}
          >
            <Select placeholder="请选择数据集">
              {datasets.map((dataset) => (
                <Select.Option key={dataset.id} value={dataset.id}>
                  {dataset.name} (ID: {dataset.id})
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item
            name="model_type"
            label="模型类型"
            rules={[{ required: true, message: '请选择模型类型' }]}
          >
            <Select>
              <Select.Option value="text_classification">文本分类</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item
            name="learning_rate"
            label="学习率"
            rules={[{ required: true, message: '请输入学习率' }]}
          >
            <InputNumber
              min={0.00001}
              max={0.01}
              step={0.00001}
              style={{ width: '100%' }}
            />
          </Form.Item>

          <Form.Item
            name="batch_size"
            label="批次大小"
            rules={[{ required: true, message: '请输入批次大小' }]}
          >
            <InputNumber min={1} max={128} style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item
            name="epochs"
            label="训练轮数"
            rules={[{ required: true, message: '请输入训练轮数' }]}
          >
            <InputNumber min={1} max={100} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default TrainingManagement;
