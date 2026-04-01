import React, { useEffect, useState } from 'react';
import {
  Card,
  Table,
  Button,
  Upload,
  Modal,
  Form,
  Input,
  Select,
  Slider,
  Tabs,
  message,
  Tag,
  List,
  Typography,
  Popconfirm,
  Tooltip,
  Popover,
  Divider,
  Checkbox,
  Alert,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  UploadOutlined,
  ReloadOutlined,
  LinkOutlined,
  CloudDownloadOutlined,
  TableOutlined,
  DeleteOutlined,
  SyncOutlined,
  PartitionOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import type { UploadFile } from 'antd/es/upload/interface';
import { datasetService } from '@/services/dataset';
import type { Dataset } from '@/types';

/** 名称是否疑似乱码（恢复数据集时文件名编码异常等） */
function isLikelyGarbled(name: string): boolean {
  if (!name || name.length > 200) return true;
  if (name.includes('\uFFFD')) return true;
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(name)) return true;
  return false;
}

/** Go encoding/json 对 sql.NullInt64 的默认序列化 */
function coerceSqlNullInt(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number' && !Number.isNaN(raw)) return raw;
  if (typeof raw === 'object' && raw !== null && 'Valid' in raw && 'Int64' in raw) {
    const o = raw as { Valid: boolean; Int64: number };
    if (!o.Valid) return null;
    return typeof o.Int64 === 'number' ? o.Int64 : Number(o.Int64);
  }
  return null;
}

function coerceSqlNullString(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'object' && raw !== null && 'Valid' in raw && 'String' in raw) {
    const o = raw as { Valid: boolean; String: string };
    if (!o.Valid) return null;
    return o.String || null;
  }
  return null;
}

const DATASET_COL_STORAGE_TRAINING = 'mcp-dataset-table-columns-training-v1';
const DATASET_COL_STORAGE_TEST = 'mcp-dataset-table-columns-test-v1';

/** 训练集 Tab 可配置列（操作列始终显示） */
const DATASET_TRAINING_TOGGLEABLE = ['order', 'name', 'type', 'row_count', 'status', 'file_size', 'created_at'] as const;
/** 测试集 Tab 额外含「来源训练集」 */
const DATASET_TEST_TOGGLEABLE = ['order', 'name', 'type', 'derived_from', 'row_count', 'status', 'file_size', 'created_at'] as const;

const DATASET_COLUMN_LABELS: Record<string, string> = {
  order: '序号',
  name: '数据集名称',
  type: '类型',
  derived_from: '来源训练集',
  row_count: '样本行数',
  status: '处理状态',
  file_size: '文件大小',
  created_at: '创建时间',
};

function defaultDatasetColVisTraining(): Record<string, boolean> {
  const v: Record<string, boolean> = {};
  DATASET_TRAINING_TOGGLEABLE.forEach((k) => {
    v[k] = true;
  });
  return v;
}

function defaultDatasetColVisTest(): Record<string, boolean> {
  const v: Record<string, boolean> = {};
  DATASET_TEST_TOGGLEABLE.forEach((k) => {
    v[k] = true;
  });
  return v;
}

