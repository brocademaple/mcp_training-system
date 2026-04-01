import React, { useEffect, useMemo, useState } from 'react';
import { Card, Row, Col, Statistic, Button, message, Typography, Alert, List, Space } from 'antd';
import {
  DatabaseOutlined,
  ExperimentOutlined,
  ClockCircleOutlined,
  SyncOutlined,
  PlusOutlined,
  BarChartOutlined,
  RightOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { datasetService } from '@/services/dataset';
import { trainingService } from '@/services/training';
import { evaluationService } from '@/services/evaluation';
import { syncService } from '@/services/sync';
import { modelService } from '@/services/model';
import type { Dataset, TrainingJob, Evaluation, Model } from '@/types';
import PageHero from '@/components/PageHero';

/** 测试集：usage === 'test'；其余（含未标 usage 的旧数据）视为训练侧 */
function isTestDataset(d: Dataset): boolean {
  return d.usage === 'test';
}

function isTrainingDataset(d: Dataset): boolean {
  return !isTestDataset(d);
}

type TaskRecommendation = {
  id: string;
  priority: number;
  title: string;
  desc: string;
  primary: string;
  path: string;
  icon: React.ReactNode;
  /** 为 true 时点击走 Agent 切换逻辑（path 为 '/'） */
  isAgentEntry?: boolean;
};

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [jobs, setJobs] = useState<TrainingJob[]>([]);
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    fetchAll();
  }, []);

  useEffect(() => {
    const trainPending = jobs.some((j) => j.status === 'queued' || j.status === 'running');
    const evalPending = evaluations.some((e) => e.status === 'running');
    if (!trainPending && !evalPending) return;
    const timer = setInterval(() => {
      void fetchJobs();
      void fetchEvaluations();
    }, 4000);
    return () => clearInterval(timer);
  }, [jobs, evaluations]);

  const fetchJobs = async () => {
    try {
      const res = await trainingService.getJobs();
      if (res.code === 200 && res.data?.jobs) setJobs(res.data.jobs);
    } catch (_) {}
  };

  const fetchEvaluations = async () => {
    try {
      const res = await evaluationService.getEvaluations();
      if (res.code === 200 && res.data?.evaluations) setEvaluations(res.data.evaluations);
    } catch (_) {}
  };

  const fetchModels = async () => {
    try {
      const res = await modelService.getModels();
      if (res.code === 200 && res.data?.models) setModels(res.data.models);
    } catch (_) {}
  };

  const fetchDatasets = async () => {
    setLoading(true);
    try {
      const response = await datasetService.getDatasets();
      if (response.code === 200 && response.data) {
        setDatasets(response.data.datasets || []);
      }
    } catch (e) {
      console.error('Failed to fetch datasets:', e);
    } finally {
      setLoading(false);
    }
  };

  const fetchAll = () => {
    fetchDatasets();
    fetchJobs();
    fetchEvaluations();
    void fetchModels();
  };

  const handleSyncFromDisk = async () => {
    setSyncing(true);
    try {
      const res = await syncService.syncFromDisk();
      if (res.code === 200 && res.data) {
        const { datasets_recovered = 0, models_recovered = 0, message: msg } = res.data;
        message.success(msg || `已恢复 ${datasets_recovered} 个数据集、${models_recovered} 个模型`);
        fetchAll();
      } else {
        message.warning((res as any).message || '同步完成');
      }
    } catch (e: any) {
      message.error(e.message || '一键同步失败');
    } finally {
      setSyncing(false);
    }
  };

  const trainReadyCount = datasets.filter((d) => isTrainingDataset(d) && d.status === 'ready').length;
  const testReadyCount = datasets.filter((d) => isTestDataset(d) && d.status === 'ready').length;
  const hasRunningJob = jobs.some((j) => j.status === 'queued' || j.status === 'running');
  const hasRunningEval = evaluations.some((e) => e.status === 'running');
  const completedJobs = jobs.filter((j) => j.status === 'completed');
  const trainRunningCount = jobs.filter((j) => j.status === 'running').length;
  const trainQueuedCount = jobs.filter((j) => j.status === 'queued').length;
  const completedJobCount = completedJobs.length;

  const evalRunningCount = evaluations.filter((e) => e.status === 'running').length;
  const evalCompletedCount = evaluations.filter((e) => e.status === 'completed').length;
  const evalFailedOrCancelled = evaluations.filter((e) => e.status === 'failed' || e.status === 'cancelled').length;

  const goToAgent = () => {
    localStorage.setItem('app-version', 'agent');
    window.location.href = '/';
  };

  /** 多条可并存：模型列表 + 已完成任务共同判断「是否具备评估条件」；训练/测试集分开展示推荐 */
  const taskRecommendations = useMemo((): TaskRecommendation[] => {
    const recs: TaskRecommendation[] = [];
    const hasRunningJobInner = jobs.some((j) => j.status === 'queued' || j.status === 'running');
    const hasRunningEvalInner = evaluations.some((e) => e.status === 'running');
    const completedInner = jobs.filter((j) => j.status === 'completed');
    const hasUsableModel = models.length > 0 || completedInner.length > 0;
    const trainReadyList = datasets.filter((d) => isTrainingDataset(d) && d.status === 'ready');
    const testReadyList = datasets.filter((d) => isTestDataset(d) && d.status === 'ready');
    const processingInner = datasets.filter((d) => d.status === 'processing').length;
    const uploadingInner = datasets.filter((d) => d.status === 'uploading').length;

    if (datasets.length === 0) {
      recs.push({
        id: 'upload-empty',
        priority: 0,
        title: '还没有任何数据集',
        desc: '先上传或从 URL / 在线源导入数据；CSV 会自动清洗，就绪后即可训练与评估。',
        primary: '上传 / 导入数据集',
        path: '/datasets',
        icon: <DatabaseOutlined style={{ fontSize: 22, color: '#1890ff' }} />,
      });
    } else {
      if (!hasRunningJobInner && trainReadyList.length > 0) {
        const twoDaysMs = 48 * 3600000;
        const recentTrain = trainReadyList.filter(
          (d) => Date.now() - new Date(d.created_at).getTime() < twoDaysMs
        );
        recs.push({
          id: 'train',
          priority: hasUsableModel && testReadyList.length > 0 ? 3 : 2,
          title: '就绪训练集可创建训练任务',
          desc: `当前有 ${trainReadyList.length} 个训练集已清洗完成、可用于训练。${
            recentTrain.length > 0
              ? `其中 ${recentTrain.length} 个为近 48 小时内新增或就绪，可优先安排训练。`
              : ''
          }`,
          primary: '创建训练任务',
          path: '/training',
          icon: <PlusOutlined style={{ fontSize: 22, color: '#52c41a' }} />,
        });
      }

      if (!hasRunningEvalInner && hasUsableModel) {
        if (testReadyList.length > 0) {
          recs.push({
            id: 'evaluate',
            priority: 1,
            title: '已有可评估模型，可创建评估任务',
            desc:
              models.length > 0
                ? `库中有 ${models.length} 个模型记录，且有 ${testReadyList.length} 个就绪测试集，创建评估可得到准确率、F1 等指标。`
                : `检测到已有训练完成的任务，若模型列表为空可先到「模型训练」确认产物或使用「从磁盘恢复」。当前有 ${testReadyList.length} 个就绪测试集可用于评估。`,
            primary: '创建评估任务',
            path: '/evaluation',
            icon: <BarChartOutlined style={{ fontSize: 22, color: '#722ed1' }} />,
          });
        } else {
          recs.push({
            id: 'need-test-set',
            priority: 2,
            title: '已有模型，建议准备测试集',
            desc: '评估需要测试集：可上传测试数据，或在「数据集」中从训练集按比例划分测试集。',
            primary: '管理数据集 / 测试集',
            path: '/datasets',
            icon: <DatabaseOutlined style={{ fontSize: 22, color: '#1890ff' }} />,
          });
        }
      }

      if (!hasRunningJobInner && testReadyList.length > 0 && !hasUsableModel) {
        recs.push({
          id: 'test-only',
          priority: 2,
          title: '已有就绪测试集，可先训练再评估',
          desc: `有 ${testReadyList.length} 个测试集已就绪。完成训练产出模型后，即可创建评估任务。`,
          primary: '创建训练任务',
          path: '/training',
          icon: <ExperimentOutlined style={{ fontSize: 22, color: '#52c41a' }} />,
        });
      }

      if (uploadingInner > 0 || processingInner > 0) {
        const pipeParts: string[] = [];
        if (uploadingInner > 0) pipeParts.push(`${uploadingInner} 个待清洗`);
        if (processingInner > 0) pipeParts.push(`${processingInner} 个清洗中`);
        recs.push({
          id: 'pipeline',
          priority: 4,
          title: '有数据集正在上传或清洗',
          desc: `${pipeParts.join('，')}。完成后可训练或配置评估。`,
          primary: '查看数据集进度',
          path: '/datasets',
          icon: <ClockCircleOutlined style={{ fontSize: 22, color: '#faad14' }} />,
        });
      }

      const idleNoReady =
        trainReadyList.length === 0 &&
        testReadyList.length === 0 &&
        processingInner === 0 &&
        uploadingInner === 0;
      if (idleNoReady) {
        recs.push({
          id: 'stuck-data',
          priority: 5,
          title: '暂无可直接用于训练或评估的就绪数据',
          desc: '全部数据集可能处于失败或未处理状态，请在「数据集」中查看原因、重试清洗或重新上传。',
          primary: '去数据集页处理',
          path: '/datasets',
          icon: <DatabaseOutlined style={{ fontSize: 22, color: '#999' }} />,
        });
      }
    }

    recs.push({
      id: 'agent',
      priority: 10,
      title: '一键编排：Agent 版',
      desc: '在 Agent 画布用自然语言描述目标，由系统自动串联数据、训练与评估步骤。',
      primary: '切换到 Agent 版',
      path: '/',
      icon: <RobotOutlined style={{ fontSize: 22, color: '#eb2f96' }} />,
      isAgentEntry: true,
    });

    recs.sort((a, b) => a.priority - b.priority);
    return recs.slice(0, 8);
  }, [datasets, jobs, evaluations, models]);

  const handleRecNav = (rec: TaskRecommendation) => {
    if (rec.isAgentEntry) {
      goToAgent();
      return;
    }
    navigate(rec.path);
  };

  // 最近动态：合并数据集、训练任务与评估任务，按时间排序
  type ActivityItem = {
    type: 'dataset' | 'job' | 'evaluation';
    id: number;
    title: string;
    time: string;
    path: string;
    status?: string;
  };
  const activities: ActivityItem[] = [];
  datasets.slice(0, 5).forEach((d) => {
    activities.push({
      type: 'dataset',
      id: d.id,
      title: d.name || `数据集 #${d.id}`,
      time: d.created_at,
      path: '/datasets',
      status: d.status,
    });
  });
  jobs.slice(0, 5).forEach((j) => {
    activities.push({
      type: 'job',
      id: j.id,
      title: j.name || `训练任务 #${j.id}`,
      time: j.created_at,
      path: '/training',
      status: j.status,
    });
  });
  evaluations.slice(0, 5).forEach((ev) => {
    activities.push({
      type: 'evaluation',
      id: ev.id,
      title: ev.name?.trim() || `评估 #${ev.id}`,
      time: ev.created_at,
      path: '/evaluation',
      status: ev.status,
    });
  });
  activities.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
  const recentActivities = activities.slice(0, 8);

  /** 最近动态叙述文案：数据集用叙述；训练任务在下方单独用「名称 + 小字状态」展示 */
  const getActivityLabel = (a: ActivityItem): string => {
    if (a.type === 'dataset') return `上传了 ${a.title || '数据集'} 数据集`;
    return a.title || '';
  };

  /** 训练任务状态文案与颜色（小字展示） */
  const getJobStatusText = (status?: string): { text: string; color: string } => {
    if (status === 'running') return { text: '执行中', color: '#1890ff' };
    if (status === 'queued') return { text: '排队中', color: '#fa8c16' };
    if (status === 'completed') return { text: '已完成', color: '#52c41a' };
    if (status === 'failed') return { text: '失败', color: '#ff4d4f' };
    if (status === 'cancelled') return { text: '已取消', color: 'rgba(0,0,0,0.45)' };
    return { text: status || '—', color: 'rgba(0,0,0,0.45)' };
  };

  const getEvalActivityStatusText = (status?: string): { text: string; color: string } => {
    if (status === 'running') return { text: '评估中', color: '#1890ff' };
    if (status === 'completed') return { text: '已完成', color: '#52c41a' };
    if (status === 'failed') return { text: '失败', color: '#ff4d4f' };
    if (status === 'cancelled') return { text: '已取消', color: 'rgba(0,0,0,0.45)' };
    return { text: status || '—', color: 'rgba(0,0,0,0.45)' };
  };

  return (
    <div>
      <PageHero
        title="工作台"
        subtitle="汇总数据集、训练与评估任务，并按当前资源状态列出可并行关注的推荐操作。训练与评估在多任务时会排队，单机建议一次仅跑一项以充分利用算力。"
      />

      {(hasRunningJob || hasRunningEval) && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="有训练或评估任务正在占用算力"
          description={
            <Space size="middle" wrap>
              <span>新提交的任务将进入队列；可在对应页面查看进度与排队情况。</span>
              {hasRunningJob && (
                <Button type="link" size="small" style={{ padding: 0 }} onClick={() => navigate('/training')}>
                  查看训练任务
                </Button>
              )}
              {hasRunningEval && (
                <Button type="link" size="small" style={{ padding: 0 }} onClick={() => navigate('/evaluation')}>
                  查看评估任务
                </Button>
              )}
            </Space>
          }
        />
      )}

      <Card title="推荐操作" style={{ marginBottom: 24 }} bodyStyle={{ paddingTop: 8 }}>
        <List
          itemLayout="horizontal"
          dataSource={taskRecommendations}
          renderItem={(rec) => (
            <List.Item
              style={{ flexWrap: 'wrap', gap: 12, padding: '12px 0' }}
              actions={[
                <Button
                  key="go"
                  type={rec.priority <= 3 && rec.id !== 'agent' ? 'primary' : 'default'}
                  icon={<RightOutlined />}
                  onClick={() => handleRecNav(rec)}
                >
                  {rec.primary}
                </Button>,
              ]}
            >
              <List.Item.Meta
                avatar={rec.icon}
                title={<Typography.Text strong>{rec.title}</Typography.Text>}
                description={
                  <Typography.Paragraph type="secondary" style={{ marginBottom: 0, fontSize: 13 }}>
                    {rec.desc}
                  </Typography.Paragraph>
                }
              />
            </List.Item>
          )}
        />
      </Card>

      {/* 资源概览：数据集 / 训练 / 评估；训练与评估区分「执行中」与「排队中」以体现单机队列 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }} align="stretch">
        <Col xs={24} md={8} style={{ display: 'flex' }}>
          <Card hoverable onClick={() => navigate('/datasets')} style={{ cursor: 'pointer', flex: 1, display: 'flex', flexDirection: 'column' }} bodyStyle={{ flex: 1 }}>
            <Statistic
              title="数据集"
              value={datasets.length}
              prefix={<DatabaseOutlined />}
              suffix="个"
            />
            <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', lineHeight: 1.6 }}>
              <span style={{ color: '#52c41a', fontWeight: 500 }}>{trainReadyCount}</span> 个训练集就绪
              <br />
              <span style={{ color: '#722ed1', fontWeight: 500 }}>{testReadyCount}</span> 个测试集就绪
            </Typography.Text>
          </Card>
        </Col>
        <Col xs={24} md={8} style={{ display: 'flex' }}>
          <Card hoverable onClick={() => navigate('/training')} style={{ cursor: 'pointer', flex: 1, display: 'flex', flexDirection: 'column' }} bodyStyle={{ flex: 1 }}>
            <Statistic
              title="训练任务"
              value={jobs.length}
              prefix={<ExperimentOutlined />}
              suffix="条"
            />
            <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', lineHeight: 1.6 }}>
              <span style={{ color: '#1890ff', fontWeight: 500 }}>{trainRunningCount}</span> 个执行中
              {trainQueuedCount > 0 && (
                <>
                  ，<span style={{ color: '#fa8c16', fontWeight: 500 }}>{trainQueuedCount}</span> 个排队中
                </>
              )}
              <br />
              <span style={{ color: '#52c41a', fontWeight: 500 }}>{completedJobCount}</span> 个已完成
            </Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 6, lineHeight: 1.45 }}>
              后台通常一次只跑一条训练；其余保持「排队中」直至当前任务结束。
            </Typography.Text>
          </Card>
        </Col>
        <Col xs={24} md={8} style={{ display: 'flex' }}>
          <Card hoverable onClick={() => navigate('/evaluation')} style={{ cursor: 'pointer', flex: 1, display: 'flex', flexDirection: 'column' }} bodyStyle={{ flex: 1 }}>
            <Statistic
              title="评估任务"
              value={evaluations.length}
              prefix={<BarChartOutlined />}
              suffix="条"
            />
            <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', lineHeight: 1.6 }}>
              <span style={{ color: '#1890ff', fontWeight: 500 }}>{evalRunningCount}</span> 个评估中
              <br />
              <span style={{ color: '#52c41a', fontWeight: 500 }}>{evalCompletedCount}</span> 个已完成
              {evalFailedOrCancelled > 0 && (
                <>
                  ，<span style={{ color: '#ff4d4f', fontWeight: 500 }}>{evalFailedOrCancelled}</span> 个失败/取消
                </>
              )}
            </Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 6, lineHeight: 1.45 }}>
              评估同样占用算力；连续创建多项将依次执行，建议与训练错开或等待上一项完成。
            </Typography.Text>
          </Card>
        </Col>
      </Row>

      {/* 最近动态 */}
      <Card title="最近动态" loading={loading} style={{ marginBottom: 16 }}>
        {recentActivities.length === 0 ? (
          <Typography.Text type="secondary">暂无数据，去上传数据集或创建训练 / 评估任务吧</Typography.Text>
        ) : (
          <div style={{ maxHeight: 'min(38vh, 280px)', overflowY: 'auto' }}>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {recentActivities.map((a) => (
              <li
                key={`${a.type}-${a.id}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 0',
                  borderBottom: '1px solid #f0f0f0',
                  cursor: 'pointer',
                }}
                onClick={() => navigate(a.path)}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {a.type === 'dataset' && <DatabaseOutlined style={{ color: '#1890ff' }} />}
                  {a.type === 'job' && <ExperimentOutlined style={{ color: '#52c41a' }} />}
                  {a.type === 'evaluation' && <BarChartOutlined style={{ color: '#722ed1' }} />}
                  {a.type === 'job' ? (
                    <>
                      <span>{a.title || `训练任务 #${a.id}`}</span>
                      <span style={{ fontSize: 12, color: getJobStatusText(a.status).color }}>
                        {getJobStatusText(a.status).text}
                      </span>
                    </>
                  ) : a.type === 'evaluation' ? (
                    <>
                      <span>{a.title || `评估 #${a.id}`}</span>
                      <span style={{ fontSize: 12, color: getEvalActivityStatusText(a.status).color }}>
                        {getEvalActivityStatusText(a.status).text}
                      </span>
                    </>
                  ) : (
                    <span>{getActivityLabel(a)}</span>
                  )}
                </span>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {a.time ? new Date(a.time).toLocaleString('zh-CN') : '—'}
                </Typography.Text>
              </li>
            ))}
          </ul>
          </div>
        )}
      </Card>

      {/* 工具区：一键同步收口到次要位置 */}
      <div style={{ textAlign: 'right' }}>
        <Button type="link" size="small" icon={<SyncOutlined />} loading={syncing} onClick={handleSyncFromDisk}>
          从磁盘恢复数据
        </Button>
      </div>
    </div>
  );
};

export default Dashboard;
