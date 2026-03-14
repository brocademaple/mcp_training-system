import React, { useEffect, useState } from 'react';
import { Card, Row, Col, Statistic, Button, message, Typography } from 'antd';
import {
  DatabaseOutlined,
  ExperimentOutlined,
  ClockCircleOutlined,
  SyncOutlined,
  RocketOutlined,
  PlusOutlined,
  BarChartOutlined,
  RightOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { datasetService } from '@/services/dataset';
import { trainingService } from '@/services/training';
import { syncService } from '@/services/sync';
import { pipelineService, type PipelineInstance } from '@/services/pipeline';
import type { Dataset } from '@/types';
import type { TrainingJob } from '@/types';

type NextStepType = 'upload' | 'train' | 'progress' | 'evaluate' | 'agent' | 'pipelines';

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [jobs, setJobs] = useState<TrainingJob[]>([]);
  const [pipelines, setPipelines] = useState<PipelineInstance[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    fetchAll();
  }, []);

  useEffect(() => {
    const hasPending = jobs.some((j) => j.status === 'queued' || j.status === 'running');
    if (!hasPending) return;
    const timer = setInterval(() => {
      fetchJobs();
    }, 4000);
    return () => clearInterval(timer);
  }, [jobs.length]);

  const fetchJobs = async () => {
    try {
      const res = await trainingService.getJobs();
      if (res.code === 200 && res.data?.jobs) setJobs(res.data.jobs);
    } catch (_) {}
  };

  const fetchPipelines = async () => {
    try {
      const list = await pipelineService.list();
      setPipelines(Array.isArray(list) ? list : []);
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
    fetchPipelines();
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

  const readyCount = datasets.filter((d) => d.status === 'ready').length;
  const processingCount = datasets.filter((d) => d.status === 'processing').length;
  const hasRunningJob = jobs.some((j) => j.status === 'queued' || j.status === 'running');
  const completedJobs = jobs.filter((j) => j.status === 'completed');
  const runningJobCount = jobs.filter((j) => j.status === 'queued' || j.status === 'running').length;
  const completedJobCount = completedJobs.length;

  // 推荐下一步（与 DASHBOARD_PRODUCT.md 一致）
  const getNextStep = (): { type: NextStepType; title: string; desc: string; primary: string; path: string } => {
    if (readyCount === 0 && processingCount === 0)
      return {
        type: 'upload',
        title: '还没有可训练的数据集',
        desc: '先上传或从 URL 导入一份数据，系统会自动清洗后用于训练。',
        primary: '去上传 / 导入数据',
        path: '/datasets',
      };
    if (hasRunningJob)
      return {
        type: 'progress',
        title: '有训练任务正在运行',
        desc: '在模型训练页可查看实时进度与日志。',
        primary: '查看训练进度',
        path: '/training',
      };
    if (readyCount > 0 && completedJobs.length === 0)
      return {
        type: 'train',
        title: '数据已就绪，可以开始训练',
        desc: `当前有 ${readyCount} 个就绪数据集，创建训练任务即可产出模型。`,
        primary: '创建训练任务',
        path: '/training',
      };
    if (completedJobs.length > 0)
      return {
        type: 'evaluate',
        title: '已有训练完成的模型',
        desc: '为模型创建评估任务，使用测试集得到准确率、F1 等指标。',
        primary: '去创建评估',
        path: '/evaluation',
      };
    if (pipelines.length > 0)
      return {
        type: 'pipelines',
        title: '查看流水线历史',
        desc: 'Agent 版一键流水线的执行记录与状态。',
        primary: '流水线历史',
        path: '/pipelines',
      };
    return {
      type: 'agent',
      title: '试试 Agent 版一键流水线',
      desc: '选择数据集后由系统自动完成清洗 → 训练 → 评估，无需逐步操作。',
      primary: '切换到 Agent 版',
      path: '/',
    };
  };

  const nextStep = getNextStep();
  const goToAgent = () => {
    localStorage.setItem('app-version', 'agent');
    window.location.href = '/';
  };

  // 最近动态：合并数据集、任务、流水线，按时间排序
  type ActivityItem = {
    type: 'dataset' | 'job' | 'pipeline';
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
  pipelines.slice(0, 3).forEach((p) => {
    activities.push({
      type: 'pipeline',
      id: p.id,
      title: `流水线 #${p.id}`,
      time: p.created_at || '',
      path: '/pipelines',
      status: p.status,
    });
  });
  activities.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
  const recentActivities = activities.slice(0, 8);

  /** 最近动态叙述文案：数据集/流水线用叙述；训练任务在下方单独用「名称 + 小字状态」展示 */
  const getActivityLabel = (a: ActivityItem): string => {
    if (a.type === 'dataset') return `上传了 ${a.title || '数据集'} 数据集`;
    if (a.type === 'pipeline') {
      if (a.status === 'running') return `流水线 #${a.id} 运行中……`;
      if (a.status === 'completed') return `流水线 #${a.id} 已完成……`;
      if (a.status === 'failed') return `流水线 #${a.id} 失败`;
      return `流水线 #${a.id}`;
    }
    return a.title || '';
  };

  /** 训练任务状态文案与颜色（小字展示） */
  const getJobStatusText = (status?: string): { text: string; color: string } => {
    if (status === 'running' || status === 'queued') return { text: '进行中', color: '#1890ff' };
    if (status === 'completed') return { text: '已完成', color: '#52c41a' };
    if (status === 'failed') return { text: '失败', color: '#ff4d4f' };
    return { text: status || '—', color: 'rgba(0,0,0,0.45)' };
  };

  const handleNav = (path: string) => {
    if (nextStep.type === 'agent' && path === '/') {
      goToAgent();
      return;
    }
    navigate(path);
  };

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          工作台
        </Typography.Title>
        <Typography.Text type="secondary" style={{ fontSize: 13 }}>
          根据当前数据与任务状态，推荐下一步操作
        </Typography.Text>
      </div>

      {/* 推荐下一步：主卡片 */}
      <Card
        style={{ marginBottom: 24 }}
        bodyStyle={{ padding: 20 }}
      >
        <Row align="middle" gutter={16}>
          <Col flex="none">
            {nextStep.type === 'upload' && <DatabaseOutlined style={{ fontSize: 32, color: '#1890ff' }} />}
            {nextStep.type === 'train' && <PlusOutlined style={{ fontSize: 32, color: '#52c41a' }} />}
            {nextStep.type === 'progress' && <ClockCircleOutlined style={{ fontSize: 32, color: '#faad14' }} />}
            {nextStep.type === 'evaluate' && <BarChartOutlined style={{ fontSize: 32, color: '#722ed1' }} />}
            {nextStep.type === 'pipelines' && <RocketOutlined style={{ fontSize: 32, color: '#13c2c2' }} />}
            {nextStep.type === 'agent' && <RocketOutlined style={{ fontSize: 32, color: '#eb2f96' }} />}
          </Col>
          <Col flex="1">
            <Typography.Title level={5} style={{ margin: '0 0 4px 0' }}>
              {nextStep.title}
            </Typography.Title>
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
              {nextStep.desc}
            </Typography.Text>
          </Col>
          <Col flex="none">
            <Button
              type="primary"
              icon={<RightOutlined />}
              onClick={() => handleNav(nextStep.path)}
            >
              {nextStep.primary}
            </Button>
          </Col>
        </Row>
      </Card>

      {/* 资源概览：可点击进入对应模块（flex 等高） */}
      <Row gutter={16} style={{ marginBottom: 24 }} align="stretch">
        <Col span={8} style={{ display: 'flex' }}>
          <Card hoverable onClick={() => navigate('/datasets')} style={{ cursor: 'pointer', flex: 1, display: 'flex', flexDirection: 'column' }} bodyStyle={{ flex: 1 }}>
            <Statistic
              title="数据集"
              value={datasets.length}
              prefix={<DatabaseOutlined />}
              suffix="个"
            />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              <span style={{ color: '#52c41a', fontWeight: 500 }}>{readyCount}</span> 个就绪可训练
            </Typography.Text>
          </Card>
        </Col>
        <Col span={8} style={{ display: 'flex' }}>
          <Card hoverable onClick={() => navigate('/training')} style={{ cursor: 'pointer', flex: 1, display: 'flex', flexDirection: 'column' }} bodyStyle={{ flex: 1 }}>
            <Statistic
              title="训练任务"
              value={jobs.length}
              prefix={<ExperimentOutlined />}
            />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              <span style={{ color: '#1890ff', fontWeight: 500 }}>{runningJobCount}</span> 个进行中，
              <span style={{ color: '#52c41a', fontWeight: 500 }}>{completedJobCount}</span> 个已完成
            </Typography.Text>
          </Card>
        </Col>
        <Col span={8} style={{ display: 'flex' }}>
          <Card hoverable onClick={() => navigate('/pipelines')} style={{ cursor: 'pointer', flex: 1, display: 'flex', flexDirection: 'column' }} bodyStyle={{ flex: 1 }}>
            <Statistic
              title="流水线记录"
              value={pipelines.length}
              prefix={<RocketOutlined />}
            />
          </Card>
        </Col>
      </Row>

      {/* 最近动态 */}
      <Card title="最近动态" loading={loading} style={{ marginBottom: 24 }}>
        {recentActivities.length === 0 ? (
          <Typography.Text type="secondary">暂无数据，去上传数据集或创建训练任务吧</Typography.Text>
        ) : (
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
                  {a.type === 'pipeline' && <RocketOutlined style={{ color: '#13c2c2' }} />}
                  {a.type === 'job' ? (
                    <>
                      <span>{a.title || `训练任务 #${a.id}`}</span>
                      <span style={{ fontSize: 12, color: getJobStatusText(a.status).color }}>
                        {getJobStatusText(a.status).text}
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
