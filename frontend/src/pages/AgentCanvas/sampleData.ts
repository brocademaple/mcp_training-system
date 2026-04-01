export type AgentChatRole = 'agent' | 'user' | 'system';

export interface AgentChatMessage {
  id: string;
  role: AgentChatRole;
  stage:
    | 'goal_input'
    | 'task_confirm'
    | 'data_prepare'
    | 'plan_confirm'
    | 'train_execute'
    | 'eval_confirm'
    | 'eval_result';
  content: string;
  timestamp: string;
}

export interface McpEvent {
  id: string;
  server: 'registry' | 'data' | 'training' | 'evaluation' | 'trace';
  tool: string;
  summary: string;
  status: 'success' | 'running' | 'failed';
  timestamp: string;
}

export interface SampleScenario {
  id: string;
  title: string;
  flowMode: 'full' | 'train_only' | 'eval_only';
  taxonomy: {
    domain: string;
    type: string;
    task: string;
  };
  conversation: AgentChatMessage[];
  mcpTimeline: McpEvent[];
}

// 示例：完整训练->评估对话流（法律摘要垂类）
export const SAMPLE_AGENT_CONVERSATION: AgentChatMessage[] = [
  {
    id: 'msg_01',
    role: 'user',
    stage: 'goal_input',
    content: '我想训练一个法律领域的摘要模型，用于合同条款压缩和关键信息提取。',
    timestamp: '2026-04-01 10:00:01',
  },
  {
    id: 'msg_02',
    role: 'agent',
    stage: 'task_confirm',
    content:
      '我已解析目标：任务=summarization / 文本摘要，领域=legal / 法律，模态=text。建议指标：rougeL、bert_score。请确认任务定义。',
    timestamp: '2026-04-01 10:00:06',
  },
  {
    id: 'msg_03',
    role: 'user',
    stage: 'task_confirm',
    content: '确认任务定义，保留法律领域。',
    timestamp: '2026-04-01 10:00:11',
  },
  {
    id: 'msg_04',
    role: 'agent',
    stage: 'data_prepare',
    content:
      '数据 schema 需要 source + summary。我建议优先上传标准模板数据；若是原始合同文本，可由 Data Agent 自动转换为训练格式。',
    timestamp: '2026-04-01 10:00:20',
  },
  {
    id: 'msg_05',
    role: 'user',
    stage: 'data_prepare',
    content: '我先上传原始材料，让 Data Agent 转换并校验。',
    timestamp: '2026-04-01 10:00:31',
  },
  {
    id: 'msg_06',
    role: 'agent',
    stage: 'plan_confirm',
    content:
      '建议计划：base_model=qwen2.5-1.5b-instruct，method=lora，epochs=3，batch_size=8，learning_rate=2e-4。确认后将冻结 run_spec。',
    timestamp: '2026-04-01 10:01:03',
  },
  {
    id: 'msg_07',
    role: 'user',
    stage: 'plan_confirm',
    content: '把 batch_size 改成 16，其他保持不变，确认计划。',
    timestamp: '2026-04-01 10:01:18',
  },
  {
    id: 'msg_08',
    role: 'agent',
    stage: 'train_execute',
    content: '计划已冻结，训练已启动。我会持续回传训练日志、loss 和 checkpoint 进度。',
    timestamp: '2026-04-01 10:01:25',
  },
  {
    id: 'msg_09',
    role: 'agent',
    stage: 'eval_confirm',
    content:
      '训练完成后将自动执行评估。当前评估策略：per_epoch + rougeL/bert_score。你也可以改为只在最终 checkpoint 评估。',
    timestamp: '2026-04-01 10:02:40',
  },
  {
    id: 'msg_10',
    role: 'user',
    stage: 'eval_confirm',
    content: '保持默认评估策略，继续。',
    timestamp: '2026-04-01 10:02:52',
  },
  {
    id: 'msg_11',
    role: 'agent',
    stage: 'eval_result',
    content:
      '评估完成：rougeL=42.7，bert_score=0.89。已生成 adapter、metrics.json、eval_report.json，可在结果区下载。',
    timestamp: '2026-04-01 10:03:30',
  },
];

// 示例：MCP 窗口事件流
export const SAMPLE_MCP_EVENTS: McpEvent[] = [
  {
    id: 'mcp_01',
    server: 'registry',
    tool: 'resource://tasks/task_registry',
    summary: '读取任务注册表，匹配 summarization 任务 schema',
    status: 'success',
    timestamp: '10:00:05',
  },
  {
    id: 'mcp_02',
    server: 'data',
    tool: 'schema.validate',
    summary: '校验数据字段 source + summary',
    status: 'success',
    timestamp: '10:00:36',
  },
  {
    id: 'mcp_03',
    server: 'training',
    tool: 'trainer.start_job',
    summary: '提交 LoRA 训练任务并返回 job_id=932',
    status: 'running',
    timestamp: '10:01:26',
  },
  {
    id: 'mcp_04',
    server: 'evaluation',
    tool: 'eval.report_generate',
    summary: '生成 rouge/bert_score 报告并落盘',
    status: 'success',
    timestamp: '10:03:28',
  },
  {
    id: 'mcp_05',
    server: 'trace',
    tool: 'run.append_event',
    summary: '写入 run_trace（Data -> Train -> Eval）',
    status: 'success',
    timestamp: '10:03:31',
  },
];

