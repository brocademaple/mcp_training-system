#!/usr/bin/env python3
"""
Deterministic dataset analysis for Data Agent.

This script only computes measurable statistics and schema signals.
Interpretation/suggestion is handled by backend agent logic (rule + optional LLM).
"""

import json
import os
import sys
from collections import Counter

import pandas as pd


TEXT_HINTS = ("text", "content", "review", "sentence", "comment", "prompt", "instruction", "input", "source")
LABEL_HINTS = ("label", "labels", "class", "category", "target", "sentiment", "intent", "tag", "output")


def _read_table(path: str) -> pd.DataFrame:
    ext = os.path.splitext(path)[1].lower()
    if ext in (".json", ".jsonl"):
        if ext == ".jsonl":
            return pd.read_json(path, lines=True, encoding="utf-8")
        return pd.read_json(path, encoding="utf-8")

    for encoding in ("utf-8", "utf-8-sig", "gbk", "gb18030", "latin1"):
        try:
            return pd.read_csv(path, encoding=encoding)
        except (UnicodeDecodeError, UnicodeError):
            continue
    raise ValueError("failed to decode file with utf-8/gbk/gb18030/latin1")


def _find_column(columns, hints):
    lowered = [str(c).strip().lower() for c in columns]
    for hint in hints:
        for i, col in enumerate(lowered):
            if hint == col:
                return columns[i]
    for hint in hints:
        for i, col in enumerate(lowered):
            if hint in col:
                return columns[i]
    return None


def _to_float(v, fallback=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return fallback


def _safe_ratio(num: int, den: int) -> float:
    if den <= 0:
        return 0.0
    return float(num) / float(den)


def _detect_task_hints(columns, text_column, label_column):
    c = {str(x).strip().lower() for x in columns}
    hints = []
    if "tokens" in c and ("tags" in c or "ner_tags" in c):
        hints.append("named_entity_recognition")
    if "source" in c and "summary" in c:
        hints.append("summarization")
    if "instruction" in c and "output" in c:
        hints.append("text_generation")
    if label_column is not None and text_column is not None:
        label_name = str(label_column).strip().lower()
        if "sentiment" in label_name:
            hints.append("sentiment_analysis")
        hints.append("text_classification")
    if text_column is not None and not hints:
        hints.append("text_generation")
    if not hints:
        hints.append("other")
    seen = set()
    dedup = []
    for h in hints:
        if h not in seen:
            seen.add(h)
            dedup.append(h)
    return dedup


def analyze_data(file_path):
    try:
        df = _read_table(file_path)
        row_count = int(len(df))
        column_count = int(len(df.columns))
        columns = [str(c) for c in df.columns]

        text_column = _find_column(df.columns, TEXT_HINTS)
        label_column = _find_column(df.columns, LABEL_HINTS)

        total_cells = max(row_count * max(column_count, 1), 1)
        null_cells = int(df.isnull().sum().sum()) if row_count > 0 else 0
        null_ratio = _safe_ratio(null_cells, total_cells)

        duplicate_rows = int(df.duplicated().sum()) if row_count > 0 else 0
        duplicate_ratio = _safe_ratio(duplicate_rows, max(row_count, 1))

        empty_text_rows = 0
        avg_text_length = 0.0
        short_text_ratio = 0.0
        unique_text_ratio = 0.0
        if text_column is not None and row_count > 0:
            texts = df[text_column].fillna("").astype(str).str.strip()
            empty_text_rows = int((texts == "").sum())
            lengths = texts.str.len()
            avg_text_length = _to_float(lengths.mean())
            short_text_ratio = _safe_ratio(int((lengths < 8).sum()), row_count)
            unique_text_ratio = _safe_ratio(int(texts.nunique(dropna=True)), row_count)

        label_distribution = {}
        num_classes = 0
        label_imbalance_ratio = 0.0
        if label_column is not None and row_count > 0:
            counts = df[label_column].fillna("__NULL__").astype(str).value_counts(dropna=False)
            label_distribution = {str(k): int(v) for k, v in counts.items()}
            num_classes = int(len(counts))
            if num_classes > 1:
                max_count = int(counts.max())
                min_count = int(counts.min())
                if min_count > 0:
                    label_imbalance_ratio = float(max_count) / float(min_count)

        type_counter = Counter(str(dt) for dt in df.dtypes)
        column_types = {k: int(v) for k, v in type_counter.items()}

        deterministic_issues = []
        if row_count < 50:
            deterministic_issues.append("row_count_low")
        if null_ratio > 0.10:
            deterministic_issues.append("high_null_ratio")
        if duplicate_ratio > 0.20:
            deterministic_issues.append("high_duplicate_ratio")
        if text_column is None:
            deterministic_issues.append("text_column_missing")
        elif _safe_ratio(empty_text_rows, max(row_count, 1)) > 0.05:
            deterministic_issues.append("empty_text_rows")
        if label_column is not None:
            if num_classes <= 1:
                deterministic_issues.append("single_class")
            elif label_imbalance_ratio > 10:
                deterministic_issues.append("label_imbalance")

        result = {
            "status": "success",
            "row_count": row_count,
            "column_count": column_count,
            "columns": columns,
            "column_types": column_types,
            "text_column": str(text_column) if text_column is not None else None,
            "label_column": str(label_column) if label_column is not None else None,
            "num_classes": num_classes if num_classes > 0 else None,
            "null_ratio": null_ratio,
            "duplicate_rows": duplicate_rows,
            "duplicate_ratio": duplicate_ratio,
            "empty_text_rows": empty_text_rows,
            "empty_text_ratio": _safe_ratio(empty_text_rows, max(row_count, 1)),
            "avg_text_length": avg_text_length,
            "short_text_ratio": short_text_ratio,
            "unique_text_ratio": unique_text_ratio,
            "label_distribution": label_distribution,
            "task_type_hints": _detect_task_hints(columns, text_column, label_column),
            "issues": deterministic_issues,
        }
        print(json.dumps(result, ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({"status": "error", "error_message": str(exc)}, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"status": "error", "error_message": "Usage: analyze_data.py <file_path>"}))
        sys.exit(1)
    analyze_data(sys.argv[1])
