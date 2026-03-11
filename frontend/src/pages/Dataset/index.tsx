import React, { useEffect, useState } from 'react';
import { Card, Table, Button, Upload, Modal, Form, Input, Select, message, Tag, List, Typography, Popconfirm, Tooltip } from 'antd';
import { UploadOutlined, ReloadOutlined, LinkOutlined, CloudDownloadOutlined, TableOutlined, DeleteOutlined, SyncOutlined } from '@ant-design/icons';
import type { UploadFile } from 'antd/es/upload/interface';
import { datasetService } from '@/services/dataset';
import type { Dataset } from '@/types';

// 在线数据集预设：国内加速优先（ghproxy / 直连），可直接用于文本分类（需含 text、label 列或通过 column_map 映射）
const ONLINE_DATASETS = [
  // ---------- 国内可访问（GitHub 加速或直连） ----------
  {
    id: 'chn-senticorp-ghproxy',
    name: 'ChnSentiCorp 酒店评论情感（国内加速）',
    description: '中文酒店评论二分类情感数据，经 ghproxy 加速拉取 GitHub 源，含 label、review；导入时自动将 review 映射为 text。',
    url: 'https://ghproxy.com/https://raw.githubusercontent.com/SophonPlus/ChineseNlpCorpus/master/datasets/ChnSentiCorp_htl_all/ChnSentiCorp_htl_all.csv',
    source: 'GitHub 国内加速',
    column_map: { review: 'text' } as Record<string, string>,
  },
  {
    id: 'chn-senticorp-github',
    name: 'ChnSentiCorp 酒店评论情感（GitHub 直连）',
    description: '同上数据集，GitHub raw 直连。若上一项失败可试此条（需网络可访问 GitHub）。',
    url: 'https://raw.githubusercontent.com/SophonPlus/ChineseNlpCorpus/master/datasets/ChnSentiCorp_htl_all/ChnSentiCorp_htl_all.csv',
    source: 'GitHub',
    column_map: { review: 'text' } as Record<string, string>,
  },
  {
    id: 'hf-mirror-demo',
    name: 'HF 示例 CSV（国内镜像 hf-mirror）',
    description: 'Hugging Face 示例数据集通过国内镜像 hf-mirror.com 拉取，适合测试导入。若 404 可改用下方「从 URL 导入」手动粘贴直链。',
    url: 'https://hf-mirror.com/datasets/lhoestq/demo1/resolve/main/data/train.csv',
    source: 'hf-mirror 国内镜像',
    column_map: undefined,
  },
  // ---------- 国外源（可能需代理） ----------
  {
    id: 'twitter-sentiment',
    name: 'Twitter 情感分析（GitHub）',
    description: 'Twitter 推文二分类情感数据，含 id、label、tweet；导入时自动将 tweet 映射为 text。',
    url: 'https://raw.githubusercontent.com/dD2405/Twitter_Sentiment_Analysis/master/train.csv',
    source: 'GitHub',
    column_map: { tweet: 'text' } as Record<string, string>,
  },
  {
    id: 'huggingface-demo',
    name: 'Hugging Face 示例 CSV',
    description: 'Hugging Face 官方示例 train.csv。国外源，网络不佳时可试上方 hf-mirror 或 ghproxy。',
    url: 'https://huggingface.co/datasets/lhoestq/demo1/resolve/main/data/train.csv',
    source: 'Hugging Face',
    column_map: undefined,
  },
];

