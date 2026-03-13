import React, { useEffect, useState } from 'react';
import { Card, Row, Col, Statistic, Table, Tag, Button, message } from 'antd';
import {
  DatabaseOutlined,
  ExperimentOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import { datasetService } from '@/services/dataset';
import { trainingService } from '@/services/training';
import { syncService } from '@/services/sync';
import type { Dataset } from '@/types';
import type { TrainingJob } from '@/types';

const Dashboard: React.FC = () => {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [jobs, setJobs] = useState<TrainingJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    fetchDatasets();
    fetchJobs();
  }, []);

  // 有排队中/训练中时定期刷新任务数，使仪表盘与训练页一致
  useEffect(() => {
    const hasPending = jobs.some((j) => j.status === 'queued' || j.status === 'running');
    if (!hasPending) return;
    const timer = setInterval(fetchJobs, 4000);
    return () => clearInterval(timer);
  }, [jobs]);

  const fetchJobs = async () => {
    try {
      const res = await trainingService.getJobs();
      if (res.code === 200 && res.data?.jobs) {
        setJobs(res.data.jobs);
      }
    } catch (_) {
      // 静默失败，不打扰用户
    }
  };

  const fetchDatasets = async () => {
    setLoading(true);
    try {
      const response = await datasetService.getDatasets();
      if (response.code === 200 && response.data) {
        setDatasets(response.data.datasets || []);
      }
    } catch (error) {
      console.error('Failed to fetch datasets:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSyncFromDisk = async () => {
    setSyncing(true);
    try {
      const res = await syncService.syncFromDisk();
      if (res.code === 200 && res.data) {
        const { datasets_recovered = 0, models_recovered = 0, message: msg } = res.data;
        message.success(msg || `已恢复 ${datasets_recovered} 个数据集、${models_recovered} 个模型`);
        fetchDatasets();
        fetchJobs();
      } else {
        message.warning((res as any).message || '同步完成');
      }
    } catch (e: any) {
      message.error(e.message || '一键同步失败');
    } finally {
      setSyncing(false);
    }
  };

  const readyCount = datasets.filter((d) => d.status === 'ready').length;
  const processingCount = datasets.filter((d) => d.status === 'processing').length;

  const columns = [
    {
      title: '数据集名称',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => {
        const colorMap: Record<string, string> = {
          ready: 'success',
          processing: 'processing',
          uploading: 'default',
          error: 'error',
        };
        return <Tag color={colorMap[status]}>{status}</Tag>;
      },
    },
    {
      title: '行数',
      dataIndex: 'row_count',
      key: 'row_count',
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (text: string) => new Date(text).toLocaleString('zh-CN'),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ margin: 0 }}>仪表盘</h1>
        <Button
          type="primary"
          icon={<SyncOutlined />}
          loading={syncing}
          onClick={handleSyncFromDisk}
        >
          一键同步数据
        </Button>
      </div>
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card>
            <Statistic
              title="总数据集"
              value={datasets.length}
              prefix={<DatabaseOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="就绪数据集"
              value={readyCount}
              prefix={<CheckCircleOutlined />}
              valueStyle={{ color: '#3f8600' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="处理中"
              value={processingCount}
              prefix={<ClockCircleOutlined />}
              valueStyle={{ color: '#1890ff' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="训练任务"
              value={jobs.length}
              prefix={<ExperimentOutlined />}
            />
          </Card>
        </Col>
      </Row>

      <Card title="最近数据集" loading={loading}>
        <Table
          columns={columns}
          dataSource={datasets.slice(0, 5)}
          rowKey="id"
          pagination={false}
        />
      </Card>
    </div>
  );
};

export default Dashboard;
