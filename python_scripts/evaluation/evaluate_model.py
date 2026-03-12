#!/usr/bin/env python3
"""
Model evaluation script for MCP Training System
Evaluates trained models and generates metrics, confusion matrix, ROC curve, and HTML report.
"""

import sys
import json
import os
import base64
import re
import numpy as np
import pandas as pd
from sklearn.metrics import (
    accuracy_score,
    precision_recall_fscore_support,
    confusion_matrix,
    roc_curve,
    roc_auc_score,
)
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from transformers import AutoModelForSequenceClassification, AutoTokenizer, pipeline


def get_positive_score(result_list):
    """Get probability of positive class (LABEL_1) from pipeline output."""
    for item in result_list:
        if item.get('label', '').endswith('1'):
            return float(item.get('score', 0.0))
    return 0.0


def evaluate_model(model_path, test_data_path, report_suffix=None):
    """Evaluate a trained model on test data and generate report artifacts."""
    try:
        report_dir = os.environ.get("REPORT_DIR", "./reports")
        os.makedirs(report_dir, exist_ok=True)

        if report_suffix is None:
            report_suffix = re.sub(r"[^\w\-]", "_", os.path.basename(model_path.rstrip("/")))

        # Load model and tokenizer
        model = AutoModelForSequenceClassification.from_pretrained(model_path)
        tokenizer = AutoTokenizer.from_pretrained("bert-base-uncased")

        # Pipeline: top_k=None 等价于原 return_all_scores=True，用于 ROC 概率
        classifier = pipeline(
            "text-classification",
            model=model,
            tokenizer=tokenizer,
            top_k=None,
        )

        # Load test data (CSV or JSON)
        if test_data_path.lower().endswith(".json"):
            df = pd.read_json(test_data_path)
        else:
            df = pd.read_csv(test_data_path)

        # 解析文本列：与训练脚本一致，支持 text/content/review/sentence/comment/instruction/input
        text_col = None
        for c in ("text", "content", "review", "sentence", "comment", "instruction", "input"):
            if c in df.columns:
                text_col = c
                break
        if text_col is None:
            raise KeyError(
                "测试集需包含文本列，列名可为 text/content/review/sentence/comment/instruction/input 之一。当前列: " + ", ".join(df.columns.astype(str))
            )
        texts = df[text_col].astype(str).tolist()

        # 解析标签列：支持 label 或 labels，数值或可转为 0/1
        label_col = None
        for c in ("label", "labels"):
            if c in df.columns:
                label_col = c
                break
        if label_col is None:
            raise KeyError(
                "测试集需包含标签列 label 或 labels。当前列: " + ", ".join(df.columns.astype(str))
            )
        raw_labels = df[label_col].tolist()
        # 统一为 0/1：若为字符串则映射 positive/1/true -> 1，其余 -> 0
        def to_binary(x):
            if x is None or (isinstance(x, float) and np.isnan(x)):
                return 0
            s = str(x).strip().lower()
            if s in ("1", "true", "yes", "positive", "pos"):
                return 1
            try:
                return 1 if int(float(x)) >= 1 else 0
            except (ValueError, TypeError):
                return 0
        true_labels = [to_binary(x) for x in raw_labels]

        # Predictions and scores for ROC
        predictions = []
        positive_scores = []
        for text in texts:
            result_list = classifier(text)[0]
            pred_label = 1 if get_positive_score(result_list) >= 0.5 else 0
            predictions.append(pred_label)
            positive_scores.append(get_positive_score(result_list))

        # Metrics
        accuracy = accuracy_score(true_labels, predictions)
        precision, recall, f1, _ = precision_recall_fscore_support(
            true_labels, predictions, average="binary"
        )
        cm = confusion_matrix(true_labels, predictions)

        # Paths (under report_dir)
        cm_path = os.path.join(report_dir, f"cm_{report_suffix}.png")
        roc_path = os.path.join(report_dir, f"roc_{report_suffix}.png")
        report_path = os.path.join(report_dir, f"eval_{report_suffix}.html")

        # Confusion matrix plot
        plt.figure(figsize=(8, 6))
        plt.imshow(cm, interpolation="nearest", cmap=plt.cm.Blues)
        plt.title("Confusion Matrix")
        plt.colorbar()
        plt.xlabel("Predicted Label")
        plt.ylabel("True Label")
        plt.tight_layout()
        plt.savefig(cm_path)
        plt.close()

        # ROC curve (binary: positive class = 1)
        if len(np.unique(true_labels)) >= 2 and len(set(positive_scores)) > 1:
            fpr, tpr, _ = roc_curve(true_labels, positive_scores, pos_label=1)
            roc_auc = roc_auc_score(true_labels, positive_scores)
        else:
            fpr, tpr = [0.0, 1.0], [0.0, 1.0]
            roc_auc = 0.5

        plt.figure(figsize=(8, 6))
        plt.plot(fpr, tpr, color="darkorange", lw=2, label=f"ROC curve (AUC = {roc_auc:.3f})")
        plt.plot([0, 1], [0, 1], color="navy", lw=2, linestyle="--")
        plt.xlim([0.0, 1.0])
        plt.ylim([0.0, 1.05])
        plt.xlabel("False Positive Rate")
        plt.ylabel("True Positive Rate")
        plt.title("Receiver Operating Characteristic (ROC) Curve")
        plt.legend(loc="lower right")
        plt.tight_layout()
        plt.savefig(roc_path)
        plt.close()

        # HTML report (metrics + images as base64 for portability)
        def _img_to_base64(path):
            if not os.path.isfile(path):
                return ""
            with open(path, "rb") as f:
                return base64.b64encode(f.read()).decode("utf-8")

        cm_b64 = _img_to_base64(cm_path)
        roc_b64 = _img_to_base64(roc_path)

        html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>模型评估报告 - {report_suffix}</title>
  <style>
    body {{ font-family: sans-serif; margin: 24px; background: #f5f5f5; }}
    h1 {{ color: #333; }}
    table {{ border-collapse: collapse; margin: 16px 0; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }}
    th, td {{ border: 1px solid #ddd; padding: 10px 16px; text-align: left; }}
    th {{ background: #1890ff; color: #fff; }}
    .section {{ margin: 24px 0; background: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }}
    .section h2 {{ margin-top: 0; color: #1890ff; }}
    img {{ max-width: 100%; height: auto; }}
  </style>
</head>
<body>
  <h1>模型评估报告</h1>
  <p>报告标识: <strong>{report_suffix}</strong></p>

  <div class="section">
    <h2>评估指标</h2>
    <table>
      <tr><th>指标</th><th>值</th></tr>
      <tr><td>准确率 (Accuracy)</td><td>{(accuracy * 100):.2f}%</td></tr>
      <tr><td>精确率 (Precision)</td><td>{(precision * 100):.2f}%</td></tr>
      <tr><td>召回率 (Recall)</td><td>{(recall * 100):.2f}%</td></tr>
      <tr><td>F1 分数 (F1-Score)</td><td>{(f1 * 100):.2f}%</td></tr>
      <tr><td>ROC AUC</td><td>{roc_auc:.3f}</td></tr>
    </table>
  </div>

  <div class="section">
    <h2>混淆矩阵</h2>
    <img src="data:image/png;base64,{cm_b64}" alt="Confusion Matrix" style="max-width: 480px;" />
  </div>

  <div class="section">
    <h2>ROC 曲线</h2>
    <img src="data:image/png;base64,{roc_b64}" alt="ROC Curve" style="max-width: 480px;" />
  </div>
</body>
</html>
"""
        with open(report_path, "w", encoding="utf-8") as f:
            f.write(html)

        result = {
            "status": "success",
            "accuracy": float(accuracy),
            "precision": float(precision),
            "recall": float(recall),
            "f1_score": float(f1),
            "roc_auc": float(roc_auc),
            "confusion_matrix_path": cm_path,
            "roc_curve_path": roc_path,
            "report_path": report_path,
        }
        print(json.dumps(result))

    except Exception as e:
        error_result = {
            "status": "error",
            "error_message": str(e),
        }
        print(json.dumps(error_result))
        sys.exit(1)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"status": "error", "error_message": "Missing arguments: model_path test_data_path [report_suffix] [report_dir]"}))
        sys.exit(1)

    model_path = sys.argv[1]
    test_data_path = sys.argv[2]
    report_suffix = sys.argv[3] if len(sys.argv) > 3 else None
    report_dir_arg = sys.argv[4] if len(sys.argv) > 4 else None

    if report_dir_arg:
        os.environ["REPORT_DIR"] = report_dir_arg
    evaluate_model(model_path, test_data_path, report_suffix)
