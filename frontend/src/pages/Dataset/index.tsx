import React, { useEffect, useState } from 'react';
import { Card, Table, Button, Upload, Modal, Form, Input, Select, message, Tag, List, Typography } from 'antd';
import { UploadOutlined, ReloadOutlined, LinkOutlined, CloudDownloadOutlined, TableOutlined } from '@ant-design/icons';
import type { UploadFile } from 'antd/es/upload/interface';
import { datasetService } from '@/services/dataset';
import type { Dataset } from '@/types';

// 在线数据集预设（Hugging Face / GitHub 等），导入后可直接用于文本分类训练（需含 text、label 列）
const ONLINE_DATASETS = [
  {
    id: 'twitter-sentiment',
    name: 'Twitter 情感分析',
    description: 'Twitter 推文二分类情感数据，含 id、label、tweet；导入时自动将 tweet 映射为 text，适用于 BERT 文本分类。',
    url: 'https://raw.githubusercontent.com/dD2405/Twitter_Sentiment_Analysis/master/train.csv',
    source: 'GitHub',
    column_map: { tweet: 'text' } as Record<string, string>,
  },
  {
    id: 'gntd-sentiment',
    name: 'GNTD 多领域情感',
    description: '多领域情感数据（金融、能源、贸易等），CSV 格式。若列名非 text/label，导入后可在本地调整列名再用于训练。',
    url: 'https://raw.githubusercontent.com/kruthof/kruthof.github.io/master/assets/data/gntd/GNTD_Sentiment.csv',
    source: 'GitHub',
    column_map: undefined,
  },
  {
    id: 'huggingface-demo',
    name: 'Hugging Face 示例 CSV',
    description: 'Hugging Face 官方示例数据集（lhoestq/demo1）的 train.csv，可用于测试导入。训练需 CSV 含 text、label 列。',
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
  const [form] = Form.useForm();
  const [urlForm] = Form.useForm();

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

  const columns = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 80,
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
      width: 80,
    },
    {
      title: '来源',
      dataIndex: 'source',
      key: 'source',
      width: 120,
      render: (source: string) =>
        !source || source === 'local' ? '本地上传' : (source.length > 24 ? source.slice(0, 24) + '…' : source),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 120,
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
      width: 100,
    },
    {
      title: '列数',
      dataIndex: 'column_count',
      key: 'column_count',
      width: 100,
    },
    {
      title: '文件大小',
      dataIndex: 'file_size',
      key: 'file_size',
      width: 120,
      render: (size: number) => {
        if (!size) return '-';
        return `${(size / 1024 / 1024).toFixed(2)} MB`;
      },
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
      fixed: 'right' as const,
      render: (_: unknown, record: Dataset) => (
        <Button
          type="link"
          size="small"
          icon={<TableOutlined />}
          onClick={() => handleViewData(record)}
        >
          查看数据
        </Button>
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
              onClick={fetchDatasets}
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
        <Table
          columns={columns}
          dataSource={datasets}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
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

          <Form.Item label="选择文件">
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
        style={{ top: 24 }}
        destroyOnClose
      >
        {previewLoading && <div style={{ padding: 24, textAlign: 'center' }}>加载中...</div>}
        {!previewLoading && previewData && (
          <Table
            size="small"
            scroll={{ x: 'max-content' }}
            columns={previewData.columns.map((col) => ({
              title: col,
              dataIndex: col,
              key: col,
              ellipsis: true,
              width: col === 'text' || col === 'tweet' ? 280 : undefined,
            }))}
            dataSource={previewData.rows.map((row, idx) => ({ ...row, key: idx }))}
            pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
          />
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
