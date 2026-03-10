import React, { useEffect, useState } from 'react';
import {
  Card,
  Table,
  Button,
  Modal,
  Form,
  InputNumber,
  message,
  Descriptions,
  Tag,
} from 'antd';
import { PlusOutlined, ReloadOutlined, EyeOutlined, DownloadOutlined } from '@ant-design/icons';
import { evaluationService } from '@/services/evaluation';
import type { Evaluation } from '@/types';

const EvaluationManagement: React.FC = () => {
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [loading, setLoading] = useState(false);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [selectedEvaluation, setSelectedEvaluation] = useState<Evaluation | null>(null);
  const [form] = Form.useForm();

  const fetchEvaluations = async () => {
    setLoading(true);
    try {
      const response = await evaluationService.getEvaluations();
      if (response.code === 200 && response.data?.evaluations) {
        setEvaluations(response.data.evaluations);
      }
    } catch (error: any) {
      message.error(error.message || '获取评估列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEvaluations();
  }, []);

  const handleCreateEvaluation = async (values: any) => {
    try {
      await evaluationService.createEvaluation({
        model_id: values.model_id,
        test_dataset_id: values.test_dataset_id,
      });
      message.success('评估任务创建成功');
      setCreateModalVisible(false);
      form.resetFields();
      setTimeout(fetchEvaluations, 1000);
    } catch (error: any) {
      message.error(error.message || '创建评估任务失败');
    }
  };

  const showDetail = (evaluation: Evaluation) => {
    setSelectedEvaluation(evaluation);
    setDetailModalVisible(true);
  };

  const columns = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 80,
    },
    {
      title: '模型ID',
      dataIndex: 'model_id',
      key: 'model_id',
      width: 100,
    },
    {
      title: '准确率',
      dataIndex: 'accuracy',
      key: 'accuracy',
      width: 120,
      render: (value: number) => `${(value * 100).toFixed(2)}%`,
    },
    {
      title: 'F1分数',
      dataIndex: 'f1_score',
      key: 'f1_score',
      width: 120,
      render: (value: number) => `${(value * 100).toFixed(2)}%`,
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
      render: (_: any, record: Evaluation) => (
        <Button
          type="link"
          icon={<EyeOutlined />}
          onClick={() => showDetail(record)}
        >
          查看详情
        </Button>
      ),
    },
  ];

  return (
    <div>
      <Card
        title="模型评估管理"
        extra={
          <div>
            <Button
              icon={<ReloadOutlined />}
              onClick={fetchEvaluations}
              style={{ marginRight: 8 }}
            >
              刷新
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setCreateModalVisible(true)}
            >
              创建评估任务
            </Button>
          </div>
        }
      >
        <Table
          columns={columns}
          dataSource={evaluations}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
        />
      </Card>

      <Modal
        title="创建评估任务"
        open={createModalVisible}
        onCancel={() => {
          setCreateModalVisible(false);
          form.resetFields();
        }}
        onOk={() => form.submit()}
        okText="创建"
        cancelText="取消"
      >
        <Form form={form} layout="vertical" onFinish={handleCreateEvaluation}>
          <Form.Item
            name="model_id"
            label="模型ID"
            rules={[{ required: true, message: '请输入模型ID' }]}
          >
            <InputNumber min={1} style={{ width: '100%' }} placeholder="请输入模型ID" />
          </Form.Item>

          <Form.Item name="test_dataset_id" label="测试数据集ID（可选）">
            <InputNumber min={0} style={{ width: '100%' }} placeholder="留空则自动分割" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="评估详情"
        open={detailModalVisible}
        onCancel={() => setDetailModalVisible(false)}
        footer={[
          selectedEvaluation?.report_path ? (
            <Button
              key="download"
              type="primary"
              icon={<DownloadOutlined />}
              href={evaluationService.getReportDownloadUrl(selectedEvaluation.id)}
              target="_blank"
              rel="noopener noreferrer"
            >
              下载报告
            </Button>
          ) : null,
          <Button key="close" onClick={() => setDetailModalVisible(false)}>
            关闭
          </Button>,
        ].filter(Boolean)}
        width={700}
      >
        {selectedEvaluation && (
          <Descriptions bordered column={2}>
            <Descriptions.Item label="评估ID">
              {selectedEvaluation.id}
            </Descriptions.Item>
            <Descriptions.Item label="模型ID">
              {selectedEvaluation.model_id}
            </Descriptions.Item>
            <Descriptions.Item label="准确率">
              <Tag color="blue">
                {(selectedEvaluation.accuracy * 100).toFixed(2)}%
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="精确率">
              <Tag color="green">
                {(selectedEvaluation.precision * 100).toFixed(2)}%
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="召回率">
              <Tag color="orange">
                {(selectedEvaluation.recall * 100).toFixed(2)}%
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="F1分数">
              <Tag color="purple">
                {(selectedEvaluation.f1_score * 100).toFixed(2)}%
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="创建时间" span={2}>
              {new Date(selectedEvaluation.created_at).toLocaleString('zh-CN')}
            </Descriptions.Item>
          </Descriptions>
        )}
      </Modal>
    </div>
  );
};

export default EvaluationManagement;
