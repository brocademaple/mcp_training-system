# Vibe Spec 四示例（最小数据与 RunSpec）

每个子目录包含 `run_spec.yaml` 与少量 `*.jsonl` 样本。在「经典版」创建训练任务时，可将 `run_spec` 字段内容粘贴到 API 或前端「使用 RunSpec」表单；Agent 版在生成计划后会自动附带 `run_spec`。

| 目录 | 语义任务 | 方法 | 领域 |
|------|-----------|------|------|
| [sentiment_lora_finance](sentiment_lora_finance/) | Classification / SentimentClassification | LoRA | Finance |
| [ner_qlora_general](ner_qlora_general/) | SequenceTagging / NER | QLoRA | General |
| [summarization_sft_research](summarization_sft_research/) | Generation / Summarization | SFT | Research |
| [chat_alignment_dpo_general](chat_alignment_dpo_general/) | Alignment / DPOTraining | DPO | General |

## 数据校验（可选）

```bash
py -3 python_scripts/data/validate_dataset_for_task.py examples/sentiment_lora_finance/train.jsonl Classification
```

Alignment 示例：

```bash
py -3 python_scripts/data/validate_dataset_for_task.py examples/chat_alignment_dpo_general/train.jsonl Alignment
```

## DPO 骨架训练

偏好数据通过 `python_scripts/training/dpo_train.py` 校验字段 `prompt` / `chosen` / `rejected` 后写入占位产物目录（可替换为完整 TRL DPO）。
