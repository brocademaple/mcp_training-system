# 训练任务成功运行指南

训练任务失败时，请按下面步骤逐项检查并完成配置。

---

## 一、环境与依赖

### 1. Python 可用

- 后端会调用 Python 执行训练脚本，必须能正确找到 Python。
- **Windows**：在项目根目录执行 `py -3 --version` 或 `python --version`，能输出版本号即可。
- 若报错「Python was not found」或 **exit 9009**：
  - 从 [python.org](https://www.python.org/downloads/) 安装 Python 3.8+，安装时勾选 **Add Python to PATH**。
  - 或在 `.env` 中设置可用的 Python：
    - `PYTHON_PATH=python`（若终端里 `python` 可用）
    - 或 `PYTHON_PATH=C:\Python311\python.exe`（改为你本机路径）
  - 修改后**重启后端**（`go run cmd/server/main.go`）。

### 2. 安装 Python 依赖

训练脚本依赖：`torch`、`transformers`、`datasets` 等，需在**运行后端的同一 Python 环境**中安装：

```bash
# 项目根目录执行（与后端使用的 Python 一致）
pip install -r python_scripts/requirements.txt
```

Windows 上若用 `py -3` 启动后端，则用：

```bash
py -3 -m pip install -r python_scripts/requirements.txt
```

未安装时常见报错：`ModuleNotFoundError: No module named 'torch'` / `transformers` / `datasets`。

---

## 二、数据集要求

### 1. 数据集必须先清洗完成

- 只有**状态为「已就绪」**的数据集才能用于训练。
- 在「数据集」页确认该数据集状态为 **ready**；若为 processing 或 error，先完成导入/清洗或点击「重试清洗」。

### 2. CSV 列名要求

训练脚本要求清洗后的 CSV 至少包含：

| 用途     | 列名（任选其一） | 说明 |
|----------|------------------|------|
| 文本内容 | `text`、`content`、`review`、`sentence`、`comment` | 至少一列，会当作模型输入文本 |
| 标签     | `label` 或 `labels` | 整数标签，如 0/1 二分类，或 0,1,2,... 多分类 |

- 若你的 CSV 是「文本 + 情感/类别」两列，请把列名改成上述之一，或保证有一列名为 `text`、一列名为 `label`（或 `labels`）。
- 示例（二分类）：

  ```csv
  text,label
  "很好用",1
  "质量差",0
  ```

- 若原始数据列名是 `review`、`sentiment`，脚本会自动把 `review` 当作文本列；但**标签列必须叫 `label` 或 `labels`**，否则需在清洗后或本地把列名改为 `label`/`labels`。

---

## 三、创建训练任务时

1. **训练名称**：可选，便于在列表中区分。
2. **选择数据集**：只显示状态为「已就绪」的数据集，选已清洗成功的那一个。
3. **超参数**：学习率、batch size、epoch 按需填写即可。

创建后任务会进入「排队中」并自动开始；若失败，在任务列表中点该任务查看**状态/错误信息**（后端会把 Python 的 stderr 写入，便于排查）。

---

## 四、常见错误与处理

| 现象 / 报错 | 原因 | 处理 |
|-------------|------|------|
| exit 9009 / Python was not found | 系统找不到 Python | 安装 Python 并加入 PATH，或在 `.env` 设置 `PYTHON_PATH` 后重启后端 |
| ModuleNotFoundError: No module named 'torch'（或 transformers、datasets） | 当前 Python 环境未装依赖 | 用与后端相同的 Python 执行 `pip install -r python_scripts/requirements.txt` |
| dataset has no cleaned file path (status not ready) | 所选数据集未清洗完成 | 在数据集页等清洗完成或重试清洗，再选该数据集创建任务 |
| CSV must have a text column... / label column... | 清洗后的 CSV 缺少要求的列名 | 保证有一列是 text/content/review/sentence/comment 之一，一列是 label 或 labels，必要时改列名或重新清洗 |
| 训练中途失败（如 CUDA/显存错误） | 环境或资源问题 | 可先减小 batch_size、epochs，或改用 CPU（依赖当前脚本/环境是否支持） |

---

## 五、自检清单（按顺序做）

- [ ] 本机已安装 Python 3.8+，且终端能执行 `python` 或 `py -3`
- [ ] 已在 `.env` 中配置 `PYTHON_PATH`（若 Windows 下曾报 9009）
- [ ] 在项目根目录执行过 `pip install -r python_scripts/requirements.txt`（或 `py -3 -m pip install ...`）
- [ ] 使用的数据集状态为「已就绪」，且其清洗后的 CSV 含有 `text`（或 content/review/sentence/comment）和 `label`/`labels` 列
- [ ] 创建训练任务时选择了上述已就绪数据集
- [ ] 若仍失败，查看该任务的错误信息（含 stderr），根据上表对应处理

完成以上步骤后，训练任务应能成功启动并跑通。若仍有报错，把任务列表里该任务显示的**完整错误信息**贴出来便于进一步排查。