function loadDatasetColVis(tab: 'training' | 'test'): Record<string, boolean> {
  const base = tab === 'training' ? defaultDatasetColVisTraining() : defaultDatasetColVisTest();
  const key = tab === 'training' ? DATASET_COL_STORAGE_TRAINING : DATASET_COL_STORAGE_TEST;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Record<string, boolean>;
    const keys = tab === 'training' ? DATASET_TRAINING_TOGGLEABLE : DATASET_TEST_TOGGLEABLE;
    keys.forEach((k) => {
      if (typeof parsed[k] === 'boolean') base[k] = parsed[k];
    });
  } catch {
    /* ignore */
  }
  return base;
}

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
    id: 'chn-senticorp-jsdelivr',
    name: 'ChnSentiCorp 酒店评论情感（jsDelivr CDN）',
    description: '中文酒店评论二分类情感数据，经 jsDelivr CDN 拉取，含 label、review；导入时自动将 review 映射为 text。国内访问较稳。',
    url: 'https://cdn.jsdelivr.net/gh/SophonPlus/ChineseNlpCorpus@master/datasets/ChnSentiCorp_htl_all/ChnSentiCorp_htl_all.csv',
    source: 'jsDelivr CDN',
    taskCategory: 'sentiment',
    column_map: { review: 'text' },
  },
  {
    id: 'chn-senticorp-ghproxy',
    name: 'ChnSentiCorp 酒店评论情感（ghproxy 加速）',
    description: '同上数据集，ghproxy 加速 GitHub。若 jsDelivr 失败可试此条。',
    url: 'https://ghproxy.com/https://raw.githubusercontent.com/SophonPlus/ChineseNlpCorpus/master/datasets/ChnSentiCorp_htl_all/ChnSentiCorp_htl_all.csv',
    source: 'GitHub 国内加速',
    taskCategory: 'sentiment',
    column_map: { review: 'text' },
  },
  {
    id: 'chn-senticorp-github',
    name: 'ChnSentiCorp 酒店评论情感（GitHub 直连）',
    description: '同上数据集，GitHub raw 直连。需网络可访问 GitHub。',
    url: 'https://raw.githubusercontent.com/SophonPlus/ChineseNlpCorpus/master/datasets/ChnSentiCorp_htl_all/ChnSentiCorp_htl_all.csv',
    source: 'GitHub',
    taskCategory: 'sentiment',
    column_map: { review: 'text' },
  },
  {
    id: 'weibo-senti-100k-github',
    name: '微博情感 100k（GitHub）',
    description: '中文微博情感二分类，约 10 万条，GitHub 直链。国内可配合 ghproxy 或先试 jsDelivr。',
    url: 'https://cdn.jsdelivr.net/gh/forever1986/bert_task@master/data/weibo_senti_100k.csv',
    source: 'jsDelivr CDN',
    taskCategory: 'sentiment',
    column_map: undefined,
  },
  {
    id: 'weibo-senti-100k',
    name: '微博情感 100k（ModelScope）',
    description: '中文微博情感二分类，约 10 万条，国内 ModelScope 直连。若失败可试上方 GitHub/jsDelivr。',
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

export type DatasetManagementProps = {
  /** 经典版整页（默认）| Agent 画布内弹窗，标题与说明与经典版区分 */
  variant?: 'page' | 'agent-modal';
  /** Agent 弹窗：关闭 */
  onRequestClose?: () => void;
  /** Agent 弹窗打开时默认选中的 Tab */
  initialDatasetTab?: 'training' | 'test';
};

const DatasetManagement: React.FC<DatasetManagementProps> = ({
  variant = 'page',
  onRequestClose,
  initialDatasetTab,
}) => {
  const [trainingDatasets, setTrainingDatasets] = useState<Dataset[]>([]);
  const [testDatasets, setTestDatasets] = useState<Dataset[]>([]);
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
  const [datasetTab, setDatasetTab] = useState<'training' | 'test'>(() => initialDatasetTab ?? 'training');
  const [splitModalVisible, setSplitModalVisible] = useState(false);
  const [splitLoading, setSplitLoading] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);
  const [renameModalVisible, setRenameModalVisible] = useState(false);
  const [renameTarget, setRenameTarget] = useState<Dataset | null>(null);
  const [renameLoading, setRenameLoading] = useState(false);
  const [form] = Form.useForm();
  const [urlForm] = Form.useForm();
  const [splitForm] = Form.useForm();
  const [renameForm] = Form.useForm();
  const [colVisTraining, setColVisTraining] = useState(() => loadDatasetColVis('training'));
  const [colVisTest, setColVisTest] = useState(() => loadDatasetColVis('test'));

  useEffect(() => {
    fetchDatasets();
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(DATASET_COL_STORAGE_TRAINING, JSON.stringify(colVisTraining));
    } catch {
      /* ignore */
    }
  }, [colVisTraining]);

  useEffect(() => {
    try {
      localStorage.setItem(DATASET_COL_STORAGE_TEST, JSON.stringify(colVisTest));
    } catch {
      /* ignore */
    }
  }, [colVisTest]);

  const fetchDatasets = async (showSuccess = false) => {
    setLoading(true);
    try {
      const [resTrain, resTest] = await Promise.all([
        datasetService.getDatasets('training'),
        datasetService.getDatasets('test'),
      ]);
      if (resTrain.code === 200 && resTrain.data) setTrainingDatasets(resTrain.data.datasets || []);
      if (resTest.code === 200 && resTest.data) setTestDatasets(resTest.data.datasets || []);
      if (showSuccess) message.success('已刷新，训练集与测试集列表已分别更新');
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
      const usage = datasetTab === 'test' ? 'test' : 'training';
      await datasetService.uploadDataset(file, values.name, values.type, usage);
      message.success(datasetTab === 'test' ? '测试集上传成功，正在处理中...' : '训练集上传成功，正在处理中...');
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
      const usage = datasetTab === 'test' ? 'test' : 'training';
      await datasetService.importFromUrl({
        name: values.name,
        url: values.url,
        type: values.type || 'text',
        usage,
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
      const usage = datasetTab === 'test' ? 'test' : 'training';
      await datasetService.importFromUrl({
        name: preset.name,
        url: preset.url,
        type: 'text',
        usage,
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

  const handleSplitDataset = async (values: { dataset_id: number; test_ratio: number }) => {
    setSplitLoading(true);
    const trainRatio = 1 - (values.test_ratio ?? 0.2);
    try {
      const res = await datasetService.splitDataset(values.dataset_id, trainRatio);
      if (res.code === 200 && res.data) {
        message.success(`测试集已生成，共 ${res.data.test_count} 条，可直接用于评估`);
        setSplitModalVisible(false);
        splitForm.resetFields();
        fetchDatasets();
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

  const wrapCellStyle: React.CSSProperties = {
    wordBreak: 'break-word',
    overflowWrap: 'anywhere',
    whiteSpace: 'normal',
    minWidth: 0,
    verticalAlign: 'top',
  };

  const allDatasetColumns: ColumnsType<Dataset> = [
    {
      title: '序号',
      key: 'order',
      width: 64,
      align: 'center',
      onCell: () => ({ style: wrapCellStyle }),
      onHeaderCell: () => ({ style: wrapCellStyle }),
      render: (_: unknown, __: Dataset, index: number) => (page - 1) * pageSize + index + 1,
    },
    {
      title: '数据集名称',
      dataIndex: 'name',
      key: 'name',
      width: 240,
      ellipsis: false,
      onCell: () => ({ style: wrapCellStyle }),
      onHeaderCell: () => ({ style: wrapCellStyle }),
      render: (name: string, record: Dataset) => (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span>{name || '—'}</span>
          {isLikelyGarbled(record.name) && <Tag color="orange">名称异常</Tag>}
          <Button
            type="link"
            size="small"
            style={{ padding: 0, height: 'auto' }}
            onClick={() => {
              setRenameTarget(record);
              renameForm.setFieldsValue({ name: record.name });
              setRenameModalVisible(true);
            }}
          >
            重命名
          </Button>
        </div>
      ),
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      width: 96,
      align: 'center',
      ellipsis: true,
      onCell: () => ({ style: { ...wrapCellStyle, verticalAlign: 'middle' } }),
      onHeaderCell: () => ({ style: wrapCellStyle }),
      render: (t: string) => <span>{t || '—'}</span>,
    },
    ...(datasetTab === 'test'
      ? ([
          {
            title: '来源训练集',
            key: 'derived_from',
            width: 200,
            ellipsis: false,
            onCell: () => ({ style: wrapCellStyle }),
            onHeaderCell: () => ({ style: wrapCellStyle }),
            render: (_: unknown, record: Dataset) => {
              const name = coerceSqlNullString(record.derived_from_dataset_name);
              const id = coerceSqlNullInt(record.derived_from_dataset_id);
              if (name) {
                return (
                  <Tooltip title={id != null ? `训练集 ID: ${id}` : '由训练集划分生成'}>
                    <span>{name}</span>
                  </Tooltip>
                );
              }
              if (id != null) {
                return <span>训练集 #{id}</span>;
              }
              return <span style={{ color: '#999' }}>—</span>;
            },
          },
        ] as ColumnsType<Dataset>)
      : []),
    {
      title: '样本行数',
      dataIndex: 'row_count',
      key: 'row_count',
      width: 100,
      align: 'right',
      onCell: () => ({ style: { ...wrapCellStyle, verticalAlign: 'middle' } }),
      onHeaderCell: () => ({ style: wrapCellStyle }),
      render: (v: unknown) => {
        const n = getRowCountNum(v);
        return n == null ? '—' : n.toLocaleString('zh-CN');
      },
    },
    {
      title: '处理状态',
      dataIndex: 'status',
      key: 'status',
      width: 148,
      onCell: () => ({ style: wrapCellStyle }),
      onHeaderCell: () => ({ style: wrapCellStyle }),
      render: (status: string, record: Dataset) => {
        const statusConfig: Record<string, { label: string; color: string; tip: string }> = {
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
        const tag = <Tag color={config.color}>{config.label}</Tag>;
        const errMsg = getErrorMessage(record.error_message);
        const canTrain = status === 'ready';
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
            {status === 'error' && errMsg ? (
              <Tooltip title={errMsg} placement="topLeft">
                <span>{tag}</span>
              </Tooltip>
            ) : (
              <Tooltip title={config.tip} placement="topLeft">
                <span>{tag}</span>
              </Tooltip>
            )}
            <span style={{ fontSize: 12, color: canTrain ? '#52c41a' : '#999' }}>
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
      width: 108,
      align: 'right',
      onCell: () => ({ style: { ...wrapCellStyle, verticalAlign: 'middle' } }),
      onHeaderCell: () => ({ style: wrapCellStyle }),
      render: (size: unknown) => {
        const num = getFileSizeNum(size);
        if (num == null || num === 0) return '—';
        if (num < 1024) return `${num} B`;
        if (num < 1024 * 1024) return `${(num / 1024).toFixed(2)} KB`;
        return `${(num / 1024 / 1024).toFixed(2)} MB`;
      },
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 168,
      ellipsis: true,
      onCell: () => ({ style: { ...wrapCellStyle, verticalAlign: 'middle' } }),
      onHeaderCell: () => ({ style: wrapCellStyle }),
      render: (text: string) => (text ? new Date(text).toLocaleString('zh-CN') : '—'),
    },
    {
      title: '操作',
      key: 'action',
      width: 200,
      fixed: 'right' as const,
      onCell: () => ({ style: { verticalAlign: 'top' } }),
      render: (_: unknown, record: Dataset) => (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
          <Button type="link" size="small" icon={<TableOutlined />} onClick={() => handleViewData(record)}>
            预览数据集
          </Button>
          {record.status === 'error' && (
            <Button type="link" size="small" icon={<SyncOutlined />} onClick={() => handleRetryClean(record)}>
              重试清洗
            </Button>
          )}
          <Popconfirm title="确定删除该数据集？" onConfirm={() => handleDelete(record)}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              删除数据集
            </Button>
          </Popconfirm>
        </div>
      ),
    },
  ];

  const colVis = datasetTab === 'training' ? colVisTraining : colVisTest;
  const setColVis = datasetTab === 'training' ? setColVisTraining : setColVisTest;
  const toggleableKeys =
    datasetTab === 'training' ? [...DATASET_TRAINING_TOGGLEABLE] : [...DATASET_TEST_TOGGLEABLE];

  const displayedColumns = allDatasetColumns.filter((c) => {
    const k = String(c.key);
    if (k === 'action') return true;
    return colVis[k] !== false;
  });

  const columnSettingsContent = (
    <div style={{ maxWidth: 280 }}>
      <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
        勾选要在表格中显示的列；训练集与测试集各自记忆。
      </Typography.Text>
      <Checkbox.Group
        style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
        value={toggleableKeys.filter((k) => colVis[k] !== false)}
        onChange={(checked) => {
          const set = new Set(checked as string[]);
          setColVis((prev) => {
            const next = { ...prev };
            toggleableKeys.forEach((k) => {
              next[k] = set.has(k);
            });
            return next;
          });
        }}
      >
        {toggleableKeys.map((k) => (
          <Checkbox key={k} value={k}>
            {DATASET_COLUMN_LABELS[k] ?? k}
          </Checkbox>
        ))}
      </Checkbox.Group>
      <Divider style={{ margin: '12px 0' }} />
      <Button
        type="link"
        size="small"
        style={{ padding: 0 }}
        onClick={() =>
          setColVis(datasetTab === 'training' ? defaultDatasetColVisTraining() : defaultDatasetColVisTest())
        }
      >
        恢复默认
      </Button>
    </div>
  );

  const isAgentModal = variant === 'agent-modal';

  return (
    <div className={isAgentModal ? 'dataset-management-root dataset-management-root--agent-modal' : undefined}>
      <Card
        className={isAgentModal ? 'dataset-management-card--agent-modal' : undefined}
        title={
          isAgentModal ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span>数据与上传</span>
              <Tag color="geekblue">Agent 内嵌</Tag>
              <Popover title="列表列显示" trigger="click" placement="bottomLeft" content={columnSettingsContent}>
                <Button icon={<SettingOutlined />} size="small">
                  列设置
                </Button>
              </Popover>
            </span>
          ) : (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span>数据集管理</span>
              <Popover title="列表列显示" trigger="click" placement="bottomLeft" content={columnSettingsContent}>
                <Button icon={<SettingOutlined />} size="small">
                  列设置
                </Button>
              </Popover>
            </span>
          )
        }
        extra={
          isAgentModal && onRequestClose ? (
            <Button size="small" type="default" onClick={onRequestClose}>
              关闭
            </Button>
          ) : undefined
        }
      >
        {isAgentModal && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="当前为 Agent 工作区视图"
            description="数据与经典版菜单中的「数据集管理」实时同步，并非另一套数据。此处不离开画布即可上传、导入与维护；需要全屏多页体验时可切换到经典版。"
          />
        )}
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
            {datasetTab === 'test' ? '上传测试集' : '上传训练集'}
          </Button>
          {selectedRowKeys.length > 0 && (
            <Popconfirm
              title={`确定删除选中的 ${selectedRowKeys.length} 个数据集？`}
              onConfirm={async () => {
                try {
                  const res = await datasetService.bulkDelete(selectedRowKeys);
                  const n = (res as any).data?.deleted ?? 0;
                  message.success(`已删除 ${n} 个数据集`);
                  setSelectedRowKeys([]);
                  fetchDatasets();
                } catch (e: any) {
                  message.error(e?.message || '批量删除失败');
                }
              }}
            >
              <Button danger icon={<DeleteOutlined />} style={{ marginLeft: 8 }}>
                批量删除选中 ({selectedRowKeys.length})
              </Button>
            </Popconfirm>
          )}
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
              说明：仅「<strong>清洗完成</strong>」的数据集可用于创建训练任务；上传后 CSV 会先自动清洗，JSON 会直接标记为可训练。本列表与「测试数据集」<strong>相互独立</strong>，删除仅影响本列表。
            </Typography.Text>
          ) : (
            <Typography.Text type="secondary">
              说明：以下数据集可在<strong>创建评估任务</strong>时选作<strong>测试集</strong>；请确保状态为「清洗完成」。通过「从训练集划分测试集」生成的记录会在<strong>来源训练集</strong>列标注对应训练集。本列表与「训练数据集」<strong>相互独立</strong>，删除仅影响本列表。
            </Typography.Text>
          )}
        </div>
        <Table<Dataset>
          tableLayout="fixed"
          scroll={{ x: 'max-content' }}
          columns={displayedColumns}
          dataSource={datasetTab === 'training' ? trainingDatasets : testDatasets}
          rowKey="id"
          loading={loading}
          rowSelection={{
            selectedRowKeys,
            onChange: (keys) => setSelectedRowKeys(keys as number[]),
          }}
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
        title="重命名数据集"
        open={renameModalVisible}
        onCancel={() => {
          setRenameModalVisible(false);
          setRenameTarget(null);
          renameForm.resetFields();
        }}
        onOk={() => renameForm.submit()}
        okText="保存"
        cancelText="取消"
        confirmLoading={renameLoading}
      >
        <Form
          form={renameForm}
          layout="vertical"
          onFinish={async (values) => {
            if (!renameTarget) return;
            setRenameLoading(true);
            try {
              await datasetService.updateName(renameTarget.id, values.name?.trim() || '');
              message.success('名称已更新');
              setRenameModalVisible(false);
              setRenameTarget(null);
              renameForm.resetFields();
              fetchDatasets();
            } catch (e: any) {
              message.error(e?.message || '更新失败');
            } finally {
              setRenameLoading(false);
            }
          }}
        >
          <Form.Item name="name" label="新名称" rules={[{ required: true, message: '请输入名称' }, { max: 200, message: '最多 200 字' }]}>
            <Input placeholder="输入数据集显示名称" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={datasetTab === 'test' ? '上传测试集' : '上传训练集'}
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
        title="从训练集划分测试集"
        open={splitModalVisible}
        onCancel={() => { setSplitModalVisible(false); splitForm.resetFields(); }}
        onOk={() => splitForm.submit()}
        confirmLoading={splitLoading}
        okText="生成测试集"
        cancelText="取消"
        destroyOnClose
      >
        <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
          选择<strong>已清洗完成</strong>的训练集和测试集比例，将按比例随机划分出一份测试集并<strong>直接可用</strong>（无需再清洗），可在「创建评估任务」中选作测试数据。原训练集不变，仍用于训练。
        </Typography.Paragraph>
        <Form
          form={splitForm}
          layout="vertical"
          initialValues={{ test_ratio: 0.2 }}
          onFinish={handleSplitDataset}
        >
          <Form.Item
            name="dataset_id"
            label="来源训练集"
            rules={[{ required: true, message: '请选择训练集' }]}
          >
            <Select
              placeholder="仅显示已清洗完成的数据集"
              options={trainingDatasets
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
                  将生成约 {(r * 100).toFixed(0)}% 的测试集，生成后可直接用于评估
                </div>
              );
            }}
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
            const isImageRef = item.taskCategory === 'image' || !item.url;
            return (
              <List.Item
                key={item.id}
                actions={[
                  isImageRef ? (
                    <Button
                      type="link"
                      size="small"
                      onClick={() => message.info('图像数据集导入与训练功能开发中，敬请期待。可先通过「从 URL 导入」上传含 图片路径,label 的 CSV 备用。')}
                    >
                      仅参考
                    </Button>
                  ) : (
                    <Button
                      type="primary"
                      icon={<CloudDownloadOutlined />}
                      onClick={() => handleImportOnlinePreset(item)}
                      loading={importingId === item.id}
                    >
                      导入
                    </Button>
                  ),
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