const DatasetManagement: React.FC = () => {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploadModalVisible, setUploadModalVisible] = useState(false);
  const [urlModalVisible, setUrlModalVisible] = useState(false);
  const [onlineModalVisible, setOnlineModalVisible] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [previewModalVisible, setPreviewModalVisible] = useState(false);
  const [previewData, setPreviewData] = useState<{ columns: string[]; rows: Record<string, string>[]; name: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [form] = Form.useForm();
  const [urlForm] = Form.useForm();

  useEffect(() => {
    fetchDatasets();
  }, []);

  const fetchDatasets = async (showSuccess = false) => {
    setLoading(true);
    try {
      const response = await datasetService.getDatasets();
      if (response.code === 200 && response.data) {
        setDatasets(response.data.datasets || []);
        if (showSuccess) {
          message.success('已刷新，已获取当前列表所有数据集的最新状态');
        }
      }
    } catch (error: any) {
      message.error(error.message || '获取数据集列表失败');
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async (values: any) => {
    if (fileList.length === 0) {
      message.error('请选择文件');
      return;
    }

    try {
      const file = fileList[0].originFileObj as File;
      await datasetService.uploadDataset(file, values.name, values.type);
      message.success('数据集上传成功，正在处理中...');
      setUploadModalVisible(false);
      form.resetFields();
      setFileList([]);
      setTimeout(fetchDatasets, 1000);
    } catch (error: any) {
      message.error(error.message || '上传失败');
    }
  };

  const handleImportFromUrl = async (values: any) => {
    try {
      await datasetService.importFromUrl({
        name: values.name,
        url: values.url,
        type: values.type || 'text',
      });
      message.success('已提交从 URL 导入，正在拉取并处理...');
      setUrlModalVisible(false);
      urlForm.resetFields();
      setTimeout(fetchDatasets, 1000);
    } catch (error: any) {
      message.error(error.message || '从 URL 导入失败');
    }
  };

  const handleViewData = async (record: Dataset) => {
    setPreviewLoading(true);
    setPreviewModalVisible(true);
    setPreviewData(null);
    try {
      const res = await datasetService.getDatasetPreview(record.id, 100);
      if (res.code === 200 && res.data) {
        setPreviewData({
          columns: res.data.columns,
          rows: res.data.rows,
          name: record.name,
        });
      } else {
        message.error(res.message || '获取数据预览失败');
        setPreviewModalVisible(false);
      }
    } catch (e: any) {
      message.error(e.message || '获取数据预览失败');
      setPreviewModalVisible(false);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleImportOnlinePreset = async (preset: (typeof ONLINE_DATASETS)[0]) => {
    setImportingId(preset.id);
    try {
      await datasetService.importFromUrl({
        name: preset.name,
        url: preset.url,
        type: 'text',
        column_map: preset.column_map,
      });
      message.success(`「${preset.name}」已提交导入，正在拉取并处理...`);
      setOnlineModalVisible(false);
      setTimeout(fetchDatasets, 1000);
    } catch (error: any) {
      message.error(error.message || '导入失败');
    } finally {
      setImportingId(null);
    }
  };

  const handleDelete = async (record: Dataset) => {
    try {
      await datasetService.deleteDataset(record.id);
      message.success('已删除');
      fetchDatasets();
    } catch (e: any) {
      message.error(e.message || '删除失败');
    }
  };

  const handleRetryClean = async (record: Dataset) => {
    try {
      await datasetService.retryClean(record.id);
      message.success('已提交重试清洗，请稍后刷新查看状态');
      setTimeout(fetchDatasets, 2000);
    } catch (e: any) {
      message.error(e.message || '重试失败');
    }
  };

  // 从 API 返回的 file_size 可能是 number 或 Go NullInt64 序列化的 { Int64, Valid }
  const getFileSizeNum = (raw: unknown): number | null => {
    if (raw == null) return null;
    if (typeof raw === 'number' && !Number.isNaN(raw)) return raw;
    if (typeof raw === 'object' && raw !== null && 'Int64' in (raw as object))
      return (raw as { Int64: number }).Int64;
    return null;
  };

  // 从 API 返回的 error_message 可能是 string 或 Go NullString 序列化的 { String, Valid }
  const getErrorMessage = (raw: unknown): string | null => {
    if (raw == null) return null;
    if (typeof raw === 'string') return raw;
    if (typeof raw === 'object' && raw !== null && 'String' in (raw as object))
      return (raw as { String: string }).String || null;
    return null;
  };

  const columns = [
    {
      title: '序号',
      key: 'order',
      width: 72,
      render: (_: unknown, __: Dataset, index: number) => (page - 1) * pageSize + index + 1,
    },
    {
      title: '数据集名称',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      width: 88,
    },
    {
      title: '处理状态',
      dataIndex: 'status',
      key: 'status',
      width: 140,
      render: (status: string, record: Dataset) => {
        const statusConfig: Record<
          string,
          { label: string; color: string; tip: string }
        > = {
          uploading: {
            label: '已上传，待清洗',
            color: 'default',
            tip: '文件已保存，CSV 将自动进入清洗，JSON 会直接可用。',
          },
          processing: {
            label: '清洗中',
            color: 'processing',
            tip: '正在去重、去空等处理，完成后即可用于训练。',
          },
          ready: {
            label: '清洗完成',
            color: 'success',
            tip: '数据已就绪，可在「训练任务」中选择该数据集创建训练。',
          },
          error: {
            label: '清洗失败',
            color: 'error',
            tip: '处理出错，可查看原因后重试清洗或重新上传。',
          },
        };
        const config = statusConfig[status] || {
          label: status,
          color: 'default',
          tip: '',
        };
        const tag = (
          <Tag color={config.color}>{config.label}</Tag>
        );
        const errMsg = getErrorMessage(record.error_message);
        const canTrain = status === 'ready';
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {status === 'error' && errMsg ? (
              <Tooltip title={errMsg} placement="topLeft">
                <span>{tag}</span>
              </Tooltip>
            ) : (
              <Tooltip title={config.tip} placement="topLeft">
                <span>{tag}</span>
              </Tooltip>
            )}
            <span
              style={{
                fontSize: 12,
                color: canTrain ? '#52c41a' : '#999',
              }}
            >
              {canTrain ? '✓ 可训练' : '不可训练'}
            </span>
          </div>
        );
      },
    },
    {
      title: '文件大小',
      dataIndex: 'file_size',
      key: 'file_size',
      width: 100,
      render: (size: unknown) => {
        const num = getFileSizeNum(size);
        if (num == null || num === 0) return '-';
        if (num < 1024) return `${num} B`;
        if (num < 1024 * 1024) return `${(num / 1024).toFixed(2)} KB`;
        return `${(num / 1024 / 1024).toFixed(2)} MB`;
      },
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 172,
      render: (text: string) => (text ? new Date(text).toLocaleString('zh-CN') : '-'),
    },
    {
      title: '操作',
      key: 'action',
      width: 200,
      fixed: 'right' as const,
      render: (_: unknown, record: Dataset) => (
        <>
          <Button
            type="link"
            size="small"
            icon={<TableOutlined />}
            onClick={() => handleViewData(record)}
          >
            预览数据集
          </Button>
          {record.status === 'error' && (
            <Button
              type="link"
              size="small"
              icon={<SyncOutlined />}
              onClick={() => handleRetryClean(record)}
            >
              重试清洗
            </Button>
          )}
          <Popconfirm
            title="确定删除该数据集？"
            onConfirm={() => handleDelete(record)}
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              删除数据集
            </Button>
          </Popconfirm>
        </>
      ),
    },
  ];

  return (
    <div>
      <Card
        title="数据集管理"
        extra={
          <div>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => fetchDatasets(true)}
              style={{ marginRight: 8 }}
            >
              刷新
            </Button>
            <Button
              icon={<CloudDownloadOutlined />}
              onClick={() => setOnlineModalVisible(true)}
              style={{ marginRight: 8 }}
            >
              从在线数据集导入
            </Button>
            <Button
              icon={<LinkOutlined />}
              onClick={() => setUrlModalVisible(true)}
              style={{ marginRight: 8 }}
            >
              从 URL 导入
            </Button>
            <Button
              type="primary"
              icon={<UploadOutlined />}
              onClick={() => setUploadModalVisible(true)}
            >
              上传数据集
            </Button>
          </div>
        }
      >
        <div style={{ marginBottom: 12, color: '#666', fontSize: 13 }}>
          <Typography.Text type="secondary">
            说明：仅「<strong>清洗完成</strong>」的数据集可用于创建训练任务；上传后 CSV 会先自动清洗，JSON 会直接标记为可训练。
          </Typography.Text>
        </div>
        <Table
          columns={columns}
          dataSource={datasets}
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
        title="上传数据集"
        open={uploadModalVisible}
        onCancel={() => {
          setUploadModalVisible(false);
          form.resetFields();
          setFileList([]);
        }}
        onOk={() => form.submit()}
        okText="上传"
        cancelText="取消"
      >
        <Form form={form} layout="vertical" onFinish={handleUpload}>
          <Form.Item label="选择文件" required>
            <Upload
              beforeUpload={() => false}
              fileList={fileList}
              onChange={({ fileList: newList }) => {
                setFileList(newList);
                const file = newList[0]?.originFileObj as File | undefined;
                if (file && !form.getFieldValue('name')) {
                  const base = file.name.replace(/\.[^/.]+$/, '');
                  form.setFieldsValue({ name: base });
                }
              }}
              maxCount={1}
              accept=".csv,.json"
            >
              <Button icon={<UploadOutlined />}>选择文件（CSV / JSON）</Button>
            </Upload>
          </Form.Item>

          <Form.Item
            name="name"
            label="数据集名称"
            rules={[{ required: true, message: '请输入数据集名称' }]}
          >
            <Input placeholder="请输入数据集名称" />
          </Form.Item>

          <Form.Item
            name="type"
            label="数据类型"
            rules={[{ required: true, message: '请选择数据类型' }]}
          >
            <Select placeholder="请选择数据类型">
              <Select.Option value="text">文本（CSV/JSON）</Select.Option>
              <Select.Option value="instruction">指令/对话（JSON）</Select.Option>
              <Select.Option value="image">图像</Select.Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="从 URL 导入数据集"
        open={urlModalVisible}
        onCancel={() => {
          setUrlModalVisible(false);
          urlForm.resetFields();
        }}
        onOk={() => urlForm.submit()}
        okText="导入"
        cancelText="取消"
      >
        <Form form={urlForm} layout="vertical" onFinish={handleImportFromUrl}>
          <Form.Item
            name="name"
            label="数据集名称"
            rules={[{ required: true, message: '请输入数据集名称' }]}
          >
            <Input placeholder="请输入数据集名称" />
          </Form.Item>

          <Form.Item
            name="url"
            label="CSV 文件链接"
            rules={[
              { required: true, message: '请输入 CSV 的 URL' },
              { type: 'url', message: '请输入有效的 URL' },
            ]}
          >
            <Input placeholder="https://example.com/data.csv" />
          </Form.Item>

          <Form.Item name="type" label="数据类型" initialValue="text">
            <Select>
              <Select.Option value="text">文本</Select.Option>
              <Select.Option value="image">图像</Select.Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={previewData ? `数据预览：${previewData.name}` : '数据预览'}
        open={previewModalVisible}
        onCancel={() => { setPreviewModalVisible(false); setPreviewData(null); }}
        footer={null}
        width="90%"
        style={{ top: 24, maxWidth: '95vw' }}
        destroyOnClose
      >
        {previewLoading && <div style={{ padding: 24, textAlign: 'center' }}>加载中...</div>}
        {!previewLoading && previewData && (
          <div style={{ overflow: 'auto', maxWidth: '100%' }}>
            <Table
              size="small"
              scroll={{ y: 420 }}
              columns={previewData.columns.map((col) => {
                const isLabel = col.toLowerCase() === 'label';
                return {
                  title: isLabel ? '情感' : col,
                  dataIndex: col,
                  key: col,
                  ellipsis: false,
                  width: isLabel ? 80 : undefined,
                  render: (val: unknown) => {
                    if (isLabel && val != null) {
                      const s = String(val).trim();
                      if (s === '0') return <span style={{ color: '#cf1322' }}>负面</span>;
                      if (s === '1') return <span style={{ color: '#389e0d' }}>正面</span>;
                      if (s === '2') return <span style={{ color: '#d46b08' }}>中性</span>;
                    }
                    return (
                      <span style={{ wordBreak: 'break-word', whiteSpace: 'normal', display: 'block', maxWidth: '100%' }}>
                        {val != null ? String(val) : ''}
                      </span>
                    );
                  },
                };
              })}
              dataSource={previewData.rows.map((row, idx) => ({ ...row, key: idx }))}
              pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
            />
          </div>
        )}
        {!previewLoading && !previewData && previewModalVisible && (
          <div style={{ padding: 24, textAlign: 'center', color: '#999' }}>暂无数据</div>
        )}
      </Modal>

      <Modal
        title="从在线数据集导入"
        open={onlineModalVisible}
        onCancel={() => setOnlineModalVisible(false)}
        footer={null}
        width={640}
      >
        <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
          选择下方预设数据集，将从 Hugging Face / GitHub 等拉取 CSV 并导入到本系统。训练时请确保 CSV 含有 text、label 列（部分预设已自动做列名映射）。
        </Typography.Paragraph>
        <List
          itemLayout="vertical"
          dataSource={ONLINE_DATASETS}
          renderItem={(item) => (
            <List.Item
              key={item.id}
              actions={[
                <Button
                  type="primary"
                  icon={<CloudDownloadOutlined />}
                  onClick={() => handleImportOnlinePreset(item)}
                  loading={importingId === item.id}
                >
                  导入
                </Button>,
              ]}
            >
              <List.Item.Meta
                title={
                  <span>
                    {item.name}
                    <Tag color={item.source === 'Hugging Face' ? 'blue' : 'green'} style={{ marginLeft: 8 }}>
                      {item.source}
                    </Tag>
                  </span>
                }
                description={item.description}
              />
            </List.Item>
          )}
        />
      </Modal>
    </div>
  );
};

export default DatasetManagement;
