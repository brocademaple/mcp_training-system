#!/usr/bin/env python3
"""
下载 ModelScope 数据集到本项目 data/datasets 目录。

支持：
1. chinese-llama-alpaca（中文 Alpaca 指令集）-> data/datasets/chinese_llama_alpaca/
2. mini_imagenet100（小型 ImageNet 图像分类）-> data/datasets/mini_imagenet100/

用法（二选一）：
  python download_datasets.py                    # 仅用直链下载（无需 pip）
  python download_datasets.py --use-modelscope   # 使用 ModelScope SDK（需 pip install modelscope）
"""

import argparse
import os
import sys
import tarfile
import urllib.request

# 项目根目录的 data/datasets（脚本在 python_scripts/ 下，上一级为根）
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
DATASETS_DIR = os.path.join(PROJECT_ROOT, "data", "datasets")

# 数据集配置：名称、直链、保存路径
DATASETS = [
    {
        "id": "chinese_llama_alpaca",
        "name": "chinese-llama-alpaca（中文 Alpaca 指令集）",
        "url": "https://modelscope.cn/datasets/angelala00/chinese-llama-alpaca/resolve/master/alpaca_data_zh_51k.json",
        "filename": "alpaca_data_zh_51k.json",
        "subdir": "chinese_llama_alpaca",
    },
    {
        "id": "mini_imagenet100",
        "name": "mini_imagenet100（小型 ImageNet 图像分类）",
        "url": "https://modelscope.cn/datasets/tany0699/mini_imagenet100/resolve/master/train.tar.gz",
        "filename": "train.tar.gz",
        "subdir": "mini_imagenet100",
    },
]


def download_url(url: str, dest_path: str) -> bool:
    """使用直链下载文件（仅标准库）。"""
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "MCP-Training-System/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            total = int(resp.headers.get("Content-Length", 0))
            with open(dest_path, "wb") as f:
                done = 0
                while True:
                    chunk = resp.read(8192)
                    if not chunk:
                        break
                    f.write(chunk)
                    done += len(chunk)
                    if total and total > 0:
                        pct = 100 * done / total
                        print(f"\r  已下载 {done / (1024*1024):.2f} MB ({pct:.1f}%)", end="", flush=True)
        print()
        return True
    except Exception as e:
        print(f"  直链下载失败: {e}")
        return False


def download_with_modelscope():
    """使用 ModelScope SDK 下载（需 pip install modelscope）。"""
    try:
        from modelscope.msdatasets import MsDataset
    except ImportError:
        print("请先安装: pip install modelscope")
        sys.exit(1)

    for ds in DATASETS:
        subdir = os.path.join(DATASETS_DIR, ds["subdir"])
        os.makedirs(subdir, exist_ok=True)
        cache_dir = subdir
        print(f"正在通过 ModelScope 下载: {ds['name']} -> {subdir}")
        try:
            if ds["id"] == "chinese_llama_alpaca":
                d = MsDataset.load("angelala00/chinese-llama-alpaca", split="train", cache_dir=cache_dir)
            elif ds["id"] == "mini_imagenet100":
                d = MsDataset.load("tany0699/mini_imagenet100", split="train", cache_dir=cache_dir)
            else:
                continue
            print(f"  完成: {ds['name']}")
        except Exception as e:
            print(f"  下载失败: {e}")


def main():
    parser = argparse.ArgumentParser(description="下载 ModelScope 数据集到本项目")
    parser.add_argument("--use-modelscope", action="store_true", help="使用 ModelScope SDK 下载（需 pip install modelscope）")
    parser.add_argument("--extract", action="store_true", help="下载后解压 tar.gz（仅对 mini_imagenet100）")
    args = parser.parse_args()

    if args.use_modelscope:
        download_with_modelscope()
        return

    print(f"数据集将保存到: {DATASETS_DIR}\n")
    for ds in DATASETS:
        subdir = os.path.join(DATASETS_DIR, ds["subdir"])
        dest = os.path.join(subdir, ds["filename"])
        if os.path.isfile(dest):
            print(f"[已存在] {ds['name']}: {dest}")
            if args.extract and ds["filename"].endswith(".tar.gz"):
                extract_path = os.path.join(subdir, "train")
                if not os.path.isdir(extract_path):
                    print(f"  解压中 -> {extract_path}")
                    with tarfile.open(dest, "r:gz") as tf:
                        tf.extractall(subdir)
            continue
        print(f"下载: {ds['name']}")
        if download_url(ds["url"], dest):
            print(f"  已保存: {dest}")
            if args.extract and ds["filename"].endswith(".tar.gz"):
                print(f"  解压中 -> {subdir}")
                with tarfile.open(dest, "r:gz") as tf:
                    tf.extractall(subdir)
        else:
            print("  建议使用: python download_datasets.py --use-modelscope")
    print("\n全部完成。")


if __name__ == "__main__":
    main()
