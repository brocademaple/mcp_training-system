#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SFT + LoRA 参数高效微调脚本，与 train_text_clf.py 共用同一套 CLI 与 stdout 协议。
依赖：pip install trl[peft] peft
"""

import sys
import json
import os

# 强制 stdout 使用 UTF-8
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
elif getattr(sys.stdout, "buffer", None) is not None:
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

try:
    import torch
    from datasets import load_dataset
    from transformers import AutoTokenizer, AutoModelForCausalLM, TrainerCallback
    from trl import SFTConfig, SFTTrainer
    from peft import LoraConfig
except ImportError as e:
    print(json.dumps({
        "status": "error",
        "error_message": "请安装微调依赖: pip install trl[peft] peft。原始错误: " + str(e)
    }))
    sys.exit(1)


def _log(msg):
    print(f"LOG:{msg}", flush=True)


class ProgressCallback(TrainerCallback):
    """输出 PROGRESS 行供 Go/前端解析，与 train_text_clf 协议一致"""

    def on_log(self, args, state, control, logs=None, **kwargs):
        if not logs:
            return
        progress = {
            "epoch": state.epoch if state.epoch is not None else 0,
            "loss": logs.get("loss"),
            "learning_rate": logs.get("learning_rate"),
            "step": state.global_step,
            "max_steps": state.max_steps,
        }
        for k in ("eval_loss", "eval_accuracy", "accuracy"):
            if k in logs:
                progress[k] = logs[k]
        progress = {k: v for k, v in progress.items() if v is not None}
        if "loss" not in progress:
            progress["loss"] = 0
        print(f"PROGRESS:{json.dumps(progress)}", flush=True)


def run_finetune(dataset_path, hyperparams):
    job_id = hyperparams.get("job_id", "unknown")
    base_model = (
        hyperparams.get("base_model")
        or hyperparams.get("base_model_id")
        or "Qwen/Qwen2.5-0.5B-Instruct"
    )
    if not isinstance(base_model, str) or not base_model.strip():
        base_model = "Qwen/Qwen2.5-0.5B-Instruct"
    else:
        base_model = base_model.strip()

    num_epochs = int(hyperparams.get("epochs", 3))
    lr = float(hyperparams.get("learning_rate", 2e-4))
    batch_size = int(hyperparams.get("batch_size", 4))
    max_seq_length = int(hyperparams.get("max_seq_length", 512))

    _log("正在加载数据集…")
    path_lower = dataset_path.lower()
    if path_lower.endswith(".json"):
        dataset = load_dataset("json", data_files={"train": dataset_path})
    else:
        dataset = load_dataset("csv", data_files={"train": dataset_path})
    train_ds = dataset["train"]
    n_samples = len(train_ds)
    _log(f"数据集加载完成，共 {n_samples} 条样本")

    # 文本列
    text_col = None
    for c in ("text", "content", "review", "sentence", "comment", "instruction", "input"):
        if c in train_ds.column_names:
            text_col = c
            break
    if text_col is None:
        raise ValueError(
            "数据需包含文本列（如 text/content/review 等）。当前列: " + ", ".join(train_ds.column_names)
        )

    # 标签列，转为可读字符串（情感分类：0/1 -> 负面/正面 或保留原类别名）
    label_col = "labels" if "labels" in train_ds.column_names else "label"
    if label_col not in train_ds.column_names:
        raise ValueError("数据需包含标签列 label 或 labels。当前列: " + ", ".join(train_ds.column_names))

    # 若为数值标签，可映射为简短文字（便于 SFT 生成）
    sample_labels = train_ds[label_col]
    if sample_labels and isinstance(sample_labels[0], (int, float)):
        uniq = sorted(set(int(x) for x in sample_labels))
        id2label = {i: f"类别{i}" for i in uniq}
        if len(uniq) == 2:
            id2label = {0: "负面", 1: "正面"}
    else:
        uniq = sorted(set(str(x) for x in sample_labels))
        id2label = {i: v for i, v in enumerate(uniq)}

    def to_sft_text(example):
        txt = example.get(text_col, "")
        lab = example.get(label_col)
        if isinstance(lab, (int, float)):
            lab = id2label.get(int(lab), str(lab))
        else:
            lab = str(lab)
        return {"text": f"文本：{txt}\n情感：{lab}"}

    dataset = dataset.map(to_sft_text, remove_columns=train_ds.column_names)
    train_ds = dataset["train"]

    _log(f"正在加载 tokenizer 与模型 ({base_model})…")
    tokenizer = AutoTokenizer.from_pretrained(base_model, trust_remote_code=True)
    model = AutoModelForCausalLM.from_pretrained(
        base_model,
        torch_dtype=torch.bfloat16 if torch.cuda.is_available() else torch.float32,
        trust_remote_code=True,
    )

    # LoRA 只训练少量参数
    peft_config = LoraConfig(
        r=int(hyperparams.get("lora_r", 16)),
        lora_alpha=int(hyperparams.get("lora_alpha", 32)),
        lora_dropout=float(hyperparams.get("lora_dropout", 0.05)),
        bias="none",
        task_type="CAUSAL_LM",
        target_modules=["q_proj", "v_proj", "k_proj", "o_proj"],
    )

    total_steps = (n_samples + batch_size - 1) // batch_size * num_epochs
    initial = {
        "epoch": 0.0,
        "loss": 0,
        "learning_rate": lr,
        "step": 0,
        "max_steps": total_steps,
    }
    print(f"PROGRESS:{json.dumps(initial)}", flush=True)

    training_args = SFTConfig(
        output_dir="./results",
        learning_rate=lr,
        per_device_train_batch_size=batch_size,
        num_train_epochs=num_epochs,
        max_seq_length=max_seq_length,
        logging_steps=5,
        save_strategy="epoch",
        report_to="none",
    )

    trainer = SFTTrainer(
        model=model,
        args=training_args,
        train_dataset=train_ds,
        dataset_text_field="text",
        peft_config=peft_config,
        callbacks=[ProgressCallback()],
    )

    _log(f"开始 SFT+LoRA 微调，共 {num_epochs} 个 epoch…")
    trainer.train()
    _log("训练完成")

    model_save_path = f"./data/models/job_{job_id}"
    _log(f"正在保存模型到 {model_save_path}…")
    trainer.save_model(model_save_path)
    try:
        config_path = os.path.join(model_save_path, "training_config.json")
        with open(config_path, "w", encoding="utf-8") as f:
            json.dump({"base_model": base_model, "mode": "sft_finetune"}, f, ensure_ascii=False)
    except Exception:
        pass
    _log("模型已保存")

    final_loss = 0.0
    if trainer.state.log_history:
        for log in reversed(trainer.state.log_history):
            if "loss" in log:
                final_loss = log["loss"]
                break

    result = {
        "status": "success",
        "model_path": model_save_path,
        "final_loss": final_loss,
    }
    print(json.dumps(result))


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"status": "error", "error_message": "Missing arguments: dataset_path, hyperparams_json"}))
        sys.exit(1)

    dataset_path = sys.argv[1]
    hyperparams = json.loads(sys.argv[2])

    try:
        run_finetune(dataset_path, hyperparams)
    except Exception as e:
        print(json.dumps({"status": "error", "error_message": str(e)}))
        sys.exit(1)
