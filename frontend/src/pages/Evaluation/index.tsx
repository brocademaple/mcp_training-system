import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Card,
  Table,
  Button,
  Modal,
  Form,
  Select,
  Input,
  message,
  Tag,
  Steps,
  Spin,
  Popconfirm,
  Progress,
  Tooltip,
} from 'antd';
import { PlusOutlined, ReloadOutlined, DownloadOutlined, SyncOutlined, StopOutlined, DeleteOutlined, EyeOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import { evaluationService } from '@/services/evaluation';
import { modelService } from '@/services/model';
import { datasetService } from '@/services/dataset';
import type { Evaluation, Model, Dataset } from '@/types';

type StepStatus = 'wait' | 'process' | 'finish' | 'error';

const EvaluationManagement: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [loading, setLoading] = useState(false);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [progressModalEvalId, setProgressModalEvalId] = useState<number | null>(null);
  const [previewReportEvalId, setPreviewReportEvalId] = useState<number | null>(null);
  const [previewReportUrl, setPreviewReportUrl] = useState<string | null>(null);
  const [previewReportError, setPreviewReportError] = useState(false);
  const [models, setModels] = useState<Model[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [datasetsLoading, setDatasetsLoading] = useState(false);
  const [progressModalRefreshing, setProgressModalRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [cancelLoadingId, setCancelLoadingId] = useState<number | null>(null);
  const [deleteLoadingId, setDeleteLoadingId] = useState<number | null>(null);
  const [detailModalEvalId, setDetailModalEvalId] = useState<number | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightData, setInsightData] = useState<{
    category: string;
    summary: string;
    suggestions: string[];
  } | null>(null);
  const [helpModalVisible, setHelpModalVisible] = useState(false);
  const [form] = Form.useForm();

  const fetchEvaluations = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const response = await evaluationService.getEvaluations();
      if (response.code === 200 && response.data?.evaluations) {
        setEvaluations(response.data.evaluations);
      }
    } catch (error: any) {
      if (!silent) message.error(error.message || '获取评估列表失败');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchEvaluations();
  }, []);

  // 存在「评估中」时每 4 秒静默拉取列表，便于状态变为完成/失败后自动更新
  useEffect(() => {
    const hasRunning = evaluations.some((e) => e.status === 'running');
    if (!hasRunning) return;
    const timer = setInterval(() => fetchEvaluations(true), 4000);
    return () => clearInterval(timer);
  }, [evaluations]);

  // 进度弹窗打开时拉取一次该评估详情；404 时关闭弹窗并刷新列表
  useEffect(() => {
    if (progressModalEvalId == null) return;
    evaluationService.getEvaluationResult(progressModalEvalId).then((res) => {
      if (res.code === 200 && res.data) {
        const d = res.data as Evaluation;
        setEvaluations((prev) =>
          prev.map((e) => (e.id === progressModalEvalId ? { ...e, ...d } : e))
        );
      }
    }).catch((e: any) => {
      if (e?.status === 404) {
        setProgressModalEvalId(null);
        message.info('该评估不存在或已删除，已关闭进度窗口');
        fetchEvaluations();
      }
    });
  }, [progressModalEvalId]);

  // 详情弹窗打开且该条为失败/取消时，拉取失败原因洞察（归类+摘要+建议）
  useEffect(() => {
    if (detailModalEvalId == null) {
      setInsightData(null);
      return;
    }
    const rec = evaluations.find((e) => e.id === detailModalEvalId);
    const needInsight = rec && (rec.status === 'failed' || (rec.status === 'cancelled' && (rec.error_message?.trim() || '')));
    if (!needInsight) {
      setInsightData(null);
      return;
    }
    setInsightLoading(true);
    evaluationService
      .getEvaluationInsight(detailModalEvalId)
      .then((res) => {
        if (res.code === 200 && res.data?.insight) {
          setInsightData(res.data.insight);
        } else {
          setInsightData(null);
        }
      })
      .catch(() => setInsightData(null))
      .finally(() => setInsightLoading(false));
  }, [detailModalEvalId, evaluations]);

  // 预览报告：打开弹窗时用当前 origin 请求预览接口，成功则设 iframe src，失败则展示友好提示（避免 iframe 内 404）
  useEffect(() => {
    if (previewReportEvalId == null) {
      setPreviewReportUrl(null);
      setPreviewReportError(false);
      return;
    }
    const fullUrl = `${window.location.origin}${evaluationService.getReportPreviewUrl(previewReportEvalId)}`;
    setPreviewReportUrl(null);
    setPreviewReportError(false);
    fetch(fullUrl, { method: 'GET', credentials: 'same-origin' })
      .then((res) => {
        if (res.ok) {
          setPreviewReportUrl(fullUrl);
          setPreviewReportError(false);
        } else {
          setPreviewReportUrl(null);
          setPreviewReportError(true);
        }
      })
      .catch(() => {
        setPreviewReportUrl(null);
        setPreviewReportError(true);
      });
  }, [previewReportEvalId]);

  // 进度弹窗常驻时：若该任务为「评估中」，每 2 秒拉取最新状态；404 时关闭弹窗并刷新
  useEffect(() => {
    if (progressModalEvalId == null) return;
    const evalRow = evaluations.find((e) => e.id === progressModalEvalId);
    if (evalRow?.status !== 'running') return;
    const timer = setInterval(() => {
      evaluationService.getEvaluationResult(progressModalEvalId).then((res) => {
        if (res.code === 200 && res.data) {
          const d = res.data as Evaluation;
          setEvaluations((prev) =>
            prev.map((e) => (e.id === progressModalEvalId ? { ...e, ...d } : e))
          );
        }
      }).catch((e: any) => {
        if (e?.status === 404) {
          setProgressModalEvalId(null);
          message.info('该评估不存在或已删除，已关闭进度窗口');
          fetchEvaluations();
        }
      });
    }, 2000);
    return () => clearInterval(timer);
  }, [progressModalEvalId, evaluations]);

  const fetchModels = async () => {
    setModelsLoading(true);
    try {
      const res = await modelService.getModels();
      if (res.code === 200 && res.data?.models) {
        setModels(res.data.models);
      }
    } catch (e: any) {
      message.error(e.message || '获取模型列表失败');
    } finally {
      setModelsLoading(false);
    }
  };

  const fetchDatasets = async () => {
    setDatasetsLoading(true);
    try {
      const res = await datasetService.getDatasets('test');
      if (res.code === 200 && res.data?.datasets) {
        setDatasets(res.data.datasets);
      }
    } catch (e: any) {
      message.error(e.message || '获取数据集列表失败');
    } finally {
      setDatasetsLoading(false);
    }
  };

  const openCreateModal = (presetModelId?: number) => {
    const now = new Date();
    const defaultName = `评估任务-${now.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })}`;
    form.setFieldsValue({
      name: defaultName,
      model_id: presetModelId ?? undefined,
      test_dataset_id: undefined,
    });
    setCreateModalVisible(true);
    fetchModels();
    fetchDatasets();
  };

  // 从训练页「创建评估」跳转时，自动打开创建弹窗并预填 model_id
  useEffect(() => {
    const state = location.state as { modelId?: number } | null;
    if (state?.modelId) {
      openCreateModal(state.modelId);
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, []);

  const handleCreateEvaluation = async (values: any) => {
    try {
      await evaluationService.createEvaluation({
        model_id: values.model_id,
        name: values.name,
        test_dataset_id: values.test_dataset_id || undefined,
      });
      message.success('评估任务创建成功');
      setCreateModalVisible(false);
      form.resetFields();
      fetchEvaluations();
    } catch (error: any) {
      message.error(error.message || '创建评估任务失败');
    }
  };

  // 若当前打开的进度弹窗对应的评估已不在列表中，自动关闭弹窗
  useEffect(() => {
    if (progressModalEvalId == null) return;
    const exists = evaluations.some((e) => e.id === progressModalEvalId);
    if (!exists) setProgressModalEvalId(null);
  }, [evaluations, progressModalEvalId]);

  const refreshProgressModalStatus = async () => {
    if (progressModalEvalId == null) return;
    setProgressModalRefreshing(true);
    try {
      const res = await evaluationService.getEvaluationResult(progressModalEvalId);
      if (res.code === 200 && res.data) {
        const d = res.data as Evaluation;
        setEvaluations((prev) =>
          prev.map((e) => (e.id === progressModalEvalId ? { ...e, ...d } : e))
        );
        message.success('已刷新状态');
      }
    } catch (e: any) {
      if (e?.status === 404) {
        setProgressModalEvalId(null);
        message.info('该评估不存在或已删除，已关闭进度窗口');
        fetchEvaluations();
      } else {
        message.error(e?.message || '刷新失败');
      }
    } finally {
      setProgressModalRefreshing(false);
    }
  };

  const getTaskName = (record: Evaluation) => {
    if (record.name && record.name.trim()) return record.name.trim();
    return `评估 模型#${record.model_id} ${new Date(record.created_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`;
  };

  const handleCancelEvaluation = async (id: number) => {
    setCancelLoadingId(id);
    try {
      const res = await evaluationService.cancelEvaluation(id);
      if (res.code === 200) {
        message.success('已中止该评估任务');
        setEvaluations((prev) => prev.map((e) => (e.id === id ? { ...e, status: 'cancelled' as const } : e)));
        if (progressModalEvalId === id) setProgressModalEvalId(null);
      } else {
        message.error(res.message || '中止失败');
      }
    } catch (e: any) {
      message.error(e?.message || '中止失败');
    } finally {
      setCancelLoadingId(null);
    }
  };

  const handleDeleteEvaluation = async (id: number) => {
    setDeleteLoadingId(id);
    try {
      await evaluationService.deleteEvaluation(id);
      message.success('已删除');
      setEvaluations((prev) => prev.filter((e) => e.id !== id));
      if (progressModalEvalId === id) setProgressModalEvalId(null);
    } catch (e: any) {
      message.error(e?.message || '删除失败');
    } finally {
      setDeleteLoadingId(null);
    }
  };

  const columns = [
    {
      title: '序号',
      key: 'order',
      width: 56,
      render: (_: unknown, __: Evaluation, index: number) => (page - 1) * pageSize + index + 1,
    },
    {
      title: '评估名称',
      dataIndex: 'name',
      key: 'evalName',
      width: 220,
      onHeaderCell: () => ({
        style: {
          whiteSpace: 'normal',
          wordBreak: 'break-word',
          lineHeight: 1.2,
        },
      }),
      render: (_: unknown, record: Evaluation) => {
        const text = record.name && record.name.trim() ? record.name.trim() : getTaskName(record);
        return (
          <div style={{ maxWidth: 220, whiteSpace: 'normal', wordBreak: 'break-all', lineHeight: 1.4 }}>
            {text}
          </div>
        );
      },
    },
    {
      title: '任务名',
      key: 'name',
      ellipsis: true,
      render: (_: unknown, record: Evaluation) => getTaskName(record),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 200,
      render: (status: string, record: Evaluation) => {
        const s = status || 'completed';
        const hasReport = !!record.report_path;
        const effectiveStatus =
          s === 'running' && hasReport
            ? 'completed'
            : s || (hasReport ? 'completed' : 'completed');
        const detailBtn = (
          <Tooltip title="查看进度 / 成功阶段 / 失败原因（含控制台与脚本输出）">
            <Button
              type="text"
              size="small"
              icon={<EyeOutlined />}
              onClick={() => setDetailModalEvalId(record.id)}
              style={{ marginLeft: 4, padding: '0 4px', verticalAlign: 'middle' }}
            />
          </Tooltip>
        );
        if (s === 'running' && !hasReport) {
          const created = new Date(record.created_at).getTime();
          const mins = Math.floor((Date.now() - created) / 60000);
          const tip =
            mins > 0
              ? `该评估任务自创建起已持续运行约 ${mins} 分钟，列表每 4 秒自动刷新`
              : '该评估任务刚刚启动，列表每 4 秒自动刷新';
          return (
            <span>
              <Tag color="processing" title={tip}>
                <div>评估中</div>
                <div style={{ fontSize: 12, opacity: 0.8 }}>
                  {mins > 0 ? `（已运行 ${mins} 分钟）` : '（刚刚启动）'}
                </div>
              </Tag>
              {detailBtn}
            </span>
          );
        }
        if (effectiveStatus === 'failed') {
          return (
            <span>
              <Tag color="error">失败</Tag>
              {detailBtn}
            </span>
          );
        }
        if (effectiveStatus === 'cancelled') {
          return (
            <span>
              <Tag color="default">已取消</Tag>
              {detailBtn}
            </span>
          );
        }
        return (
          <span>
            <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
              <Tag color="success">
                <div>已完成</div>
              </Tag>
              {s === 'running' && hasReport && (
                <div
                  style={{
                    padding: '0 6px',
                    borderRadius: 10,
                    background: '#f5f5f5',
                    fontSize: 11,
                    color: '#8c8c8c',
                    display: 'inline-block',
                    lineHeight: '18px',
                  }}
                >
                  结果已生成
                </div>
              )}
            </div>
            {detailBtn}
          </span>
        );
      },
    },
    {
      title: '当前进度',
      key: 'progress',
      width: 120,
      render: (_: unknown, record: Evaluation) => {
        const s = record.status || 'completed';
        const hasReport = !!record.report_path;
        const effectiveStatus = s === 'running' && hasReport ? 'completed' : s;
        if (effectiveStatus === 'running') {
          return (
            <div style={{ width: 80 }}>
              <Progress percent={50} status="active" size="small" showInfo={false} />
            </div>
          );
        }
        if (effectiveStatus === 'failed') {
          return (
            <div style={{ width: 80 }}>
              <Progress percent={0} status="exception" size="small" />
            </div>
          );
        }
        if (effectiveStatus === 'cancelled') {
          return (
            <div style={{ width: 80 }}>
              <Progress percent={0} size="small" />
            </div>
          );
        }
        return (
          <div style={{ width: 80 }}>
            <Progress percent={100} status="success" size="small" />
          </div>
        );
      },
    },
    {
      title: '准确率',
      dataIndex: 'accuracy',
      key: 'accuracy',
      width: 100,
      render: (value: number, record: Evaluation) => {
        const s = record.status || 'completed';
        const hasReport = !!record.report_path;
        const effectiveStatus = s === 'running' && hasReport ? 'completed' : s;
        if (effectiveStatus === 'running' || effectiveStatus === 'cancelled') {
          return '—';
        }
        return `${((value ?? 0) * 100).toFixed(2)}%`;
      },
    },
    {
      title: 'F1分数',
      dataIndex: 'f1_score',
      key: 'f1_score',
      width: 100,
      render: (value: number, record: Evaluation) => {
        const s = record.status || 'completed';
        const hasReport = !!record.report_path;
        const effectiveStatus = s === 'running' && hasReport ? 'completed' : s;
        if (effectiveStatus === 'running' || effectiveStatus === 'cancelled') {
          return '—';
        }
        return `${((value ?? 0) * 100).toFixed(2)}%`;
      },
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 172,
      render: (text: string) => new Date(text).toLocaleString('zh-CN'),
    },
    {
      title: '操作',
      key: 'action',
      width: 120,
      render: (_: any, record: Evaluation) => {
        const s = record.status || 'completed';
        const hasReport = !!record.report_path;
        const effectiveStatus = s === 'running' && hasReport ? 'completed' : s;
        const isRunning = effectiveStatus === 'running';
        return (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0 }}>
            {isRunning && (
              <Button
                type="link"
                icon={<SyncOutlined />}
                onClick={() => setProgressModalEvalId(record.id)}
                style={{ paddingLeft: 0, paddingRight: 4, height: 28 }}
              >
                查看进度
              </Button>
            )}
            {record.report_path && (
              <>
                <Button
                  type="link"
                  icon={<EyeOutlined />}
                  onClick={() => setPreviewReportEvalId(record.id)}
                  style={{ paddingLeft: 0, paddingRight: 4, height: 28 }}
                >
                  预览报告
                </Button>
                <Button
                  type="link"
                  icon={<DownloadOutlined />}
                  href={evaluationService.getReportDownloadUrl(record.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ paddingLeft: 0, paddingRight: 4, height: 28 }}
                >
                  下载报告
                </Button>
              </>
            )}
            {isRunning && (
              <Popconfirm
                title="确定中止该评估任务？"
                onConfirm={() => handleCancelEvaluation(record.id)}
                okText="确定"
                cancelText="取消"
              >
                <Button
                  type="link"
                  danger
                  icon={<StopOutlined />}
                  loading={cancelLoadingId === record.id}
                  style={{ paddingLeft: 0, paddingRight: 4, height: 28 }}
                >
                  中止
                </Button>
              </Popconfirm>
            )}
            <Popconfirm
              title="确定删除该评估记录？删除后不可恢复。"
              onConfirm={() => handleDeleteEvaluation(record.id)}
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
            >
              <Button
                type="link"
                danger
                icon={<DeleteOutlined />}
                loading={deleteLoadingId === record.id}
                style={{ paddingLeft: 0, paddingRight: 4, height: 28 }}
              >
                删除
              </Button>
            </Popconfirm>
          </div>
        );
      },
    },
  ];

  return (
    <div>
      <Card
        title={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            模型评估管理
            <Tooltip title="如何创建评估任务与选择测试集">
              <Button
                type="text"
                size="small"
                icon={<QuestionCircleOutlined />}
                onClick={() => setHelpModalVisible(true)}
                style={{ padding: '0 4px', verticalAlign: 'middle' }}
              />
            </Tooltip>
          </span>
        }
        extra={
          <div>
            <Button
              icon={<ReloadOutlined />}
              onClick={fetchEvaluations}
              style={{ marginRight: 8 }}
            >
              刷新
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={openCreateModal}
            >
              创建评估任务
            </Button>
          </div>
        }
      >
        <Table
          columns={columns}
          dataSource={evaluations}
          rowKey="id"
          loading={loading}
          pagination={{
            current: page,
            pageSize,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 条`,
            onChange: (p, size) => {
              setPage(p);
              setPageSize(size || 10);
            },
          }}
        />
      </Card>

      {/* 如何创建评估任务与选择测试集说明 */}
      <Modal
        title="如何创建评估任务"
        open={helpModalVisible}
        onCancel={() => setHelpModalVisible(false)}
        footer={[<Button key="close" type="primary" onClick={() => setHelpModalVisible(false)}>知道了</Button>]}
        width={560}
      >
        <div style={{ lineHeight: 1.8, fontSize: 13 }}>
          <p style={{ marginBottom: 12, fontWeight: 600 }}>一、创建步骤</p>
          <ol style={{ marginBottom: 16, paddingLeft: 20 }}>
            <li>点击「创建评估任务」。</li>
            <li>在弹窗中<strong>选择要评估的模型</strong>（来自「模型管理」中已训练完成的模型）。</li>
            <li><strong>选择测试数据集</strong>（推荐）：在「测试数据集」下拉框中选择一份已就绪的测试集；若留空，系统会尝试使用该模型对应训练任务当时使用的数据集（若该数据集已被删除则会失败）。</li>
            <li>点击「创建」，任务会进入「评估中」；完成后可预览报告、下载报告。</li>
          </ol>
          <p style={{ marginBottom: 8, fontWeight: 600 }}>二、对模型的要求</p>
          <ul style={{ marginBottom: 16, paddingLeft: 20 }}>
            <li>模型必须来自<strong>已训练完成</strong>的任务（模型管理列表中可见）。</li>
            <li>模型目录未被删除（通常位于 <code>data/models/job_*</code> 下）。</li>
            <li>当前仅支持<strong>文本分类</strong>类模型（如 BERT 等）。</li>
          </ul>
          <p style={{ marginBottom: 8, fontWeight: 600 }}>三、对测试集的要求与如何选择</p>
          <ul style={{ marginBottom: 0, paddingLeft: 20 }}>
            <li>测试集状态须为<strong>「就绪」</strong>（已上传并处理完成，或由「从训练集划分测试集」生成）。</li>
            <li>文件格式：CSV 或 JSON，且须包含：<br />
              · 一列<strong>文本</strong>（列名可为 <code>text</code>、<code>content</code>、<code>review</code>、<code>sentence</code>、<code>comment</code>、<code>instruction</code>、<code>input</code> 之一）；<br />
              · 一列<strong>标签</strong>（列名可为 <code>label</code>、<code>labels</code> 或 <code>output</code>），取值为 0/1 或可识别的二分类。</li>
            <li><strong>建议</strong>：在「数据集管理」的「测试数据集」页签中上传或从训练集划分出一份测试集，创建评估时在下拉框中选择该测试集，这样最稳定、不易因原训练集删除而失败。</li>
          </ul>
        </div>
      </Modal>

      <Modal
        title="创建评估任务"
        open={createModalVisible}
        onCancel={() => {
          setCreateModalVisible(false);
          form.resetFields();
        }}
        onOk={() => form.submit()}
        okText="创建"
        cancelText="取消"
      >
        <Form form={form} layout="vertical" onFinish={handleCreateEvaluation}>
          <Form.Item
            name="name"
            label="评估名称"
            rules={[{ required: true, message: '请输入评估名称' }]}
          >
            <Input placeholder="例如：情感分类-基础模型 vs 测试集A" />
          </Form.Item>
          <Form.Item
            name="model_id"
            label="选择模型"
            rules={[{ required: true, message: '请选择要评估的模型' }]}
          >
            <Select
              placeholder="请选择已有模型"
              loading={modelsLoading}
              allowClear
              showSearch
              optionFilterProp="label"
              options={models.map((m) => ({
                value: m.id,
                label: `${m.name || `模型 #${m.id}`} (ID: ${m.id})`,
              }))}
            />
          </Form.Item>

          <Form.Item name="test_dataset_id" label="测试数据集（可选）">
            <Select
              placeholder="留空则自动分割或使用训练集"
              allowClear
              showSearch
              optionFilterProp="label"
              loading={datasetsLoading}
              options={datasets
                .filter((d) => d.status === 'ready')
                .map((d) => ({
                  value: d.id,
                  label: `${d.name} (ID: ${d.id})`,
                }))}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* 评估进度弹窗：细化阶段为 准备 → 评估 → 生成报告 → 完成/失败/已取消 */}
      <Modal
        title="评估进度"
        open={progressModalEvalId != null}
        onCancel={() => setProgressModalEvalId(null)}
        footer={[
          <Button
            key="refresh"
            icon={<SyncOutlined />}
            loading={progressModalRefreshing}
            onClick={refreshProgressModalStatus}
          >
            刷新状态
          </Button>,
          <Button key="close" type="primary" onClick={() => setProgressModalEvalId(null)}>
            关闭
          </Button>,
        ]}
        width={600}
        destroyOnClose
      >
        {progressModalEvalId != null && (() => {
          const evalRow = evaluations.find((e) => e.id === progressModalEvalId);
          if (!evalRow) return <Spin tip="加载中…" />;
          const hasReport = !!evalRow.report_path;
          const rawStatus = evalRow.status || 'completed';
          const status = rawStatus === 'running' && hasReport ? 'completed' : rawStatus;
          const isEnd = status === 'completed' || status === 'failed' || status === 'cancelled';
          const currentStep = status === 'running' ? 2 : isEnd ? 4 : 1; // running 时高亮「评估中」
          const steps: { title: string; description?: string; status: StepStatus }[] = [
            {
              title: '准备中',
              description: '加载模型与测试数据集',
              status: status === 'running' ? 'finish' : isEnd ? 'finish' : 'process',
            },
            {
              title: '评估中',
              description: status === 'running' ? '推理并计算准确率、F1 等指标…' : '推理并计算指标',
              status: status === 'running' ? 'process' : isEnd ? 'finish' : 'wait',
            },
            {
              title: '生成报告',
              description: '混淆矩阵、ROC 曲线、HTML 报告',
              status: status === 'running' ? 'wait' : isEnd ? 'finish' : 'wait',
            },
            {
              title: status === 'completed' ? '已完成' : status === 'failed' ? '评估失败' : status === 'cancelled' ? '已取消' : '完成',
              description: (status === 'failed' || status === 'cancelled') && evalRow.error_message ? evalRow.error_message : undefined,
              status: status === 'running' ? 'wait' : status === 'completed' ? 'finish' : 'error',
            },
          ];
          return (
            <div>
              {/* 基本信息区：模型 / 测试集 / 创建时间 / 状态 */}
              <div style={{ marginBottom: 16, padding: 12, background: '#fafafa', borderRadius: 8, fontSize: 13 }}>
                <div style={{ marginBottom: 4 }}>
                  <span style={{ color: '#8c8c8c' }}>评估名称：</span>
                  <span style={{ fontWeight: 500 }}>{getTaskName(evalRow)}</span>
                </div>
                <div style={{ marginBottom: 4 }}>
                  <span style={{ color: '#8c8c8c' }}>模型 ID：</span>
                  <span>{evalRow.model_id}</span>
                </div>
                <div style={{ marginBottom: 4 }}>
                  <span style={{ color: '#8c8c8c' }}>创建时间：</span>
                  <span>{new Date(evalRow.created_at).toLocaleString('zh-CN')}</span>
                </div>
                <div>
                  <span style={{ color: '#8c8c8c' }}>当前状态：</span>
                  <span>
                    {status === 'running'
                      ? '评估中：正在用测试集跑推理并计算各项指标'
                      : status === 'completed'
                      ? '已完成：指标和报告均已生成'
                      : status === 'failed'
                      ? '评估失败：可查看失败原因洞察与原始输出'
                      : '已取消'}
                  </span>
                </div>
              </div>

              <Steps
                current={currentStep}
                status={status === 'failed' || status === 'cancelled' ? 'error' : 'finish'}
                direction="vertical"
                items={steps}
              />
              {status === 'running' && (
                <div style={{ marginTop: 16, padding: 12, background: '#e6f7ff', borderRadius: 8, fontSize: 13, color: '#0050b3' }}>
                  状态每 2 秒自动刷新。当前阶段主要在「评估中」和「生成报告」之间切换。若超过 5～10 分钟仍无变化，请查看运行后端的终端是否有报错，或点击「刷新状态」再试。
                </div>
              )}
              {(status === 'failed' || status === 'cancelled') && evalRow.error_message && (
                <div style={{ marginTop: 16, padding: 12, background: '#fff2f0', borderRadius: 8, color: '#cf1322' }}>
                  {evalRow.error_message}
                </div>
              )}
            </div>
          );
        })()}
      </Modal>

      <Modal
        title="预览报告"
        open={previewReportEvalId != null}
        onCancel={() => setPreviewReportEvalId(null)}
        footer={null}
        width="90%"
        style={{ top: 24 }}
        destroyOnClose
      >
        {previewReportEvalId != null && (
          <>
            {previewReportError && (
              <div style={{ padding: 24, textAlign: 'center', color: '#8c8c8c' }}>
                该评估暂无报告或报告未生成，请尝试「下载报告」或重新运行评估。
              </div>
            )}
            {!previewReportError && !previewReportUrl && (
              <div style={{ padding: 24, textAlign: 'center' }}>
                <Spin tip="加载报告中…" />
              </div>
            )}
            {!previewReportError && previewReportUrl && (
              <iframe
                title="评估报告"
                src={previewReportUrl}
                style={{ width: '100%', height: '75vh', border: 'none' }}
              />
            )}
          </>
        )}
      </Modal>

      {/* 评估详情弹窗：当前进度 / 成功阶段 / 失败原因（含控制台与脚本输出） */}
      <Modal
        title={detailModalEvalId != null ? `评估详情 · ${getTaskName(evaluations.find((e) => e.id === detailModalEvalId) ?? { id: 0, model_id: 0, created_at: '' } as Evaluation)}` : '评估详情'}
        open={detailModalEvalId != null}
        onCancel={() => setDetailModalEvalId(null)}
        footer={[
          <Button
            key="refresh"
            icon={<SyncOutlined />}
            onClick={async () => {
              if (detailModalEvalId == null) return;
              try {
                const res = await evaluationService.getEvaluationResult(detailModalEvalId);
                if (res.code === 200 && res.data) {
                  const d = res.data as Evaluation;
                  setEvaluations((prev) => prev.map((e) => (e.id === detailModalEvalId ? { ...e, ...d } : e)));
                  message.success('已刷新评估详情');
                }
              } catch (e: any) {
                if (e?.status === 404) {
                  setDetailModalEvalId(null);
                  message.info('该评估不存在或已删除，已关闭详情窗口');
                  fetchEvaluations();
                } else {
                  message.error(e?.message || '刷新失败');
                }
              }
            }}
          >
            刷新
          </Button>,
          <Button key="close" type="primary" onClick={() => setDetailModalEvalId(null)}>
            关闭
          </Button>,
        ]}
        width={640}
        destroyOnClose
      >
        {detailModalEvalId != null && (() => {
          const r = evaluations.find((e) => e.id === detailModalEvalId);
          if (!r) return <Spin tip="加载中…" />;
          const rawStatus = r.status || 'completed';
          const hasReport = !!r.report_path;
          const status = rawStatus === 'running' && hasReport ? 'completed' : rawStatus;
          const isEnd = status === 'completed' || status === 'failed' || status === 'cancelled';
          const stepCurrent = status === 'running' ? 2 : isEnd ? 4 : 1;
          const steps: { title: string; description?: string; status: StepStatus }[] = [
            { title: '准备中', description: '加载模型与测试数据集', status: status === 'running' ? 'finish' : isEnd ? 'finish' : 'process' },
            { title: '评估中', description: '推理并计算准确率、F1 等指标', status: status === 'running' ? 'process' : isEnd ? 'finish' : 'wait' },
            { title: '生成报告', description: '混淆矩阵、ROC 曲线、HTML 报告', status: status === 'running' ? 'wait' : isEnd ? 'finish' : 'wait' },
            {
              title: status === 'completed' ? '已完成' : status === 'failed' ? '评估失败' : status === 'cancelled' ? '已取消' : '完成',
              description: undefined,
              status: status === 'running' ? 'wait' : status === 'completed' ? 'finish' : 'error',
            },
          ];
          return (
            <div>
              <div style={{ marginBottom: 16, fontSize: 13, color: '#666' }}>
                {status === 'running' && '当前评估进度如下，状态会定期刷新。'}
                {status === 'completed' && '以下为本次评估的成功阶段，可在此页预览或下载报告。'}
                {status === 'failed' && '评估未完成，下方展示来自控制台或脚本的失败原因与输出。'}
                {status === 'cancelled' && '该任务已取消，若有说明将显示在下方。'}
              </div>
              <Steps
                current={stepCurrent}
                status={status === 'failed' || status === 'cancelled' ? 'error' : 'finish'}
                direction="vertical"
                items={steps}
              />
              {(status === 'failed' || status === 'cancelled') && (r.error_message?.trim() || '') && (
                <div style={{ marginTop: 20 }}>
                  {/* 失败原因洞察：问题归类 + 摘要 + 建议操作 */}
                  <div style={{ marginBottom: 16, padding: 12, background: '#fff7e6', border: '1px solid #ffd591', borderRadius: 8 }}>
                    <div style={{ fontWeight: 600, marginBottom: 8, color: '#d46b08' }}>失败原因洞察</div>
                    {insightLoading ? (
                      <Spin size="small" tip="解析中…" />
                    ) : insightData ? (
                      <>
                        <div style={{ marginBottom: 6 }}>
                          <span style={{ color: '#666', marginRight: 6 }}>问题归类：</span>
                          <Tag color="orange">{insightData.category}</Tag>
                        </div>
                        <div style={{ marginBottom: 8, fontSize: 13, color: '#262626' }}>{insightData.summary}</div>
                        <div style={{ fontSize: 12, color: '#595959' }}>
                          <span style={{ fontWeight: 600 }}>建议操作：</span>
                          <ul style={{ margin: '4px 0 0 0', paddingLeft: 18 }}>
                            {insightData.suggestions.map((s, i) => (
                              <li key={i}>{s}</li>
                            ))}
                          </ul>
                        </div>
                      </>
                    ) : (
                      <span style={{ fontSize: 12, color: '#8c8c8c' }}>暂无结构化洞察，请查看下方原始输出。</span>
                    )}
                  </div>
                  <div style={{ marginBottom: 8, fontWeight: 600, color: status === 'failed' ? '#cf1322' : '#666' }}>
                    原始输出（控制台 / 脚本）
                  </div>
                  <pre
                    style={{
                      margin: 0,
                      padding: 12,
                      background: '#f5f5f5',
                      borderRadius: 8,
                      border: '1px solid #e8e8e8',
                      maxHeight: 360,
                      overflow: 'auto',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      fontSize: 12,
                      color: '#262626',
                    }}
                  >
                    {r.error_message}
                  </pre>
                </div>
              )}
            </div>
          );
        })()}
      </Modal>
    </div>
  );
};

export default EvaluationManagement;
