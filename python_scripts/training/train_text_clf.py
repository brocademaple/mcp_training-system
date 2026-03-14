#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Text classification training script for MCP Training System
Uses BERT model for text classification
"""

import sys
import json

# 强制 stdout 使用 UTF-8，避免 Windows 下中文过程日志在 Go/前端显示乱码
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
elif getattr(sys.stdout, "buffer", None) is not None:
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
import torch
from datasets import load_dataset
from transformers import (
    AutoTokenizer,
    AutoModelForSequenceClassification,
    TrainingArguments,
    Trainer,
    TrainerCallback
)


class ProgressCallback(TrainerCallback):
    """Callback to output training progress for Go to parse"""

    def on_log(self, args, state, control, logs=None, **kwargs):
        """Called when logging occurs during training; 输出供 Go/前端实时展示的指标"""
        if logs:
            progress = {
                "epoch": state.epoch if state.epoch else 0,
                "loss": logs.get("loss"),
                "learning_rate": logs.get("learning_rate"),
                "step": state.global_step,
                "max_steps": state.max_steps,
            }
            # 若有评估指标也一并输出（如 eval 时的 eval_loss / eval_accuracy）
            if "eval_loss" in logs:
                progress["eval_loss"] = logs["eval_loss"]
            if "eval_accuracy" in logs:
                progress["eval_accuracy"] = logs["eval_accuracy"]
            if "accuracy" in logs:
                progress["accuracy"] = logs["accuracy"]
            # 过滤 None，避免 JSON 序列化问题
            progress = {k: v for k, v in progress.items() if v is not None}
            if "loss" not in progress:
                progress["loss"] = 0
            print(f"PROGRESS:{json.dumps(progress)}", flush=True)


def _log(msg):
    """输出过程日志，供 Go 解析并推送到前端训练详情面板"""
    print(f"LOG:{msg}", flush=True)


def train_text_classification(dataset_path, hyperparams):
    """Train a text classification model.
    Supports CSV or JSON. Must have a text column ('text'/'content'/'review'/...) and a label column ('label'/'labels').
    """
    try:
        _log("正在加载数据集…")
        # Load dataset: 按扩展名选择 CSV 或 JSON，避免用 CSV 解析 JSON 导致 ParserError
        path_lower = dataset_path.lower()
        if path_lower.endswith('.json'):
            dataset = load_dataset('json', data_files={'train': dataset_path})
        else:
            dataset = load_dataset('csv', data_files={'train': dataset_path})
        train_ds = dataset['train']
        n_samples = len(train_ds)
        _log(f"数据集加载完成，共 {n_samples} 条样本")

        # Ensure text column: require 'text' or map common names to 'text'
        text_col = None
        for c in ('text', 'content', 'review', 'sentence', 'comment', 'instruction', 'input'):
            if c in train_ds.column_names:
                text_col = c
                break
        if text_col is None:
            raise ValueError(
                "数据需包含文本列，列名可为 'text'/'content'/'review'/'sentence'/'comment'/'instruction'/'input' 之一。"
                "当前列: " + ", ".join(train_ds.column_names)
            )
        if text_col != 'text':
            dataset = dataset.rename_column(text_col, 'text')
            train_ds = dataset['train']

        # Ensure labels column (Trainer expects 'labels')
        if 'labels' not in train_ds.column_names and 'label' in train_ds.column_names:
            dataset = dataset.rename_column('label', 'labels')
            train_ds = dataset['train']
        if 'labels' not in train_ds.column_names:
            raise ValueError(
                "文本分类需要标签列 'label' 或 'labels'（数值 0,1,... 或可转为整型的类别）。当前列: " + ", ".join(train_ds.column_names)
            )

        # 若标签为字符串（常见于 JSON），映射为 0,1,2,... 供 Trainer 使用
        sample_labels = train_ds['labels']
        need_map = bool(sample_labels and isinstance(sample_labels[0], str))
        if need_map:
            uniq = sorted(set(str(x) for x in sample_labels))
            label2id = {v: i for i, v in enumerate(uniq)}
            def map_label(examples):
                examples['labels'] = [label2id[str(x)] for x in examples['labels']]
                return examples
            dataset = dataset.map(map_label, batched=True)
            train_ds = dataset['train']

        # Infer num_labels from data (unique label values)
        try:
            num_labels = len(set(train_ds['labels']))
        except Exception:
            num_labels = 2
        if num_labels < 2:
            num_labels = 2

        # Base model: 支持多种文本/多模态底模，由 hyperparams.base_model 或 base_model_id 传入
        base_model = (
            hyperparams.get("base_model")
            or hyperparams.get("base_model_id")
            or "bert-base-uncased"
        )
        if isinstance(base_model, str):
            base_model = base_model.strip() or "bert-base-uncased"
        else:
            base_model = "bert-base-uncased"

        # Load tokenizer
        _log(f"正在加载 tokenizer ({base_model})…")
        tokenizer = AutoTokenizer.from_pretrained(base_model)
        _log("Tokenizer 加载完成")

        # Tokenize function
        def tokenize_function(examples):
            return tokenizer(examples["text"], padding="max_length", truncation=True, max_length=128)

        # Tokenize dataset
        _log("正在对文本进行分词…")
        tokenized_dataset = dataset.map(tokenize_function, batched=True)
        _log("分词完成")

        # Load model（与 tokenizer 使用同一底模）
        _log(f"正在加载预训练模型 ({base_model})…")
        model = AutoModelForSequenceClassification.from_pretrained(
            base_model,
            num_labels=num_labels
        )
        _log("模型加载完成")

        # Training arguments
        training_args = TrainingArguments(
            output_dir="./results",
            learning_rate=hyperparams.get('learning_rate', 2e-5),
            per_device_train_batch_size=hyperparams.get('batch_size', 16),
            num_train_epochs=hyperparams.get('epochs', 3),
            logging_steps=10,
            save_strategy="epoch",
            report_to="none"
        )

        # Create trainer
        trainer = Trainer(
            model=model,
            args=training_args,
            train_dataset=tokenized_dataset['train'],
            callbacks=[ProgressCallback()]
        )

        # 训练开始前先输出一条进度，避免前端长时间显示 0% 以为卡住
        num_epochs = int(hyperparams.get('epochs', 3))
        n_samples = len(tokenized_dataset['train'])
        batch_size = max(1, training_args.per_device_train_batch_size)
        total_steps = ((n_samples + batch_size - 1) // batch_size) * num_epochs
        initial = {
            "epoch": 0.0,
            "loss": 0,
            "learning_rate": training_args.learning_rate,
            "step": 0,
            "max_steps": total_steps,
        }
        print(f"PROGRESS:{json.dumps(initial)}", flush=True)

        # Train model
        num_epochs = int(hyperparams.get('epochs', 3))
        _log(f"开始训练，共 {num_epochs} 个 epoch…")
        trainer.train()
        _log("训练完成")

        # Save model
        model_save_path = f"./data/models/job_{hyperparams.get('job_id', 'unknown')}"
        _log(f"正在保存模型到 {model_save_path}…")
        trainer.save_model(model_save_path)
        # 保存底模标识，供评估脚本 tokenizer 回退使用
        try:
            import os
            config_path = os.path.join(model_save_path, "training_config.json")
            with open(config_path, "w", encoding="utf-8") as f:
                json.dump({"base_model": base_model}, f, ensure_ascii=False)
        except Exception:
            pass
        _log("模型已保存")

        # Get final loss
        final_loss = 0
        if trainer.state.log_history:
            for log in reversed(trainer.state.log_history):
                if 'loss' in log:
                    final_loss = log['loss']
                    break

        # Return success result
        result = {
            "status": "success",
            "model_path": model_save_path,
            "final_loss": final_loss
        }
        print(json.dumps(result))

    except Exception as e:
        # Return error result
        error_result = {
            "status": "error",
            "error_message": str(e)
        }
        print(json.dumps(error_result))
        sys.exit(1)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"status": "error", "error_message": "Missing arguments"}))
        sys.exit(1)

    dataset_path = sys.argv[1]
    hyperparams = json.loads(sys.argv[2])

    train_text_classification(dataset_path, hyperparams)
