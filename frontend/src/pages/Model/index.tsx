import React, { useEffect, useState } from 'react';
import { Card, Table, Button, message } from 'antd';
import { ReloadOutlined, DownloadOutlined } from '@ant-design/icons';
import { modelService } from '@/services/model';
import type { Model } from '@/types';

const ModelManagement: React.FC = () => {
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchModels = async () => {
    setLoading(true);
    try {
      const response = await modelService.getModels();
      if (response.code === 200 && response.data) {
        setModels(response.data.models || []);
      }
    } catch (error: any) {
      message.error(error.message || '获取模型列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchModels();
  }, []);

  const columns = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 80,
    },
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: '训练任务ID',
      dataIndex: 'job_id',
      key: 'job_id',
      width: 120,
    },
    {
      title: '模型类型',
      dataIndex: 'model_type',
      key: 'model_type',
      width: 140,
    },
    {
      title: '框架',
      dataIndex: 'framework',
      key: 'framework',
      width: 100,
    },
    {
      title: '大小',
      dataIndex: 'model_size',
      key: 'model_size',
      width: 100,
      render: (size: number) =>
        size ? `${(size / 1024 / 1024).toFixed(2)} MB` : '—',
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
      width: 120,
      render: (_: any, record: Model) => (
        <Button
          type="primary"
          icon={<DownloadOutlined />}
          href={modelService.getDownloadUrl(record.id)}
          target="_blank"
          rel="noopener noreferrer"
        >
          下载
        </Button>
      ),
    },
  ];

  return (
    <div>
      <Card
        title="模型管理"
        extra={
          <Button icon={<ReloadOutlined />} onClick={fetchModels}>
            刷新
          </Button>
        }
      >
        <Table
          columns={columns}
          dataSource={models}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
          locale={{ emptyText: '暂无模型，请先完成训练任务' }}
        />
      </Card>
    </div>
  );
};

export default ModelManagement;
