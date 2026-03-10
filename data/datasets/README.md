# 数据集目录

本目录用于存放项目用到的数据集。

---

## 已下载好的文件放到哪里

如果你已经在别处下载好了数据集，请按下面结构放到项目中（路径均相对于 `data/datasets/`）：

| 数据集 | 放入路径 | 文件名 / 内容 |
|--------|----------|----------------|
| **chinese-llama-alpaca** | `chinese_llama_alpaca/` | `alpaca_data_zh_51k.json` |
| **mini_imagenet100** | `mini_imagenet100/` | `train.tar.gz`，或解压后的 `train/` 文件夹 |

目录结构示例：

```
data/datasets/
├── chinese_llama_alpaca/
│   └── alpaca_data_zh_51k.json    # 已存在即表示已放入
├── mini_imagenet100/
│   ├── train.tar.gz               # 或仅保留解压后的 train/
│   └── train/                     # 可选：解压后的图片目录
└── README.md
```

复制或移动你本地已下载的 `alpaca_data_zh_51k.json` 到 `data/datasets/chinese_llama_alpaca/`，`train.tar.gz` 或 `train/` 到 `data/datasets/mini_imagenet100/` 即可。

---

## 1. chinese-llama-alpaca（中文 Alpaca 指令集）

- **文件**：`chinese_llama_alpaca/alpaca_data_zh_51k.json`（约 18.67MB）
- **页面**：https://modelscope.cn/datasets/angelala00/chinese-llama-alpaca/files  
- **直链**：https://modelscope.cn/datasets/angelala00/chinese-llama-alpaca/resolve/master/alpaca_data_zh_51k.json  

若文件不存在，在项目根目录执行：

```bash
python python_scripts/download_datasets.py
```

或使用 ModelScope 下载到本目录：

```bash
pip install modelscope
python -c "
from modelscope.msdatasets import MsDataset
MsDataset.load('angelala00/chinese-llama-alpaca', split='train', cache_dir='./data/datasets/chinese_llama_alpaca')
print('chinese-llama-alpaca 下载完成')
"
```

## 2. mini_imagenet100（小型 ImageNet 图像分类）

- **规模**：100 类，约 7 万张图  
- **页面**：https://modelscope.cn/datasets/tany0699/mini_imagenet100/files  

直链可能不可用，建议用 ModelScope SDK 下载到本目录：

```bash
pip install modelscope
python -c "
from modelscope.msdatasets import MsDataset
MsDataset.load('tany0699/mini_imagenet100', split='train', cache_dir='./data/datasets/mini_imagenet100')
print('mini_imagenet100 下载完成')
"
```

或使用项目自带脚本（需先安装 ModelScope）：

```bash
pip install modelscope
python python_scripts/download_datasets.py --use-modelscope
```

## 一键下载（推荐）

在项目根目录执行：

```bash
pip install modelscope
python python_scripts/download_datasets.py --use-modelscope
```

如需同时解压 `train.tar.gz`（仅 mini_imagenet100）：

```bash
python python_scripts/download_datasets.py --use-modelscope --extract
```
