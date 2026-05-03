# Task Intent Skill（任务理解）

## 目标

把小白用户输入的业务诉求，规范化为可被 `resolve-intent` 与后续训练步骤直接消费的结构化信息，减少“描述含糊导致流程中断”。

## 输入范式（前端模板字段）

1. 业务目标 `business_goal`（必填）
2. 任务类型候选 `task_type`（text_classification / sentiment_analysis / named_entity_recognition / summarization）
3. 文本列 `text_column`（默认 `text`）
4. 标签列 `label_column`（默认 `label`）
5. 样本规模 `sample_scale`（可选）
6. 成功指标 `success_metric`（f1 / accuracy / recall / precision）
7. 约束条件 `constraints`（可选）

## 标准化输出 schema

```json
{
  "goal_text": "string",
  "intent_payload": {
    "goal": "string"
  },
  "task_spec": {
    "semantic_task_type": "Classification|SequenceTagging|Generation|...",
    "domain": "General|Finance|Medical|...",
    "output_structure": "label|span|summary|..."
  },
  "dataset_expectation": {
    "text_column": "string",
    "label_column": "string",
    "sample_scale": "string"
  },
  "success_criteria": {
    "primary_metric": "f1|accuracy|recall|precision"
  }
}
```

## 与后续步骤映射

- 步骤 1 任务理解：使用 `intent_payload.goal` 调用 `/api/v1/agent/resolve-intent`
- 步骤 2 数据分析：使用 `dataset_expectation` 作为字段检查提示
- 步骤 3 训练执行：`success_criteria.primary_metric` 用于训练观察指标优先级
- 步骤 4 结果分析：将步骤 1 的目标语义作为解释对齐上下文

## 失败回退

- 若 `business_goal` 为空：阻断“下一步”，提示补全。
- 若字段名异常：保留默认 `text/label`，并在日志提示用户确认列名。