export const SAMPLE_SCENARIOS: SampleScenario[] = [
  {
    id: 'scenario_finance_full',
    title: '金融文本分类（全流程）',
    flowMode: 'full',
    taxonomy: { domain: '金融', type: '文本', task: '分类' },
    conversation: [
      { id: 'f1', role: 'user', stage: 'goal_input', content: '我选择全流程。', timestamp: '10:00:00' },
      { id: 'f2', role: 'agent', stage: 'goal_input', content: '已确认全流程，请确认领域-类型-任务。', timestamp: '10:00:01' },
      { id: 'f3', role: 'user', stage: 'task_confirm', content: '确认：金融 / 文本 / 分类。', timestamp: '10:00:04' },
      { id: 'f4', role: 'agent', stage: 'task_confirm', content: '好的，请描述具体目标、标签定义与效果要求。', timestamp: '10:00:07' },
      { id: 'f5', role: 'user', stage: 'goal_input', content: '训练一个财报情感分类模型，输出正面/中性/负面。', timestamp: '10:00:11' },
      { id: 'f6', role: 'agent', stage: 'plan_confirm', content: '规划完成：建议 LoRA + qwen2.5-1.5b，指标 accuracy/macro_f1。', timestamp: '10:00:20' },
      { id: 'f7', role: 'agent', stage: 'train_execute', content: '训练启动，已进入 MCP 训练事件流。', timestamp: '10:00:26' },
      { id: 'f8', role: 'agent', stage: 'eval_result', content: '评估完成，accuracy=0.89，macro_f1=0.86。', timestamp: '10:02:46' },
    ],
    mcpTimeline: [
      { id: 'fm1', server: 'registry', tool: 'task.lookup', summary: '加载 finance_text_classification schema', status: 'success', timestamp: '10:00:12' },
      { id: 'fm2', server: 'data', tool: 'dataset.validate', summary: '字段校验 text + label 通过', status: 'success', timestamp: '10:00:16' },
      { id: 'fm3', server: 'training', tool: 'trainer.start_job', summary: '提交训练任务 job_id=F2026', status: 'running', timestamp: '10:00:27' },
      { id: 'fm4', server: 'training', tool: 'trainer.checkpoint', summary: 'checkpoint-1000 已保存', status: 'running', timestamp: '10:01:15' },
      { id: 'fm5', server: 'evaluation', tool: 'eval.run', summary: '评估任务启动 eval_id=E301', status: 'running', timestamp: '10:02:22' },
      { id: 'fm6', server: 'evaluation', tool: 'eval.report_generate', summary: '生成评估报告与 metrics', status: 'success', timestamp: '10:02:45' },
    ],
  },
  {
    id: 'scenario_med_train',
    title: '医疗 NER（仅训练）',
    flowMode: 'train_only',
    taxonomy: { domain: '医疗', type: '文本', task: 'NER' },
    conversation: [
      { id: 'm1', role: 'user', stage: 'goal_input', content: '我选择仅训练。', timestamp: '11:00:00' },
      { id: 'm2', role: 'agent', stage: 'task_confirm', content: '请确认领域-类型-任务。', timestamp: '11:00:01' },
      { id: 'm3', role: 'user', stage: 'task_confirm', content: '确认：医疗 / 文本 / NER。', timestamp: '11:00:04' },
      { id: 'm4', role: 'user', stage: 'goal_input', content: '训练医学实体识别，识别疾病、药物、剂量。', timestamp: '11:00:08' },
      { id: 'm5', role: 'agent', stage: 'plan_confirm', content: '规划完成：NER BIO schema，指标 entity_f1/token_f1。', timestamp: '11:00:15' },
      { id: 'm6', role: 'agent', stage: 'train_execute', content: '仅训练模式，训练完成后不自动触发评估。', timestamp: '11:00:20' },
    ],
    mcpTimeline: [
      { id: 'mm1', server: 'registry', tool: 'task.lookup', summary: '加载 medical_ner_bio_v1', status: 'success', timestamp: '11:00:10' },
      { id: 'mm2', server: 'training', tool: 'trainer.start_job', summary: '提交训练任务 job_id=M588', status: 'running', timestamp: '11:00:21' },
      { id: 'mm3', server: 'training', tool: 'trainer.finish', summary: '训练完成，模型产物已归档', status: 'success', timestamp: '11:02:08' },
    ],
  },
  {
    id: 'scenario_legal_eval',
    title: '法律摘要（仅评估）',
    flowMode: 'eval_only',
    taxonomy: { domain: '法律', type: '文本', task: '摘要' },
    conversation: [
      { id: 'l1', role: 'user', stage: 'goal_input', content: '我选择仅评估。', timestamp: '12:00:00' },
      { id: 'l2', role: 'agent', stage: 'task_confirm', content: '请确认领域-类型-任务，并指定待评估模型。', timestamp: '12:00:01' },
      { id: 'l3', role: 'user', stage: 'task_confirm', content: '确认：法律 / 文本 / 摘要。模型是 legal-sum-v2。', timestamp: '12:00:08' },
      { id: 'l4', role: 'agent', stage: 'eval_confirm', content: '评估计划：rougeL + bert_score，使用验证集 law_val_2026。', timestamp: '12:00:14' },
      { id: 'l5', role: 'agent', stage: 'eval_result', content: '评估完成：rougeL=43.2，bert_score=0.90。', timestamp: '12:01:10' },
    ],
    mcpTimeline: [
      { id: 'lm1', server: 'evaluation', tool: 'eval.prepare', summary: '加载模型 legal-sum-v2 与验证集 law_val_2026', status: 'running', timestamp: '12:00:18' },
      { id: 'lm2', server: 'evaluation', tool: 'eval.run', summary: '执行摘要评估', status: 'running', timestamp: '12:00:32' },
      { id: 'lm3', server: 'evaluation', tool: 'eval.report_generate', summary: '报告生成完成', status: 'success', timestamp: '12:01:09' },
    ],
  },
];
