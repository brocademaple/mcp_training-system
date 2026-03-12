import React, { useEffect, useState } from 'react';
import {
  Card,
  Table,
  Button,
  Modal,
  Form,
  Select,
  message,
  Descriptions,
  Tag,
  Steps,
  Spin,
} from 'antd';
import { PlusOutlined, ReloadOutlined, EyeOutlined, DownloadOutlined, SyncOutlined } from '@ant-design/icons';
import { evaluationService } from '@/services/evaluation';
import { modelService } from '@/services/model';
import { datasetService } from '@/services/dataset';
import type { Evaluation, Model, Dataset } from '@/types';

type StepStatus = 'wait' | 'process' | 'finish' | 'error';

const EvaluationManagement: React.FC = () => {
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [loading, setLoading] = useState(false);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [progressModalEvalId, setProgressModalEvalId] = useState<number | null>(null);
  const [selectedEvaluation, setSelectedEvaluation] = useState<Evaluation | null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [datasetsLoading, setDatasetsLoading] = useState(false);
  const [progressModalRefreshing, setProgressModalRefreshing] = useState(false);
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

  // 进度弹窗打开时拉取一次该评估详情
  useEffect(() => {
    if (progressModalEvalId == null) return;
    evaluationService.getEvaluationResult(progressModalEvalId).then((res) => {
      if (res.code === 200 && res.data) {
        const d = res.data as Evaluation;
        setEvaluations((prev) =>
          prev.map((e) => (e.id === progressModalEvalId ? { ...e, ...d } : e))
        );
      }
    }).catch(() => {});
  }, [progressModalEvalId]);

  // 进度弹窗常驻时：若该任务为「评估中」，每 2 秒拉取最新状态
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
      }).catch(() => {});
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
      const res = await datasetService.getDatasets();
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

  const showDetail = (evaluation: Evaluation) => {
    setSelectedEvaluation(evaluation);
    setDetailModalVisible(true);
  };

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
      message.error(e?.message || '刷新失败');
    } finally {
      setProgressModalRefreshing(false);
    }
  };

  const columns = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 80,
    },
    {
      title: '模型ID',
      dataIndex: 'model_id',
      key: 'model_id',
      width: 100,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string) => {
        const s = status || 'completed';
        if (s === 'running') return <Tag color="processing">评估中</Tag>;
        if (s === 'failed') return <Tag color="error">失败</Tag>;
        return <Tag color="success">已完成</Tag>;
      },
    },
    {
      title: '准确率',
      dataIndex: 'accuracy',
      key: 'accuracy',
      width: 120,
      render: (value: number, record: Evaluation) =>
        record.status === 'running' ? '—' : `${((value ?? 0) * 100).toFixed(2)}%`,
    },
    {
      title: 'F1分数',
      dataIndex: 'f1_score',
      key: 'f1_score',
      width: 120,
      render: (value: number, record: Evaluation) =>
        record.status === 'running' ? '—' : `${((value ?? 0) * 100).toFixed(2)}%`,
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 180,
      render: (text: string) => new Date(text).toLocaleString('zh-CN'),
    },
    {
      title: '操作',
      key: 'action',
      width: 180,
      render: (_: any, record: Evaluation) => (
        <>
          {record.status === 'running' && (
            <Button
              type="link"
              icon={<SyncOutlined />}
              onClick={() => setProgressModalEvalId(record.id)}
              style={{ paddingRight: 8 }}
            >
              查看进度
            </Button>
          )}
          <Button
            type="link"
            icon={<EyeOutlined />}
            onClick={() => showDetail(record)}
          >
            查看详情
          </Button>
        </>
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
          pagination={{ pageSize: 10 }}
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

      <Modal
        title="评估详情"
        open={detailModalVisible}
        onCancel={() => setDetailModalVisible(false)}
        footer={[
          selectedEvaluation?.report_path ? (
            <Button
              key="download"
              type="primary"
              icon={<DownloadOutlined />}
              href={evaluationService.getReportDownloadUrl(selectedEvaluation.id)}
              target="_blank"
              rel="noopener noreferrer"
            >
              下载报告
            </Button>
          ) : null,
          <Button key="close" onClick={() => setDetailModalVisible(false)}>
            关闭
          </Button>,
        ].filter(Boolean)}
        width={700}
      >
        {selectedEvaluation && (
          <Descriptions bordered column={2}>
            <Descriptions.Item label="评估ID">
              {selectedEvaluation.id}
            </Descriptions.Item>
            <Descriptions.Item label="模型ID">
              {selectedEvaluation.model_id}
            </Descriptions.Item>
            <Descriptions.Item label="状态">
              {selectedEvaluation.status === 'running' ? (
                <Tag color="processing">评估中</Tag>
              ) : selectedEvaluation.status === 'failed' ? (
                <Tag color="error">失败</Tag>
              ) : (
                <Tag color="success">已完成</Tag>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="准确率">
              {selectedEvaluation.status === 'running' ? (
                '—'
              ) : (
                <Tag color="blue">
                  {((selectedEvaluation.accuracy ?? 0) * 100).toFixed(2)}%
                </Tag>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="精确率">
              {selectedEvaluation.status === 'running' ? '—' : (
                <Tag color="green">
                  {((selectedEvaluation.precision ?? 0) * 100).toFixed(2)}%
                </Tag>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="召回率">
              {selectedEvaluation.status === 'running' ? '—' : (
                <Tag color="orange">
                  {((selectedEvaluation.recall ?? 0) * 100).toFixed(2)}%
                </Tag>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="F1分数">
              {selectedEvaluation.status === 'running' ? '—' : (
                <Tag color="purple">
                  {((selectedEvaluation.f1_score ?? 0) * 100).toFixed(2)}%
                </Tag>
              )}
            </Descriptions.Item>
            {(selectedEvaluation.status === 'failed' && selectedEvaluation.error_message) && (
              <Descriptions.Item label="失败原因" span={2}>
                <span style={{ color: '#cf1322' }}>{selectedEvaluation.error_message}</span>
              </Descriptions.Item>
            )}
            <Descriptions.Item label="创建时间" span={2}>
              {new Date(selectedEvaluation.created_at).toLocaleString('zh-CN')}
            </Descriptions.Item>
          </Descriptions>
        )}
      </Modal>

      {/* 评估进度弹窗：参考训练页，根据 status 展示步骤与错误信息 */}
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
        width={560}
        destroyOnClose
      >
        {progressModalEvalId != null && (() => {
          const evalRow = evaluations.find((e) => e.id === progressModalEvalId);
          if (!evalRow) return <Spin tip="加载中…" />;
          const status = evalRow.status || 'completed';
          const steps: { title: string; description?: string; status: StepStatus }[] = [
            {
              title: '评估中',
              description: status === 'running' ? '正在评估模型，请稍候…' : undefined,
              status: status === 'running' ? 'process' : status === 'failed' ? 'error' : 'finish',
            },
            {
              title: status === 'completed' ? '已完成' : status === 'failed' ? '评估失败' : '完成',
              description: status === 'failed' && evalRow.error_message ? evalRow.error_message : undefined,
              status: status === 'running' ? 'wait' : status === 'failed' ? 'error' : 'finish',
            },
          ];
          return (
            <div>
              <Steps current={status === 'running' ? 0 : 1} status={status === 'failed' ? 'error' : 'finish'} items={steps} />
              {status === 'failed' && evalRow.error_message && (
                <div style={{ marginTop: 16, padding: 12, background: '#fff2f0', borderRadius: 8, color: '#cf1322' }}>
                  {evalRow.error_message}
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
