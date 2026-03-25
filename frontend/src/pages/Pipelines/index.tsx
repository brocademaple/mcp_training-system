import React, { useEffect, useState } from 'react';
import { Card, Table, Button, Tag, message, Alert } from 'antd';
import { ReloadOutlined, RocketOutlined } from '@ant-design/icons';
import { pipelineService, type PipelineInstance } from '@/services/pipeline';
import './index.css';

const statusMap: Record<string, { color: string; text: string }> = {
  running: { color: 'processing', text: '运行中' },
  completed: { color: 'success', text: '已完成' },
  failed: { color: 'error', text: '失败' },
  pending: { color: 'default', text: '待执行' },
};

/** 无真实数据时展示的示例数据（明确标注，流水线历史功能开发中） */
const EXAMPLE_PIPELINES: (PipelineInstance & { _example?: boolean })[] = [
  { id: -1, session_id: 'demo-sess-01', dataset_id: 1, status: 'completed', current_step: 'evaluate', job_id: 1, model_id: 1, eval_id: 1, created_at: new Date().toISOString(), _example: true },
  { id: -2, session_id: 'demo-sess-02', dataset_id: 2, status: 'running', current_step: 'train', job_id: 2, model_id: undefined, eval_id: undefined, created_at: new Date().toISOString(), _example: true },
  { id: -3, session_id: 'demo-sess-03', dataset_id: 3, status: 'pending', current_step: '', job_id: undefined, model_id: undefined, eval_id: undefined, created_at: new Date().toISOString(), _example: true },
];

const PipelinesPage: React.FC = () => {
  const [list, setList] = useState<PipelineInstance[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);

  const fetchList = async (silent = false) => {
    if (!silent) setLoading(true);
    setFetchError(false);
    try {
      const data = await pipelineService.list();
      setList(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setFetchError(true);
      if (!silent) message.error(e?.message || '获取流水线列表失败');
      setList([]);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchList();
  }, []);

  const showExample = !loading && list.length === 0;
  const dataSource = showExample ? EXAMPLE_PIPELINES : list;

  const columns = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 72,
      render: (v: number, r: PipelineInstance & { _example?: boolean }) =>
        r._example ? <span>{v} <Tag color="orange">示例</Tag></span> : v,
    },
    { title: '会话', dataIndex: 'session_id', key: 'session_id', width: 120, ellipsis: true, render: (s: string) => s?.slice(0, 8) + '…' },
    { title: '数据集 ID', dataIndex: 'dataset_id', key: 'dataset_id', width: 96 },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (s: string) => {
        const t = statusMap[s] || { color: 'default', text: s };
        return <Tag color={t.color}>{t.text}</Tag>;
      },
    },
    { title: '当前步骤', dataIndex: 'current_step', key: 'current_step', width: 100 },
    { title: '训练任务', dataIndex: 'job_id', key: 'job_id', width: 96, render: (v: number) => v ?? '—' },
    { title: '模型', dataIndex: 'model_id', key: 'model_id', width: 96, render: (v: number) => v ?? '—' },
    { title: '评估', dataIndex: 'eval_id', key: 'eval_id', width: 96, render: (v: number) => v ?? '—' },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 170,
      render: (t: string) => (t ? new Date(t).toLocaleString('zh-CN') : '—'),
    },
    {
      title: '错误',
      dataIndex: 'error_msg',
      key: 'error_msg',
      ellipsis: true,
      render: (t: string) => (t ? <span style={{ color: '#cf1322', fontSize: 12 }}>{t}</span> : '—'),
    },
  ];

  return (
    <Card
      className="pipelines-page"
      title={
        <span>
          <RocketOutlined style={{ marginRight: 8 }} />
          流水线历史（Agent 版一键流水线记录）
        </span>
      }
      extra={
        <Button icon={<ReloadOutlined />} onClick={() => fetchList()}>
          刷新
        </Button>
      }
    >
      {showExample && (
        <Alert
          type="info"
          showIcon
          message="示例数据"
          description="当前无流水线记录。下表为示例数据，仅用于展示表格结构；实际记录将在 Agent 版执行「启动 Agent 流水线」后产生。"
          style={{ marginBottom: 16, wordBreak: 'break-word', overflowWrap: 'break-word' }}
        />
      )}
      {fetchError && (
        <Alert
          type="warning"
          showIcon
          message="列表加载失败，当前显示示例数据"
          style={{ marginBottom: 16, wordBreak: 'break-word' }}
        />
      )}
      <div className="pipelines-table-wrap">
        <Table
          rowKey="id"
          columns={columns}
          dataSource={dataSource}
          loading={loading}
          pagination={{ pageSize: 10, showSizeChanger: true }}
          size="small"
        />
      </div>
    </Card>
  );
};

export default PipelinesPage;
