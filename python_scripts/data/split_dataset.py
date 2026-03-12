#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从已有数据集中按比例划分出训练集与测试集。
用法: python split_dataset.py <input_path> <train_ratio> <output_dir>
输出: 打印一行 JSON，含 train_path, test_path, train_count, test_count
"""

import sys
import json
import os
import time

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

import pandas as pd


def _read_file(path):
    path_lower = path.lower()
    if path_lower.endswith(".json"):
        return pd.read_json(path)
    for enc in ("utf-8", "utf-8-sig", "gbk", "gb18030", "latin1"):
        try:
            return pd.read_csv(path, encoding=enc)
        except (UnicodeDecodeError, UnicodeError):
            continue
    raise ValueError("无法解码文件，请使用 UTF-8/GBK 等编码的 CSV 或 JSON")


def main():
    if len(sys.argv) < 4:
        out = {"status": "error", "error_message": "用法: split_dataset.py <input_path> <train_ratio> <output_dir>"}
        print(json.dumps(out))
        sys.exit(1)

    input_path = sys.argv[1]
    try:
        train_ratio = float(sys.argv[2])
    except ValueError:
        train_ratio = 0.8
    if train_ratio <= 0 or train_ratio >= 1:
        train_ratio = 0.8
    output_dir = sys.argv[3]

    if not os.path.isdir(output_dir):
        os.makedirs(output_dir, exist_ok=True)

    df = _read_file(input_path)
    n = len(df)
    if n < 2:
        out = {"status": "error", "error_message": "数据至少需要 2 条才能划分"}
        print(json.dumps(out))
        sys.exit(1)

    # 分层抽样：若有 label/labels/output 列则按该列 stratify，保证训练/测试中类别比例一致。
    # 注意：stratify 不能包含 NaN，且极小类别会导致 sklearn 报错；因此需做清洗并支持自动降级为普通随机划分。
    stratify_col_name = None
    for col in ("label", "labels", "output"):
        if col in df.columns:
            stratify_col_name = col
            break

    try:
        from sklearn.model_selection import train_test_split
    except ImportError:
        # 无 sklearn 则简单随机打乱后切分
        df = df.sample(frac=1, random_state=42).reset_index(drop=True)
        n_train = max(1, int(n * train_ratio))
        train_df = df.iloc[:n_train]
        test_df = df.iloc[n_train:]
    else:
        def _split_without_stratify(_df: pd.DataFrame):
            return train_test_split(_df, train_size=train_ratio, random_state=42)

        if stratify_col_name is None:
            train_df, test_df = _split_without_stratify(df)
        else:
            stratify_series = df[stratify_col_name]

            # 过滤 stratify 列里的 NaN，避免 sklearn 报 ValueError: Input contains NaN
            mask = stratify_series.notna()
            df_s = df.loc[mask].copy()
            stratify_s = stratify_series.loc[mask]

            # 若过滤后数据过少，则直接普通随机划分
            if len(df_s) < 2:
                train_df, test_df = _split_without_stratify(df)
            else:
                # 仅在类别数 > 1 时尝试分层；失败则降级为普通随机划分
                try:
                    if stratify_s.nunique() > 1:
                        train_df, test_df = train_test_split(
                            df_s, train_size=train_ratio, stratify=stratify_s, random_state=42
                        )
                    else:
                        train_df, test_df = _split_without_stratify(df_s)
                except ValueError:
                    # 常见原因：某类别样本数过少导致无法分层；或 train/test 比例不满足分层要求
                    train_df, test_df = _split_without_stratify(df_s)

    base_name = os.path.splitext(os.path.basename(input_path))[0]
    ts = int(time.time())
    ext = ".csv"
    if input_path.lower().endswith(".json"):
        ext = ".json"

    train_name = f"dataset_{ts}_train{ext}"
    test_name = f"dataset_{ts}_test{ext}"
    train_path = os.path.join(output_dir, train_name)
    test_path = os.path.join(output_dir, test_name)

    if ext == ".json":
        train_df.to_json(train_path, orient="records", force_ascii=False)
        test_df.to_json(test_path, orient="records", force_ascii=False)
    else:
        train_df.to_csv(train_path, index=False, encoding="utf-8")
        test_df.to_csv(test_path, index=False, encoding="utf-8")

    result = {
        "status": "success",
        "train_path": train_path,
        "test_path": test_path,
        "train_count": len(train_df),
        "test_count": len(test_df),
    }
    print(json.dumps(result))


if __name__ == "__main__":
    main()
