import React, { useEffect, useState } from 'react';
import { Card, Table, Button, Upload, Modal, Form, Input, InputNumber, Select, Slider, Tabs, Checkbox, message, Tag, List, Typography, Popconfirm, Tooltip } from 'antd';
import { UploadOutlined, ReloadOutlined, LinkOutlined, CloudDownloadOutlined, TableOutlined, DeleteOutlined, SyncOutlined, PartitionOutlined } from '@ant-design/icons';
import type { UploadFile } from 'antd/es/upload/interface';
import { datasetService } from '@/services/dataset';
import type { Dataset } from '@/types';

// 在线数据集预设：国内加速优先；支持情感、主题分类等多种文本任务，以及图像参考
// taskCategory 用于展示：sentiment=情感, topic=主题/新闻, other=其他文本, image=图像（参考）
type OnlinePreset = {
  id: string;
  name: string;
  description: string;
  url: string;
  source: string;
  taskCategory: 'sentiment' | 'topic' | 'other' | 'image';
  column_map?: Record<string, string>;
};

const ONLINE_DATASETS: OnlinePreset[] = [
  // ---------- 情感分类 ----------
  {
    id: 'chn-senticorp-ghproxy',
    name: 'ChnSentiCorp 酒店评论情感（国内加速）',
    description: '中文酒店评论二分类情感数据，经 ghproxy 加速拉取 GitHub 源，含 label、review；导入时自动将 review 映射为 text。',
    url: 'https://ghproxy.com/https://raw.githubusercontent.com/SophonPlus/ChineseNlpCorpus/master/datasets/ChnSentiCorp_htl_all/ChnSentiCorp_htl_all.csv',
    source: 'GitHub 国内加速',
    taskCategory: 'sentiment',
    column_map: { review: 'text' },
  },
  {
    id: 'chn-senticorp-github',
    name: 'ChnSentiCorp 酒店评论情感（GitHub 直连）',
    description: '同上数据集，GitHub raw 直连。若上一项失败可试此条（需网络可访问 GitHub）。',
    url: 'https://raw.githubusercontent.com/SophonPlus/ChineseNlpCorpus/master/datasets/ChnSentiCorp_htl_all/ChnSentiCorp_htl_all.csv',
    source: 'GitHub',
    taskCategory: 'sentiment',
    column_map: { review: 'text' },
  },
  {
    id: 'weibo-senti-100k',
    name: '微博情感 100k（ModelScope）',
    description: '中文微博情感二分类，约 10 万条，国内 ModelScope 直连。适合较大规模情感分类。',
    url: 'https://modelscope.cn/datasets/damo/nlp_weibo_sentiment_classification/resolve/master/weibo_senti_100k.csv',
    source: 'ModelScope 国内',
    taskCategory: 'sentiment',
    column_map: undefined,
  },
  {
    id: 'twitter-sentiment',
    name: 'Twitter 情感分析（GitHub）',
    description: 'Twitter 推文二分类情感数据，含 id、label、tweet；导入时自动将 tweet 映射为 text。',
    url: 'https://raw.githubusercontent.com/dD2405/Twitter_Sentiment_Analysis/master/train.csv',
    source: 'GitHub',
    taskCategory: 'sentiment',
    column_map: { tweet: 'text' },
  },
  // ---------- 主题/新闻分类 ----------
  {
    id: 'topic-demo-hf',
    name: '主题/新闻分类示例（HF 镜像）',
    description: '与 HF 示例格式相同，可用于主题分类、新闻类别等多分类文本任务。CSV 需含 text、label 列。',
    url: 'https://hf-mirror.com/datasets/lhoestq/demo1/resolve/main/data/train.csv',
    source: 'hf-mirror 国内镜像',
    taskCategory: 'topic',
    column_map: undefined,
  },
  {
    id: 'hf-mirror-demo',
    name: 'HF 示例 CSV（国内镜像 hf-mirror）',
    description: 'Hugging Face 示例数据集通过国内镜像 hf-mirror.com 拉取，适合测试导入。若 404 可改用「从 URL 导入」手动粘贴直链。',
    url: 'https://hf-mirror.com/datasets/lhoestq/demo1/resolve/main/data/train.csv',
    source: 'hf-mirror 国内镜像',
    taskCategory: 'other',
    column_map: undefined,
  },
  {
    id: 'huggingface-demo',
    name: 'Hugging Face 示例 CSV',
    description: 'Hugging Face 官方示例 train.csv。国外源，网络不佳时可试上方 hf-mirror 或 ghproxy。',
    url: 'https://huggingface.co/datasets/lhoestq/demo1/resolve/main/data/train.csv',
    source: 'Hugging Face',
    taskCategory: 'other',
    column_map: undefined,
  },
  // ---------- 图像（参考，当前仅说明；训练为文本分类） ----------
  {
    id: 'image-ref',
    name: '图像分类数据集（参考）',
    description: '当前系统训练为文本分类（BERT）。图像分类需后续扩展：可先通过「从 URL 导入」上传含 图片路径,label 的 CSV，待支持图像训练后使用。',
    url: '',
    source: '参考',
    taskCategory: 'image',
    column_map: undefined,
  },
];

