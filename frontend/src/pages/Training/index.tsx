import React, { useEffect, useRef, useState } from 'react';
import {
  Card,
  Table,
  Button,
  Modal,
  Form,
  Select,
  InputNumber,
  message,
  Tag,
  Progress,
} from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { trainingService } from '@/services/training';
import { datasetService } from '@/services/dataset';
import type { TrainingJob, Dataset } from '@/types';

const TrainingManagement: React.FC = () => {
  const [jobs, setJobs] = useState<TrainingJob[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [loading, setLoading] = useState(false);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [form] = Form.useForm();
  const wsRefs = useRef<Record<number, WebSocket>>({});

  useEffect(() => {
    fetchDatasets();
    fetchJobs();
  }, []);

  const fetchJobs = async () => {
    setLoading(true);
    try {
      const response = await trainingService.getJobs();
      if (response.code === 200 && response.data?.jobs) {
        setJobs(response.data.jobs);
      }
    } catch (error: any) {
      message.error(error.message || '获取训练任务列表失败');
    } finally {
      setLoading(false);
    }
  };

  const fetchDatasets = async () => {
    try {
      const response = await datasetService.getDatasets();
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

  const handleCreateJob = async (values: any) => {
    try {
      await trainingService.createJob({
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
              if (status === 'failed') next.status = 'failed';
              return next;
            })
          );
          if (status === 'completed' || status === 'failed') {
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

  const columns = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 80,
    },
    {
      title: '数据集ID',
      dataIndex: 'dataset_id',
      key: 'dataset_id',
      width: 100,
    },
    {
      title: '模型类型',
      dataIndex: 'model_type',
      key: 'model_type',
      width: 150,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (status: string) => {
        const colorMap: Record<string, string> = {
          queued: 'default',
          running: 'processing',
          completed: 'success',
          failed: 'error',
        };
        return <Tag color={colorMap[status]}>{status}</Tag>;
      },
    },
    {
      title: '进度',
      dataIndex: 'progress',
      key: 'progress',
      width: 200,
      render: (progress: number, record: TrainingJob) => (
        <div>
          <Progress percent={progress} size="small" />
          <div style={{ fontSize: 12, color: '#666' }}>
            Epoch: {record.current_epoch}/{record.total_epochs}
          </div>
        </div>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 180,
      render: (text: string) => new Date(text).toLocaleString('zh-CN'),
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
              onClick={fetchJobs}
              style={{ marginRight: 8 }}
            >
              刷新
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setCreateModalVisible(true)}
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
