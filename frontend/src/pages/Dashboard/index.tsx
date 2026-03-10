import React, { useEffect, useState } from 'react';
import { Card, Row, Col, Statistic, Table, Tag } from 'antd';
import {
  DatabaseOutlined,
  ExperimentOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';
import { datasetService } from '@/services/dataset';
import type { Dataset } from '@/types';

const Dashboard: React.FC = () => {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchDatasets();
  }, []);

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
      <h1>仪表盘</h1>
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
              value={0}
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