// 测试数据集预设：与上述训练集对应的官方/常用测试集，用于评估时选作测试集
const ONLINE_TEST_DATASETS: OnlinePreset[] = [
  {
    id: 'hf-demo1-test',
    name: 'HF demo1 测试集（对应 HF 示例训练集）',
    description: '与 lhoestq/demo1 的 train.csv 同数据集的官方 test 分割，格式一致（含 text、label），适合作为 HF 示例训练集评估时的测试集。',
    url: 'https://hf-mirror.com/datasets/lhoestq/demo1/resolve/main/data/test.csv',
    source: 'hf-mirror 国内镜像',
    taskCategory: 'other',
    column_map: undefined,
  },
  {
    id: 'hf-demo1-test-official',
    name: 'HF demo1 测试集（Hugging Face 直连）',
    description: '同上，Hugging Face 官方直链。若国内镜像不可用可试此条。',
    url: 'https://huggingface.co/datasets/lhoestq/demo1/resolve/main/data/test.csv',
    source: 'Hugging Face',
    taskCategory: 'other',
    column_map: undefined,
  },
  {
    id: 'twitter-sentiment-test',
    name: 'Twitter 情感分析测试集（对应 Twitter 训练集）',
    description: '与 dD2405/Twitter_Sentiment_Analysis 的 train.csv 同仓库的 test.csv，二分类情感，列名含 tweet；导入时自动映射 tweet→text。',
    url: 'https://raw.githubusercontent.com/dD2405/Twitter_Sentiment_Analysis/master/test.csv',
    source: 'GitHub',
    taskCategory: 'sentiment',
    column_map: { tweet: 'text' },
  },
  {
    id: 'chn-senticorp-test-tsv',
    name: 'ChnSentiCorp 测试集（TSV，对应 ChnSentiCorp 训练集）',
    description: 'ChnSentiCorp 官方 test 分割（TSV 格式）。若导入后清洗异常，可下载到本地将分隔符改为逗号另存为 CSV 再通过「上传」导入。',
    url: 'https://raw.githubusercontent.com/duanruixue/chnsenticorp/main/test.tsv',
    source: 'GitHub',
    taskCategory: 'sentiment',
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
  const [datasetTab, setDatasetTab] = useState<'training' | 'test'>('training');
  const [splitModalVisible, setSplitModalVisible] = useState(false);
  const [splitLoading, setSplitLoading] = useState(false);
  const [form] = Form.useForm();
  const [urlForm] = Form.useForm();
  const [splitForm] = Form.useForm();

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

  const handleImportOnlinePreset = async (preset: OnlinePreset) => {
    if (!preset.url || preset.taskCategory === 'image') {
      message.info('图像数据集导入与训练功能开发中，敬请期待。可先通过「从 URL 导入」上传含 图片路径,label 的 CSV 备用。');
      return;
    }
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

  const handleSplitDataset = async (values: {
    dataset_id: number;
    test_ratio: number;
    only_test?: boolean;
  }) => {
    setSplitLoading(true);
    const trainRatio = 1 - (values.test_ratio ?? 0.2);
    const onlyTest = values.only_test !== false;
    try {
      const res = await datasetService.splitDataset(values.dataset_id, trainRatio, onlyTest);
      if (res.code === 200 && res.data) {
        if (onlyTest) {
          message.success(`已生成测试集 ${res.data.test_count} 条，正在清洗…`);
        } else {
          message.success(
            `已划分：训练集 ${res.data.train_count} 条、测试集 ${res.data.test_count} 条，正在清洗…`
          );
        }
        setSplitModalVisible(false);
        splitForm.resetFields();
        setTimeout(fetchDatasets, 1500);
      } else {
        message.error(res.message || '划分失败');
      }
    } catch (e: any) {
      const status = e.status ?? e.response?.status;
      if (status === 404) {
        message.error('请求 404：请确认后端服务已重启（需包含「划分测试集」接口），并刷新数据集列表后重试。');
      } else {
        message.error(e.message || '划分失败');
      }
    } finally {
      setSplitLoading(false);
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

  const getRowCountNum = (raw: unknown): number | null => {
    if (raw == null) return null;
    if (typeof raw === 'number' && !Number.isNaN(raw)) return raw;
    if (typeof raw === 'object' && raw !== null && 'Int64' in (raw as object))
      return (raw as { Int64: number }).Int64;
    const n = Number(raw);
    return Number.isNaN(n) ? null : n;
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
      <Card>
        <Tabs
          activeKey={datasetTab}
          onChange={(k) => setDatasetTab(k as 'training' | 'test')}
          items={[
            { key: 'training', label: '训练数据集' },
            { key: 'test', label: '测试数据集' },
          ]}
          style={{ marginBottom: 12 }}
        />
        <div style={{ marginBottom: 12 }}>
          <Button icon={<ReloadOutlined />} onClick={() => fetchDatasets(true)} style={{ marginRight: 8 }}>
            刷新
          </Button>
          <Button
            icon={<CloudDownloadOutlined />}
            onClick={() => setOnlineModalVisible(true)}
            style={{ marginRight: 8 }}
          >
            {datasetTab === 'test' ? '从在线导入测试集' : '从在线数据集导入'}
          </Button>
          <Button icon={<LinkOutlined />} onClick={() => setUrlModalVisible(true)} style={{ marginRight: 8 }}>
            从 URL 导入
          </Button>
          <Button type="primary" icon={<UploadOutlined />} onClick={() => setUploadModalVisible(true)}>
            上传数据集
          </Button>
          {datasetTab === 'test' && (
            <Button
              icon={<PartitionOutlined />}
              onClick={() => setSplitModalVisible(true)}
              style={{ marginLeft: 8 }}
            >
              从训练集划分测试集
            </Button>
          )}
        </div>
        <div style={{ marginBottom: 12, color: '#666', fontSize: 13 }}>
          {datasetTab === 'training' ? (
            <Typography.Text type="secondary">
              说明：仅「<strong>清洗完成</strong>」的数据集可用于创建训练任务；上传后 CSV 会先自动清洗，JSON 会直接标记为可训练。
            </Typography.Text>
          ) : (
            <Typography.Text type="secondary">
              说明：以下数据集可在<strong>创建评估任务</strong>时选作<strong>测试集</strong>；请确保状态为「清洗完成」。同一数据集既可作训练用，也可作测试用。
            </Typography.Text>
          )}
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
        title="从已有数据集生成测试集"
        open={splitModalVisible}
        onCancel={() => { setSplitModalVisible(false); splitForm.resetFields(); }}
        onOk={() => splitForm.submit()}
        confirmLoading={splitLoading}
        okText="生成测试集"
        cancelText="取消"
        destroyOnClose
      >
        <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
          从「清洗完成」的数据集中按比例随机抽出一部分，生成一条新的<strong>测试集</strong>记录（用于评估）。原有数据集仍可继续用于训练，这样训练与测试数据分离，评估更可靠。默认只生成测试集，不新建训练集。
        </Typography.Paragraph>
        <Form
          form={splitForm}
          layout="vertical"
          initialValues={{ test_ratio: 0.2, only_test: true }}
          onFinish={handleSplitDataset}
        >
          <Form.Item
            name="dataset_id"
            label="选择数据集"
            rules={[{ required: true, message: '请选择数据集' }]}
          >
            <Select
              placeholder="仅显示已清洗完成的数据集"
              options={datasets
                .filter((d) => d.status === 'ready')
                .map((d) => ({ value: d.id, label: `${d.name} (ID: ${d.id}, ${getRowCountNum(d.row_count) ?? 0} 条)` }))}
            />
          </Form.Item>
          <Form.Item
            name="test_ratio"
            label="测试集比例"
            tooltip="从该数据中抽出多少比例作为测试集，建议 10%～30%"
            rules={[
              { required: true },
              { type: 'number', min: 0.05, max: 0.5, message: '建议 0.05～0.5' },
            ]}
          >
            <Slider
              min={0.05}
              max={0.5}
              step={0.05}
              marks={{ 0.05: '5%', 0.2: '20%', 0.3: '30%', 0.5: '50%' }}
            />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, cur) => prev.test_ratio !== cur.test_ratio}>
            {({ getFieldValue }) => {
              const r = getFieldValue('test_ratio') ?? 0.2;
              return (
                <div style={{ marginBottom: 16, color: '#666', fontSize: 13 }}>
                  将生成：测试集约 {(r * 100).toFixed(0)}%
                </div>
              );
            }}
          </Form.Item>
          <Form.Item name="only_test" valuePropName="checked">
            <Checkbox>仅生成测试集（不新建训练集，原有数据集继续用于训练）</Checkbox>
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
        title={datasetTab === 'test' ? '从在线导入测试集' : '从在线数据集导入'}
        open={onlineModalVisible}
        onCancel={() => setOnlineModalVisible(false)}
        footer={null}
        width={640}
      >
        <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
          {datasetTab === 'test' ? (
            <>选择下方与现有训练集对应的测试集预设，拉取后可在「创建评估任务」时选作测试数据。格式需含 text、label（部分已做列名映射）。</>
          ) : (
            <>选择下方预设数据集，将从 Hugging Face / GitHub / ModelScope 等拉取 CSV 并导入。支持情感分类、主题分类等文本任务；训练时请确保 CSV 含 text、label 列（部分预设已自动做列名映射）。图像类为参考说明，当前训练为文本分类。</>
          )}
        </Typography.Paragraph>
        <List
          itemLayout="vertical"
          dataSource={datasetTab === 'test' ? ONLINE_TEST_DATASETS : ONLINE_DATASETS}
          renderItem={(item) => {
            const taskTag = { sentiment: '情感', topic: '主题', other: '文本', image: '图像参考' }[item.taskCategory];
            const taskColor = { sentiment: 'green', topic: 'blue', other: 'default', image: 'purple' }[item.taskCategory];
            const canImport = !!item.url && item.taskCategory !== 'image';
            return (
              <List.Item
                key={item.id}
                actions={[
                  <Button
                    type="primary"
                    icon={<CloudDownloadOutlined />}
                    onClick={() => handleImportOnlinePreset(item)}
                    loading={importingId === item.id}
                    disabled={!canImport}
                  >
                    {canImport ? '导入' : '参考'}
                  </Button>,
                ]}
              >
                <List.Item.Meta
                  title={
                    <span>
                      {item.name}
                      <Tag color={taskColor} style={{ marginLeft: 6 }}>{taskTag}</Tag>
                      <Tag color={item.source.includes('国内') ? 'green' : item.source === 'Hugging Face' ? 'blue' : 'default'} style={{ marginLeft: 6 }}>
                        {item.source}
                      </Tag>
                    </span>
                  }
                  description={item.description}
                />
              </List.Item>
            );
          }}
        />
      </Modal>
    </div>
  );
};

export default DatasetManagement;
