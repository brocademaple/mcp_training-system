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

        # Load model and tokenizer（与训练时一致，优先用模型目录内的 tokenizer）
        model = AutoModelForSequenceClassification.from_pretrained(model_path)
        try:
            tokenizer = AutoTokenizer.from_pretrained(model_path)
        except Exception:
            tokenizer = AutoTokenizer.from_pretrained("bert-base-uncased")

        # BERT 等模型最大长度为 512，超长文本必须截断，否则报 token indices sequence length > 512
        max_length = min(512, getattr(tokenizer, "model_max_length", 512))
        if max_length > 512:
            max_length = 512

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

        # 解析标签列：支持 label、labels，或 instruction 格式的 output
        label_col = None
        for c in ("label", "labels", "output"):
            if c in df.columns:
                label_col = c
                break
        if label_col is None:
            raise KeyError(
                "测试集需包含标签列 label、labels 或 output。当前列: " + ", ".join(df.columns.astype(str))
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

        # Predictions and scores for ROC（超长文本截断到 max_length，避免 614 > 512 报错）
        predictions = []
        positive_scores = []
        for text in texts:
            result_list = classifier(text, truncation=True, max_length=max_length)[0]
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

        # Confusion matrix plot：明确轴为「预测/真实」与「负类/正类」，便于零基础阅读
        labels_axis = ["负类 (0)", "正类 (1)"]
        if cm.shape[0] == 1:
            labels_axis = ["负类 (0)"]
        plt.figure(figsize=(5, 4))
        plt.imshow(cm, interpolation="nearest", cmap=plt.cm.Blues)
        plt.title("混淆矩阵 Confusion Matrix", fontsize=12)
        plt.colorbar(shrink=0.8, label="样本数")
        plt.xlabel("预测标签 Predicted", fontsize=10)
        plt.ylabel("真实标签 True", fontsize=10)
        if cm.shape[0] <= 2 and cm.shape[1] <= 2:
            plt.xticks(range(cm.shape[1]), labels_axis[: cm.shape[1]])
            plt.yticks(range(cm.shape[0]), labels_axis[: cm.shape[0]])
        thresh = cm.max() / 2.0
        for i in range(cm.shape[0]):
            for j in range(cm.shape[1]):
                plt.text(
                    j, i, str(int(cm[i, j])),
                    ha="center", va="center",
                    color="white" if cm[i, j] > thresh else "black",
                    fontsize=14, fontweight="bold",
                )
        plt.tight_layout()
        plt.savefig(cm_path, dpi=120)
        plt.close()

        # ROC curve (binary: positive class = 1)
        if len(np.unique(true_labels)) >= 2 and len(set(positive_scores)) > 1:
            fpr, tpr, _ = roc_curve(true_labels, positive_scores, pos_label=1)
            roc_auc = roc_auc_score(true_labels, positive_scores)
        else:
            fpr, tpr = [0.0, 1.0], [0.0, 1.0]
            roc_auc = 0.5

        plt.figure(figsize=(5, 4))
        plt.plot(fpr, tpr, color="darkorange", lw=2, label=f"本模型 (AUC = {roc_auc:.3f})")
        plt.plot([0, 1], [0, 1], color="navy", lw=1.5, linestyle="--", label="随机猜测 (0.5)")
        plt.xlim([0.0, 1.0])
        plt.ylim([0.0, 1.05])
        plt.xlabel("假正率 False Positive Rate", fontsize=10)
        plt.ylabel("真正率 True Positive Rate", fontsize=10)
        plt.title("ROC 曲线\n(越靠近左上角、AUC 越接近 1 表示模型越好)", fontsize=11)
        plt.legend(loc="lower right", fontsize=9)
        plt.tight_layout()
        plt.savefig(roc_path, dpi=120)
        plt.close()

        # HTML report (metrics + images as base64 for portability)
        def _img_to_base64(path):
            if not os.path.isfile(path):
                return ""
            with open(path, "rb") as f:
                return base64.b64encode(f.read()).decode("utf-8")

        cm_b64 = _img_to_base64(cm_path)
        roc_b64 = _img_to_base64(roc_path)

        # 简要结论（便于零基础用户一眼看懂）
        if accuracy >= 0.8 and f1 >= 0.7:
            summary = "综合来看，模型在测试集上表现较好，准确率与 F1 均处于较高水平。"
        elif accuracy >= 0.6:
            summary = "模型具备一定区分能力，仍有提升空间，可考虑增加数据或调整训练参数。"
        else:
            summary = "当前指标偏低，建议检查数据质量、标签一致性或尝试更多训练轮次与调参。"

        html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>模型评估报告 - {report_suffix}</title>
  <style>
    * {{ box-sizing: border-box; }}
    body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; margin: 0; padding: 20px; background: #f0f2f5; color: #262626; line-height: 1.5; }}
    .report {{ max-width: 900px; margin: 0 auto; }}
    .header {{ background: linear-gradient(135deg, #1890ff 0%, #096dd9 100%); color: #fff; padding: 16px 20px; border-radius: 8px 8px 0 0; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; }}
    .header h1 {{ margin: 0; font-size: 18px; font-weight: 600; }}
    .header .id {{ font-size: 12px; opacity: 0.9; }}
    .card {{ background: #fff; border-radius: 8px; box-shadow: 0 1px 2px rgba(0,0,0,0.06); padding: 16px 20px; margin-bottom: 16px; }}
    .card h2 {{ margin: 0 0 12px 0; font-size: 15px; color: #1890ff; font-weight: 600; border-bottom: 1px solid #e8e8e8; padding-bottom: 8px; }}
    .row {{ display: flex; gap: 16px; flex-wrap: wrap; }}
    .row .col {{ flex: 1; min-width: 260px; }}
    table {{ border-collapse: collapse; width: 100%; font-size: 13px; }}
    th, td {{ border: 1px solid #e8e8e8; padding: 8px 12px; text-align: left; }}
    th {{ background: #fafafa; color: #262626; font-weight: 600; }}
    .metric-val {{ font-weight: 600; color: #1890ff; }}
    .glossary {{ font-size: 12px; color: #595959; }}
    .glossary p {{ margin: 4px 0; }}
    .glossary strong {{ color: #262626; }}
    .summary {{ background: #e6f7ff; border-left: 4px solid #1890ff; padding: 10px 14px; font-size: 13px; margin: 12px 0 0 0; border-radius: 0 4px 4px 0; }}
    .figure-wrap {{ margin-top: 8px; }}
    .figure-wrap img {{ max-width: 100%; height: auto; border-radius: 4px; display: block; }}
    .figure-caption {{ font-size: 12px; color: #8c8c8c; margin-top: 6px; }}
  </style>
</head>
<body>
  <div class="report">
    <div class="header">
      <h1>模型评估报告</h1>
      <span class="id">报告 ID：{report_suffix}</span>
    </div>

    <div class="card">
      <p style="margin: 0 0 12px 0; font-size: 13px; color: #595959;">本报告展示模型在测试集上的表现，供您判断模型质量。下方指标与图表可结合「指标说明」一起阅读。</p>
      <div class="summary">{summary}</div>
    </div>

    <div class="card">
      <h2>核心指标</h2>
      <div class="row">
        <div class="col">
          <table>
            <tr><th>指标</th><th>值</th></tr>
            <tr><td>准确率</td><td class="metric-val">{(accuracy * 100):.2f}%</td></tr>
            <tr><td>精确率</td><td class="metric-val">{(precision * 100):.2f}%</td></tr>
            <tr><td>召回率</td><td class="metric-val">{(recall * 100):.2f}%</td></tr>
            <tr><td>F1 分数</td><td class="metric-val">{(f1 * 100):.2f}%</td></tr>
            <tr><td>ROC AUC</td><td class="metric-val">{roc_auc:.3f}</td></tr>
          </table>
        </div>
        <div class="col glossary">
          <p><strong>准确率</strong>：预测正确的样本占总样本的比例，最直观的整体正确率。</p>
          <p><strong>精确率</strong>：模型预测为「正」的样本中，真正为正的比例；高精确率说明少误报。</p>
          <p><strong>召回率</strong>：真实为正的样本中，被模型正确找出的比例；高召回率说明少漏报。</p>
          <p><strong>F1 分数</strong>：精确率与召回率的调和平均，综合衡量两者。</p>
          <p><strong>ROC AUC</strong>：模型区分正负样本的能力，0.5 为随机，越接近 1 越好。</p>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>混淆矩阵</h2>
      <p class="figure-caption" style="margin: 0 0 8px 0;">横轴为模型预测结果，纵轴为真实标签；对角线上的数字越大越好（预测与真实一致）。</p>
      <div class="figure-wrap">
        <img src="data:image/png;base64,{cm_b64}" alt="混淆矩阵" style="max-width: 380px;" />
      </div>
    </div>

    <div class="card">
      <h2>ROC 曲线</h2>
      <p class="figure-caption" style="margin: 0 0 8px 0;">曲线越靠近左上角、AUC 越接近 1 表示模型区分能力越强；虚线为随机猜测参考线。</p>
      <div class="figure-wrap">
        <img src="data:image/png;base64,{roc_b64}" alt="ROC 曲线" style="max-width: 380px;" />
      </div>
    </div>
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
