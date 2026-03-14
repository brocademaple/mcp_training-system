import React, { useState, useEffect } from 'react';
import { Card, Button, Select, Steps, Table, message, Tag, Space } from 'antd';
import { RobotOutlined, CheckCircleOutlined, LoadingOutlined, CloseCircleOutlined } from '@ant-design/icons';
import axios from 'axios';

const API_BASE = 'http://localhost:8080/api/v1';

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

const Pipeline: React.FC = () => {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedDataset, setSelectedDataset] = useState<number>();
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchDatasets();
    fetchPipelines();
    const interval = setInterval(fetchPipelines, 3000);
    return () => clearInterval(interval);
  }, []);

  const fetchDatasets = async () => {
    try {
      const res = await axios.get(`${API_BASE}/datasets`);
      setDatasets(res.data.filter((d: Dataset) => d.status === 'cleaned'));
    } catch (err) {
      message.error('获取数据集失败');
    }
  };

  const fetchPipelines = async () => {
    try {
      const res = await axios.get(`${API_BASE}/pipelines`);
      setPipelines(res.data || []);
    } catch (err) {}
  };

  const handleStart = async () => {
    if (!selectedDataset) {
      message.warning('请选择数据集');
      return;
    }
    setLoading(true);
    try {
      await axios.post(`${API_BASE}/pipelines`, {
        dataset_id: selectedDataset,
        train_config: { model_type: 'random_forest' }
      });
      message.success('流水线已启动');
      fetchPipelines();
    } catch (err: any) {
      message.error(err.response?.data?.error || '启动失败');
    } finally {
      setLoading(false);
    }
  };

  const getStepStatus = (p: Pipeline, step: string) => {
    const steps = ['clean_data', 'train', 'evaluate'];
    const currentIdx = steps.indexOf(p.current_step);
    const stepIdx = steps.indexOf(step);
    if (p.status === 'failed' && p.current_step === step) return 'error';
    if (p.status === 'completed') return 'finish';
    if (stepIdx < currentIdx) return 'finish';
    if (stepIdx === currentIdx) return 'process';
    return 'wait';
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    { title: '数据集ID', dataIndex: 'dataset_id', width: 100 },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (s: string) => (
        <Tag color={s === 'completed' ? 'green' : s === 'failed' ? 'red' : 'blue'}>{s}</Tag>
      )
    },
    {
      title: '当前步骤',
      dataIndex: 'current_step',
      render: (step: string, record: Pipeline) => (
        <Steps size="small" current={['clean_data', 'train', 'evaluate'].indexOf(step)} style={{ width: 300 }}>
          <Steps.Step title="清洗" status={getStepStatus(record, 'clean_data')} />
          <Steps.Step title="训练" status={getStepStatus(record, 'train')} />
          <Steps.Step title="评估" status={getStepStatus(record, 'evaluate')} />
        </Steps>
      )
    },
    { title: '任务ID', dataIndex: 'job_id', width: 80 },
    { title: '模型ID', dataIndex: 'model_id', width: 80 },
    { title: '错误', dataIndex: 'error_msg', ellipsis: true }
  ];

  return (
    <div style={{ padding: 24 }}>
      <Card title={<><RobotOutlined /> 一键流水线</>} style={{ marginBottom: 24 }}>
        <Space>
          <Select
            placeholder="选择数据集"
            style={{ width: 300 }}
            value={selectedDataset}
            onChange={setSelectedDataset}
            options={datasets.map(d => ({ label: d.name, value: d.id }))}
          />
          <Button type="primary" onClick={handleStart} loading={loading}>
            启动流水线（清洗→训练→评估）
          </Button>
        </Space>
      </Card>
      <Card title="流水线列表">
        <Table dataSource={pipelines} columns={columns} rowKey="id" pagination={{ pageSize: 10 }} />
      </Card>
    </div>
  );
};

export default Pipeline;
