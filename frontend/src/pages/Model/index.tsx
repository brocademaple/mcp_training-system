import React, { useEffect, useState } from 'react';
import { Card, Table, Button, message, Tooltip, Typography } from 'antd';
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

  const formatSize = (size: number | null | undefined): string => {
    if (size == null || size === 0) return '—';
    const n = Number(size);
    if (Number.isNaN(n) || n <= 0) return '—';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(2)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
  };

  const getModelSizeNum = (raw: unknown): number | null => {
    if (raw == null) return null;
    if (typeof raw === 'number' && !Number.isNaN(raw)) return raw;
    if (typeof raw === 'object' && raw !== null && 'Int64' in (raw as object))
      return (raw as { Int64: number }).Int64;
    const n = Number(raw);
    return Number.isNaN(n) ? null : n;
  };

  const columns = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 72,
    },
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      width: 160,
      ellipsis: true,
      render: (name: string) => name || '—',
    },
    {
      title: '训练任务',
      dataIndex: 'job_id',
      key: 'job_id',
      width: 96,
    },
    {
      title: '模型类型',
      dataIndex: 'model_type',
      key: 'model_type',
      width: 160,
      ellipsis: true,
      render: (v: string) => (v ? <Tooltip title={v}><span style={{ whiteSpace: 'nowrap' }}>{v}</span></Tooltip> : '—'),
    },
    {
      title: '框架',
      dataIndex: 'framework',
      key: 'framework',
      width: 96,
      render: (v: string) => v || '—',
    },
    {
      title: '大小',
      dataIndex: 'model_size',
      key: 'model_size',
      width: 100,
      render: (size: unknown) => formatSize(getModelSizeNum(size)),
    },
    {
      title: '存储路径',
      dataIndex: 'model_path',
      key: 'model_path',
      ellipsis: true,
      render: (path: string) =>
        path ? (
          <Tooltip title={path}>
            <Typography.Text copyable={{ text: path }} style={{ maxWidth: 200 }} ellipsis>
              {path}
            </Typography.Text>
          </Tooltip>
        ) : (
          '—'
        ),
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 172,
      render: (text: string) => (text ? new Date(text).toLocaleString('zh-CN') : '—'),
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      minWidth: 100,
      fixed: 'right' as const,
      render: (_: any, record: Model) => (
        <span style={{ display: 'inline-block', maxWidth: '100%' }}>
          <Button
            type="primary"
            size="small"
            icon={<DownloadOutlined />}
            href={modelService.getDownloadUrl(record.id)}
            target="_blank"
            rel="noopener noreferrer"
            style={{ maxWidth: '100%' }}
          >
            下载
          </Button>
        </span>
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
          scroll={{ x: 'max-content' }}
        />
      </Card>
    </div>
  );
};

export default ModelManagement;
