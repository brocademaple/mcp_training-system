import React, { useEffect, useState } from 'react';
import {
  Card,
  Table,
  Button,
  Modal,
  Form,
  Select,
  message,
  Tag,
  Steps,
  Spin,
  Popconfirm,
  Progress,
  Tooltip,
} from 'antd';
import { PlusOutlined, ReloadOutlined, DownloadOutlined, SyncOutlined, StopOutlined, DeleteOutlined, EyeOutlined } from '@ant-design/icons';
import { evaluationService } from '@/services/evaluation';
import { modelService } from '@/services/model';
import { datasetService } from '@/services/dataset';
import type { Evaluation, Model, Dataset } from '@/types';

type StepStatus = 'wait' | 'process' | 'finish' | 'error';

const EvaluationManagement: React.FC = () => {
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

  const openCreateModal = () => {
    setCreateModalVisible(true);
    fetchModels();
    fetchDatasets();
  };

  const handleCreateEvaluation = async (values: any) => {
    try {
      await evaluationService.createEvaluation({
        model_id: values.model_id,
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
      width: 72,
      render: (_: unknown, __: Evaluation, index: number) => (page - 1) * pageSize + index + 1,
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
      width: 160,
      render: (status: string, record: Evaluation) => {
        const s = status || 'completed';
        if (s === 'running') {
          const created = new Date(record.created_at).getTime();
          const mins = Math.floor((Date.now() - created) / 60000);
          const tip = mins > 0 ? `已运行 ${mins} 分钟，列表每 4 秒自动刷新` : '列表每 4 秒自动刷新';
          return (
            <Tag color="processing" title={tip}>
              评估中{mins > 0 ? `（${mins} 分钟）` : ''}
            </Tag>
          );
        }
        if (s === 'failed') {
          const tip = record.error_message
            ? `${record.error_message}`
            : '评估失败，请查看详情或重新运行';
          return (
            <Tooltip title={tip} placement="topLeft">
              <Tag color="error">失败（悬停查看原因与解决措施）</Tag>
            </Tooltip>
          );
        }
        if (s === 'cancelled') return <Tag color="default">已取消</Tag>;
        return <Tag color="success">已完成</Tag>;
      },
    },
    {
      title: '当前进度',
      key: 'progress',
      width: 140,
      render: (_: unknown, record: Evaluation) => {
        const s = record.status || 'completed';
        if (s === 'running') {
          return <Progress percent={50} status="active" size="small" showInfo={false} />;
        }
        if (s === 'failed') {
          return <Progress percent={0} status="exception" size="small" />;
        }
        if (s === 'cancelled') {
          return <Progress percent={0} size="small" />;
        }
        return <Progress percent={100} status="success" size="small" />;
      },
    },
    {
      title: '准确率',
      dataIndex: 'accuracy',
      key: 'accuracy',
      width: 100,
      render: (value: number, record: Evaluation) =>
        record.status === 'running' || record.status === 'cancelled' ? '—' : `${((value ?? 0) * 100).toFixed(2)}%`,
    },
    {
      title: 'F1分数',
      dataIndex: 'f1_score',
      key: 'f1_score',
      width: 100,
      render: (value: number, record: Evaluation) =>
        record.status === 'running' || record.status === 'cancelled' ? '—' : `${((value ?? 0) * 100).toFixed(2)}%`,
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
      render: (_: any, record: Evaluation) => (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0 }}>
          {record.status === 'running' && (
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
          {record.status === 'running' && (
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
      ),
    },
  ];

  return (
    <div>
      <Card
        title="模型评估管理"
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
          const status = evalRow.status || 'completed';
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
              <Steps
                current={currentStep}
                status={status === 'failed' || status === 'cancelled' ? 'error' : 'finish'}
                direction="vertical"
                items={steps}
              />
              {status === 'running' && (
                <div style={{ marginTop: 16, padding: 12, background: '#e6f7ff', borderRadius: 8, fontSize: 13, color: '#0050b3' }}>
                  状态每 2 秒自动刷新。若超过 5～10 分钟仍无变化，请查看运行后端的终端是否有报错，或点击「刷新状态」再试。
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
    </div>
  );
};

export default EvaluationManagement;
