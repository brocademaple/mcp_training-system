# 项目学习指南

适合从零理解本项目，把「vibe coding」变成「能讲清楚、能改得动」的代码。

---

## 一、一句话理解项目

**用户上传 CSV → 系统自动清洗 → 选数据集点训练 → 实时看进度 → 训练完可评估、下模型和报告。**

技术上：**Go 做 API 和调度，三个 Agent（数据 / 训练 / 评估）各管一块，AI 真正干活的是 Python（Pandas/PyTorch/sklearn），数据在 PostgreSQL，进度用 Redis 推。**

---

## 二、建议学习顺序（先文档后代码）

| 步骤 | 看什么 | 目的 |
|------|--------|------|
| 1 | **README.md** | 能跑起来、知道技术栈和目录结构 |
| 2 | **本文「三、5. 模型训练入门」** | 第一次接触模型训练时：训练/epoch/批大小/学习率、数据要求、失败原因与重启 |
| 3 | **PRD.md** 第 1、2、5 节 | 业务目标、架构图、数据/训练/评估流程 |
| 4 | **internal/database/migrations/001_init.sql** | 6 张表各存什么（users, datasets, training_jobs, models, training_logs, evaluations） |
| 5 | **cmd/server/main.go** | 入口：怎么连 DB/Redis、怎么挂路由、哪些 Handler |
| 6 | 按「一条用户请求」跟代码 | 见下文「按请求跟代码」 |

---

## 三、核心概念（必记）

### 1. 三层架构

- **HTTP 层**：Gin 路由 → Handler（解析参数、调 Agent、写响应）
- **Agent 层**：DataAgent / TrainingAgent / EvaluationAgent，Go 里写业务逻辑、调 Python
- **Python 脚本**：真正做清洗、训练、评估，用 JSON 和 Go 通信

### 2. 「MCP」在项目里指什么

这里没有用标准 MCP SDK，而是**自己约定**：协调层（Go）把任务分给三个 Agent，Agent 之间通过**消息/调用关系**协作（可对照 PRD 2.3 节的请求/响应格式理解）。重点理解「谁调谁、数据怎么传」。

### 3. 数据流（记这条链）

```
上传/URL → 存文件 + 写 datasets 表 → DataAgent.CleanData(Python) → 更新 status=ready
→ 用户创建训练任务 → 写 training_jobs + Redis 队列 → TrainingAgent.Train(Python)
→ 进度写 Redis + 可选 WebSocket 推前端 → 训练完写 models 表
→ 用户创建评估 → EvaluationAgent.Evaluate(Python) → 写 evaluations 表 + 报告文件
```

### 4. 数据集状态与「重试清洗」

- **datasets 表 status**：`uploading` → `processing`（正在清洗）→ `ready`（可训练）或 `error`（清洗失败）。
- **error 常见原因**：Python 未安装/未加入 PATH、缺 pandas、CSV 编码异常等；错误信息会写入 `datasets.error_message`，前端在状态列悬停可看。
- **重试清洗**：只对 **status=error** 且存在 **original_file_path** 的记录生效；不重新上传文件，用**同一份原始文件**再跑一遍 `CleanData`（同一套 Python 脚本），成功则更新为 ready，失败则再次写入 error_message。

### 5. 模型训练入门（零基础可读）

面向第一次接触模型训练的用户，用本系统时需要知道的最小概念。

#### 5.1 一句话：训练是在做什么

**训练** = 让程序根据你提供的「文本 + 标签」数据，反复学习规律，最后得到一个**模型**。之后给这个模型一段新文本，它可以自动预测出标签（例如：这段评论是「好评」还是「差评」）。

本系统做的是**文本分类**：每条数据是一段文字 + 一个类别（标签）；训练完成后，模型能对新的文字给出类别预测。

#### 5.2 本系统用到的技术（不必深究，知道名词即可）

- **BERT**：一种「预训练」好的文本模型，我们在此基础上用你的数据**再训练**（微调），得到适合你任务的分类模型。
- **Epoch（轮次）**：把所有训练数据完整跑一遍叫 1 个 epoch。例如设 3 个 epoch，就是让模型把你的数据从头到尾学 3 遍；一般 3～5 轮就够，太多可能过拟合。
- **Batch size（批大小）**：每次喂给模型多少条数据一起算。越大显存占用越高、速度可能更快；越小更省显存但可能更慢。常见 16、32。
- **Learning rate（学习率）**：模型每次更新参数时的步长。太小学得慢，太大可能学不稳。本系统默认 2e-5 是 BERT 微调时常用的安全值。

创建训练任务时，这些参数都有默认值，第一次用可以直接点「创建」，等熟悉后再按需调整。

#### 5.3 数据要长什么样

- 训练数据里至少要有：
  - **一列「文本」**：列名可以是 `text`、`content`、`review`、`sentence`、`comment` 等（系统会自动识别）。
  - **一列「标签」**：列名建议用 `label` 或 `labels`，内容是类别（如 0/1、好评/差评、体育/财经 等）。
- **为什么要先「清洗」**：上传 **CSV** 时，系统会先做去重、去空等处理，并生成一份「清洗后的文件」（`*_cleaned.csv`），同时把该路径写入数据库的 `cleaned_file_path`，状态变为 **ready**。只有状态为 **已就绪（ready）** 的数据集才能被选来训练。
- **什么叫「清洗完成的数据集」**：  
  - **CSV**：系统在后台跑完清洗脚本，生成了 `cleaned_file_path` 且状态为 ready，即清洗完成。  
  - **JSON 等非 CSV**：上传后不跑清洗脚本，直接以**原文件**作为可训练路径并标记为 ready，即「可直接用、无需清洗」的数据集。  
  若界面显示 ready 但训练仍报「dataset has no cleaned file path」，多半是历史数据在标记 ready 时未写入路径；新上传的 JSON 已修复为会同时写入路径，已有数据也会在训练时自动用原始路径兜底。

#### 5.4 任务状态分别代表什么

| 状态   | 含义 |
|--------|------|
| 排队中 | 任务已创建，正在等待开始（或数据集未就绪时会被自动标为失败） |
| 训练中 | 正在跑训练脚本，可通过进度条和「进度详情」看当前 epoch |
| 已完成 | 训练正常结束，可在「模型管理」里下载模型 |
| 失败   | 训练出错，点击「进度详情」或看列表中的失败原因说明 |

若之前失败是因为「数据集未就绪」，在数据集管理里等清洗完成或重试清洗后，可在该任务上点**重启训练**，用同一配置重新跑一次。

#### 5.5 训练失败时常见原因与对应做法

系统会在「进度详情」或列表中给出失败原因；下面是对应关系，方便第一次接触的用户排查：

| 提示/原因 | 可能原因（人话） | 建议做法 |
|-----------|------------------|----------|
| dataset has no cleaned file path / status not ready | 所选数据集还没完成清洗或清洗失败 | 到「数据集管理」看该数据集状态，等待清洗完成或点「重试清洗」；再创建/重启训练任务 |
| no such file / file not found | 训练用的数据文件被删或路径不对 | 重新上传并清洗该数据集，再创建新训练任务 |
| Python / exec / not found | 本机没装 Python，或环境没配好 | 检查后端配置（如 `.env` 里 `PYTHON_PATH`）和 Python 依赖（见 README） |
| column ... does not exist / 数据格式 | 数据里缺少「文本」或「标签」列 | 确保 CSV 有 `text`/`content`/`review` 等一列，以及 `label`/`labels` 一列 |
| cuda / gpu / out of memory | 显存不够或 GPU 驱动异常 | 把 batch size 调小（如改为 8），或改用 CPU 训练（见 README 环境说明） |

遇到其他英文报错时，可把完整错误信息复制到「进度详情」里查看；系统会尽量匹配并给出中文「可能原因」说明。

#### 5.6 重启训练是什么意思

对**已失败**或**已完成**的任务，可以点「重启训练」。系统会：

- 把该任务的进度和错误信息清空，状态改回「排队中」；
- 用**同一份配置**（同一数据集、同一批超参数）再跑一遍训练流程。

适用场景：之前因「数据集未就绪」失败，现在数据集已经 ready；或你想用同一配置再训练一次。无需重新创建任务。

#### 5.7 预训练底模（文本与多模态）

训练「文本分类」任务时，可在创建任务时选择**预训练底模**（`hyperparams.base_model`），系统会从 HuggingFace 加载对应 tokenizer 与模型进行微调。

- **当前直接支持（文本分类）**：  
  - `bert-base-uncased`（默认，英文）、`bert-base-chinese`（中文）、`hfl/chinese-bert-wwm-ext`、`hfl/chinese-roberta-wwm-ext`、`roberta-base`、`albert-base-v2`、`distilbert-base-uncased` 等。  
  - 前端「创建训练任务」表单中有「预训练底模」下拉；Agent 流水线默认使用 `bert-base-uncased`，可在前端常量或流水线请求中改为其他 id。
- **多模态底模**：  
  - 如 `openai/clip-vit-base-patch32`、`Salesforce/blip-itm-base-coco` 等已在底模列表中预留；多模态训练需要**图像+文本**数据格式与专用训练/评估脚本，当前流程仍为「仅文本」分类，多模态为后续扩展预留。
- **评估时**：  
  - 评估脚本从保存的模型目录加载模型与 tokenizer；若目录内无 tokenizer，会读取训练时写入的 `training_config.json` 中的 `base_model` 回退加载对应 tokenizer，保证与训练一致。

### 6. 评估系统原理与「训练 → 评估」的衔接

#### 6.1 评估系统是什么原理

**评估** = 用一份**测试数据**（带真实标签的文本）去跑**已训练好的模型**，看预测和真实标签有多一致，并算出准确率、精确率、召回率、F1、ROC AUC 等指标，同时生成混淆矩阵图、ROC 曲线和一份 HTML 报告。

- **输入**：  
  - **模型**：来自某次训练完成后写入 `models` 表的记录（`model_id` 对应一条模型，其 `model_path` 指向磁盘上的模型目录）。  
  - **测试数据**：来自「数据集管理」里状态为 ready 的数据集（`test_dataset_id`），用其 `cleaned_file_path` 指向的 CSV；该 CSV 需包含 `text` 和 `label` 两列，格式与训练时一致。
- **过程**：  
  - 后端 `EvaluationAgent.Evaluate(modelID, testDatasetID)` 调 Python 脚本 `evaluate_model.py`。  
  - 脚本从 `model_path` 加载 BERT 分类模型和 tokenizer，对测试集每条文本做预测，与真实标签对比，用 sklearn 算上述指标，并画混淆矩阵、ROC 曲线，写 HTML 报告到 `reports/` 目录。
- **输出**：  
  - 结果写入 `evaluations` 表（accuracy、precision、recall、f1_score、roc_auc、报告路径等）；  
  - 前端「评估平台」可查看评估列表、点「查看进度」了解当前阶段、点「预览报告」在弹窗内直接查看 HTML、点「下载报告」保存报告文件。

所以：**评估不参与训练过程**，只消费「训练产出的模型文件」+「你指定的一份测试数据」，是一次独立的离线评测。

#### 6.2 训练过程控制台/日志数据能否结合？有用吗？

- **当前实现**：  
  - 训练时产生的**过程数据**有两类：  
    1. **实时控制台输出**：`train_text_clf.py` 打印的 `LOG:`（如「正在加载数据集…」）和 `PROGRESS:`（epoch、loss、step、learning_rate 等），通过 Go 写 Redis、推 WebSocket，供前端「训练进度」弹窗展示。  
    2. **按 epoch 落库**：每个 epoch 结束时写入 `training_logs` 表（job_id、epoch、loss、accuracy、learning_rate），可通过 `GET /training/jobs/:id/logs` 拉取。  
  - **评估脚本**目前**没有**使用上述任何一项；它只用「保存好的最终模型」+「测试集 CSV」跑一遍推理和指标计算。
- **能否结合、有没有用**：  
  - **可以结合**：例如在评估报告或「模型详情」里增加一节「训练曲线」，用 `training_logs` 或 Redis 里曾存的 PROGRESS 数据画 loss/accuracy 随 epoch 变化图，方便对比不同任务或判断是否过拟合。  
  - **有用**：训练曲线能帮助零基础用户理解「训练是否在变好、是否已经收敛」；和评估指标（准确率、F1 等）一起看，能更全面判断模型质量。  
  - 若要做「结合」：可在前端评估详情或模型详情页请求 `GET /training/jobs/:id/logs`（通过 model → job_id 反查），用返回的 epoch/loss/accuracy 画图；或在生成评估 HTML 报告时由后端/脚本读 `training_logs` 生成「训练过程」小节。

#### 6.3 训练完成后如何进入评估？原理是什么

1. **训练完成时**：  
   - `TrainingAgent.Train` 在 Python 训练脚本正常结束后，会收到 `model_path`（例如 `./data/models/job_5`）。  
   - Go 会往 `models` 表插入一条记录：`job_id` = 该训练任务 ID，`model_path` = 上述路径，并更新该任务的 `training_jobs.status = 'completed'`。
2. **模型从哪来**：  
   - 「模型管理」页的列表来自 `models` 表；每一条对应一次**已完成**的训练任务产出的模型，所以**当前正在训练的任务只有在状态变为「已完成」后，才会在模型表里出现一条新记录**。
3. **如何进入评估环节**：  
   - 用户打开「评估平台」→ 点「创建评估任务」→ 选择**模型 ID**（即上一步在「模型管理」里能看到的那条模型的 ID）和**测试数据集 ID**（可选；不选则后端会用该模型对应训练任务所用的数据集作为测试集）。  
   - 提交后，后端异步执行 `EvaluationAgent.Evaluate(modelID, testDatasetID)`，用该模型的 `model_path` 和所选数据集的 `cleaned_file_path` 调 `evaluate_model.py`，算指标、写报告、写 `evaluations` 表。
4. **小结**：  
   - **训练完成** → 自动写入一条 `models` 记录（并可在「模型管理」看到）。  
   - **进入评估** = 在「评估平台」创建评估任务时，选择这条新模型的 ID（以及可选的一个测试数据集）；评估不依赖训练时的控制台输出，只依赖「已保存的模型文件」和「测试集 CSV」。

#### 6.4 模型评估：指标与图表解读（零基础可读）

本小节整理本项目中用到的**评估指标**和**图表**的含义，便于阅读评估报告和判断模型好坏。

##### 一、核心指标（本项目中均为二分类）

| 指标 | 含义（人话） | 计算方式（本项目） |
|------|--------------|--------------------|
| **准确率 (Accuracy)** | 预测正确的样本占总样本的比例，最直观的「整体对了多少」。 | 正确预测数 / 总样本数。 |
| **精确率 (Precision)** | 模型预测为「正」的样本里，真正为正的比例；高精确率 = 少误报（少把负的判成正的）。 | 真正例 (TP) / (TP + 假正例 FP)。 |
| **召回率 (Recall)** | 真实为正的样本里，被模型正确找出的比例；高召回率 = 少漏报（少把正的漏掉）。 | 真正例 (TP) / (TP + 假负例 FN)。 |
| **F1 分数 (F1-Score)** | 精确率和召回率的调和平均，在「误报」和「漏报」之间做平衡；单一数字综合看两者。 | 2 × (精确率 × 召回率) / (精确率 + 召回率)。 |
| **ROC AUC** | 模型区分「正 / 负」样本的能力；0.5 表示和随机猜一样，越接近 1 越好。 | 二分类下用正类概率算 ROC 曲线下面积；本项目用 `sklearn.roc_auc_score`。 |

- 本项目使用 **sklearn** 的 `accuracy_score`、`precision_recall_fscore_support(average="binary")`、`roc_auc_score` 等，在 `evaluate_model.py` 中对测试集逐条预测后统一计算。
- 报告中的「简要结论」会根据准确率与 F1 自动给出一句总结（表现较好 / 有提升空间 / 建议检查数据与调参），方便零基础用户先看结论。

##### 二、混淆矩阵 (Confusion Matrix)

- **是什么**：一张表格（或热力图），按「真实标签」和「预测标签」把样本分成四类。
- **四格含义（二分类，正/负）**：
  - **左上**：真实为负、预测为负（真负例 TN）。
  - **右上**：真实为负、预测为正（假正例 FP，误报）。
  - **左下**：真实为正、预测为负（假负例 FN，漏报）。
  - **右下**：真实为正、预测为正（真正例 TP）。
- **如何看**：对角线（左上 + 右下）上的数字越大越好，表示预测和真实一致；右上、左下的数字越大，说明误报或漏报越多。
- **本项目的图**：纵轴为「真实标签 True」，横轴为「预测标签 Predicted」，刻度为「负类 (0)」「正类 (1)」，格内标出样本数；便于零基础用户对应到上述四格理解。

##### 三、ROC 曲线与 AUC

- **是什么**：横轴是「假正率 FPR」（负样本里被误判为正的比例），纵轴是「真正率 TPR」（正样本里被正确找出的比例）；曲线表示模型在不同判定阈值下的表现。
- **如何看**：曲线越**靠近左上角**（FPR 小、TPR 大）越好；**AUC = 0.5** 表示和随机猜一样（对角线），**AUC 越接近 1** 表示区分能力越强。
- **本项目的图**：标题为「ROC 曲线」，副标题说明「越靠近左上角、AUC 越接近 1 表示模型越好」；图中虚线为随机猜测参考线，橙色曲线为本模型，图例中给出 AUC 数值。

##### 四、本项目评估流程与报告结构

- **流程**：用户创建评估任务 → 后端异步执行 `EvaluationAgent.Evaluate` → 调 Python `evaluate_model.py`：加载模型与测试集 → 逐条预测 → 用 sklearn 算指标 → 画混淆矩阵与 ROC 图 → 生成 HTML 报告并写入 `reports/` → 更新 `evaluations` 表（accuracy、precision、recall、f1_score、report_path 等）。
- **报告内容**：顶部为报告 ID；接着为「核心指标」表格 + 「指标说明」科普文案；然后为「混淆矩阵」「ROC 曲线」两节，每节配简短解读。支持在评估列表中点「预览报告」弹窗内嵌展示，或「下载报告」保存 HTML。
- **技术点**：脚本支持测试集为 CSV 或 JSON；自动识别文本列（如 text、content、instruction、input）和标签列（label、labels、output），并将标签统一为 0/1 后计算二分类指标。

##### 五、评估状态与数据库兼容

- **状态推断**：若数据库未执行迁移 006/007（无 `status`、`error_message`、`name` 列），后端在查询评估列表或单条时不会读这些列，而是根据**是否有报告路径**推断状态：`report_path` 非空视为「已完成」，为空视为「失败」并设置错误信息为「未生成报告或评估异常」。这样既能兼容旧库，也能避免「准确率为 0 却显示已完成」的误导。
- **有 006/007 时**：可正常读写 `status`（running / completed / failed / cancelled）、`error_message`、`name`，用于进度展示、中止与删除等；报告预览使用 `GET /reports/preview/:id` 返回 `Content-Disposition: inline`，便于 iframe 内嵌展示。

#### 6.5 创建评估任务成功要点与常见失败原因

- **如何创建才能成功**：  
  1. **模型**：必须选择「模型管理」中已训练完成的模型；模型目录（如 `data/models/job_*`）需存在。  
  2. **测试集**：推荐在创建评估时**显式选择**一份「测试数据集」下拉框中的、状态为「就绪」的数据集；若留空，后端会尝试使用该模型对应训练任务当时使用的数据集（若该数据集已被删除则会失败）。  
  3. **测试集格式**：须包含一列**文本**（列名为 text、content、review、sentence、comment、instruction、input 之一）和一列**标签**（列名为 label、labels 或 output），标签为 0/1 或可识别的二分类；文件为 CSV 或 JSON，且数据集状态为 ready。

- **常见失败原因**：  
  - **未指定测试集且训练数据集已删除**：创建时未选测试集，且该模型对应训练任务的 `dataset_id` 已因删除数据集被置为 NULL → 后端返回明确提示「请先在数据集管理中准备一份测试集，在创建评估时选择该测试集」。  
  - **测试集未就绪**：所选测试集无 `cleaned_file_path` 或状态非 ready → 提示「测试集尚未就绪」。  
  - **脚本/环境**：Python 未安装或依赖缺失、测试集缺列、模型路径不存在等 → 失败原因会写入 `evaluations.error_message`，前端「评估详情」弹窗中可查看「失败原因洞察」与原始输出。  

- **前端**：在「模型评估管理」卡片标题旁提供「如何创建评估任务」说明入口（问号图标），点击可查看创建步骤、对模型与测试集的要求及如何选择测试集。

---

## 四、按「一条请求」跟代码（推荐）

选一条你关心的请求，从路由跟到 DB/脚本，整条链走通。

### 例 1：上传数据集

1. **路由**：`main.go` 里 `POST /datasets/upload` → `datasetHandler.UploadDataset`
2. **Handler**：`internal/handlers/dataset_handler.go`  
   收文件、校验、存到 `uploadDir`、写 `datasets` 表、**异步**调 `dataAgent.CleanData(dataset.ID)`
3. **Agent**：`internal/agents/data_agent.go` 的 `CleanData`  
   查 `original_file_path`，调 `executor.Execute("data/clean_data.py", filePath)`
4. **Python**：`python_scripts/data/clean_data.py`  
   读 CSV、去重去空、写 `*_cleaned.csv`，stdout 打 JSON，Go 解析后更新 `cleaned_file_path`、`row_count`、`status=ready`

### 例 2：创建训练任务 + 看进度

1. **创建任务**：`POST /training/jobs` → `training_handler.CreateJob` → 写 `training_jobs`，`go func(){ trainingAgent.Train(job.ID) }()`
2. **训练**：`internal/agents/training_agent.go` 的 `Train`  
   查 job、查数据集路径、起子进程跑 `train_text_clf.py`，从 stdout 解析 `PROGRESS:` 行 → 写 Redis + 更新 DB，结束时写 `training_logs`、`models`
3. **进度**：前端轮询 `GET /training/jobs/:id`，或连 WebSocket `ws://.../ws/training/:id`（服务端从 Redis 订阅同名的 channel 推给浏览器）

### 例 3：评估 + 下载报告

1. **创建评估**：`POST /evaluations` → 异步 `evalAgent.Evaluate(modelID, testDatasetID)`  
   Agent 调 `evaluate_model.py`，脚本算指标、画混淆矩阵和 ROC、生成 HTML，返回路径；Go 写 `evaluations` 表（含 `report_path`）
2. **下载报告**：`GET /reports/download/:id` → 查 `evaluations` 取 `report_path`，用 `reportDir + basename` 读文件并返回

### 例 4：重试清洗（error 数据集再洗一遍）

1. **触发**：数据集列表里仅当 `status === 'error'` 时显示「重试清洗」按钮；点击后 `datasetService.retryClean(record.id)` → `POST /api/v1/datasets/:id/retry-clean`。
2. **路由**：`main.go` 中 `api.POST("/datasets/:id/retry-clean", datasetHandler.RetryCleanDataset)`。
3. **Handler**（`dataset_handler.go` 的 `RetryCleanDataset`）：
   - 校验：数据集存在、`status == "error"`、`original_file_path` 非空。
   - 先执行 `UPDATE datasets SET status = 'processing', error_message = NULL WHERE id = $1`。
   - 使用 `go func() { dataAgent.CleanData(datasetID) }()` 异步再跑一次清洗，接口立即返回 200。
4. **执行**：与「例 1」相同——`DataAgent.CleanData` 查 `original_file_path`，调 `clean_data.py` 读原文件、去重去空、写 `*_cleaned.csv`，根据脚本返回更新 `cleaned_file_path`、`row_count`、`column_count`、`status='ready'`，或再次 `status='error'` + `error_message`。

**小结**：重试清洗 = 对已有 error 记录再执行一次同样的清洗流程（同一份原始文件 + 同一套 Python 脚本 + 同一套 DB 更新），无需重新上传或导入。

---

## 五、目录与文件速查

```
cmd/server/main.go            # 入口：配置、DB、Redis、路由、WebSocket
internal/
  config/config.go            # 环境变量 / 配置
  database/                   # Postgres、Redis 连接
  models/                     # 表对应结构体 + CRUD（dataset, job, model, evaluation, training_log）
  handlers/                   # HTTP：dataset, training, evaluation, model, ws
  agents/                     # 业务：data_agent, training_agent, evaluation_agent
  mcp/                        # 消息结构与协调（message, coordinator）
  utils/                      # Python 执行器、文件、URL 抓取、日志
python_scripts/
  data/clean_data.py          # 清洗
  data/analyze_data.py        # 分析
  training/train_text_clf.py  # BERT 文本分类训练
  evaluation/evaluate_model.py # 评估 + 混淆矩阵 + ROC + HTML 报告
frontend/src/
  pages/                      # Dashboard, Dataset, Training, Model, Evaluation
  services/                   # 各模块 API 封装
  types/                      # TS 类型
```

---

## 六、怎么跑、怎么调试

### 跑起来

```bash
docker-compose up -d
# 初始化 DB：psql -h localhost -U mcp_user -d mcp_training -f internal/database/migrations/001_init.sql
cp .env.example .env
go run cmd/server/main.go
cd frontend && npm i && npm run dev
```

### 调试建议

- **Go**：在 Handler/Agent 里打断点，看请求参数、DB 查询结果、调用 Python 的入参和返回。
- **Python**：直接 `python python_scripts/data/clean_data.py /path/to/file.csv` 看 stdout；或脚本里加 `print(json.dumps(...))` 和 Go 对齐。
- **Redis**：训练时用 `redis-cli` 看 `training:progress:<job_id>`、`training:progress:<job_id>` 的 pub/sub，确认 WebSocket 能收到同样数据。

### 容易晕的点

- **异步**：上传/创建任务后，清洗、训练、评估都在 `go func()` 里跑，所以接口先返回，状态要轮询或 WebSocket 看。
- **数据集 error**：若因 Python/pandas 未装或编码问题导致清洗失败，修好环境后无需重新上传，在列表里对该条点「重试清洗」即可再次跑 `CleanData`（见上文例 4）。
- **路径**：`original_file_path` / `cleaned_file_path` / `model_path` 多为相对路径（如 `./data/uploads/...`），当前工作目录一般是项目根目录；报告下载用 `reportDir + filepath.Base(report_path)` 拼绝对路径。

#### 「从磁盘恢复」是什么、为何会多出很多数据集

- **入口**：仪表盘或相关页的「从磁盘恢复」按钮调用 `POST /sync-from-disk`，会扫描 **data/uploads** 下所有 `.csv` / `.json` / `.tsv` **文件**（不含子目录），为**尚未在数据库中记录**的每个文件创建一条数据集记录（status=ready）。
- **那 40 条从哪来**：说明 data/uploads 目录下有 40 个此类文件（可能是历史上传、测试文件、或临时文件）。每条记录的名称默认取**文件名**；若系统检测到文件名疑似乱码（编码异常、控制字符等），会改用「恢复_dataset.csv」等安全名称。
- **如何清理**：在「数据集管理」中可：① 勾选多条记录后点击「批量删除选中」删除不需要的；② 对名称异常或乱码的条目可点「重命名」改为可读名称，或直接删除。删除仅移除数据库记录，**不会**删除 data/uploads 里的物理文件；若再次点「从磁盘恢复」，已删记录可能再次被恢复（因文件仍在）。若希望不再恢复某批文件，可从磁盘删除或移走 data/uploads 下对应文件后再点恢复。
- **模型格式**：训练保存的是目录（Transformers），下载时用 zip 打包；若以后改成单文件 .pth，下载逻辑已支持单文件直接返回。

---

## 七、技术栈速查（Go / Redis / Postgres / 前端）

### 1. Go（后端）

- **框架**：Gin（`github.com/gin-gonic/gin`），负责 HTTP 路由、中间件和响应。
- **结构**：
  - `cmd/server/main.go`：入口，加载 `.env` → 连接 Postgres / Redis → 初始化 PythonExecutor / Agents / Handlers → 注册路由。
  - `internal/handlers`：每个模块一组 Handler，只做「收参数 + 调 Agent + 返回 JSON」。
  - `internal/agents`：真正的业务逻辑和编排，调用 `utils.PythonExecutor` 跑脚本。
  - `internal/models`：表结构 + CRUD。
- **与 Python 交互**：
  - 用 `exec.Command` 或 `PythonExecutor.Execute` 启动脚本。
  - Python 用 `print(json.dumps(...))` 把结果写到 stdout，Go 解析为 `map[string]interface{}`。

### 2. Redis（训练进度和 Pub/Sub）

- 连接在 `internal/database/redis.go`（通过 `NewRedisClient`）。
- 使用场景：
  - `TrainingAgent.Train` 在解析 `PROGRESS:` 行时：
    - `HSet("training:progress:<job_id>", progress)`：存当前进度，供轮询接口 `GetProgress` 使用。
    - `Publish("training:progress:<job_id>", jsonStr)`：推给 WebSocket 订阅者。
  - WebSocket Handler（`internal/handlers/ws_handler.go`）：
    - 订阅同一个 channel，把收到的消息直接写到浏览器的 WebSocket 连接。

### 3. PostgreSQL（业务数据）

- 连接在 `internal/database/postgres.go`，连接参数从 `.env` 读（`DB_HOST/PORT/USER/PASSWORD/DB_NAME`）。
- 表结构见 `internal/database/migrations/001_init.sql`：
  - `users`、`datasets`、`training_jobs`、`models`、`training_logs`、`evaluations`。
- 外键关系：
  - `datasets.user_id` → `users.id`
  - `training_jobs.user_id` → `users.id`
  - `training_jobs.dataset_id` → `datasets.id`
  - `models.job_id` → `training_jobs.id`
  - `evaluations.model_id` → `models.id`
- 默认用户：
  - `002_seed_default_user.sql` 会插入 `id = 1` 的用户，方便所有默认数据（目前 Go 代码里都用 `UserID: 1`）。

### 4. 前端（React + Ant Design + Vite）

- **框架**：
  - React 18（函数组件 + Hooks）。
  - React Router v6（`frontend/src/App.tsx` + `routes`）。
  - UI：Ant Design 5（`Card/Table/Button/Form/Modal/Menu` 等）。
  - 构建：Vite（`frontend/vite.config.ts`，含 `/api` 代理和 `/ws` WebSocket 代理）。
- **页面结构**（`frontend/src/pages`）：
  - `Dashboard`：工作台/仪表盘；定位与改造说明见 `docs/DASHBOARD_PRODUCT.md`。
  - `Dataset`：数据集管理（上传 / URL 导入 / 在线数据集导入 / 预览）。
  - `Training`：训练任务列表 + 创建任务 + 实时进度（含 WebSocket）。
  - `Model`：模型管理（列表 + 下载）。
  - `Evaluation`：评估记录 + 创建评估 + 下载报告。
- **布局**（`frontend/src/components/Layout`）：
  - 左侧 Sider 菜单（可折叠成仅 icon），右侧 Content。
  - 底部有深浅色主题切换（使用 AntD `ConfigProvider` + `theme.defaultAlgorithm/darkAlgorithm`）。

---

## 八、运维小抄：什么时候要重启 / 迁移

### 1. 什么时候要重启 Go 后端

- ✅ **要重启**：
  - 改了任何 Go 代码：`internal/*`、`cmd/server/main.go`、路由、Handler、Agent、Model、Middleware 等。
  - 改了 `.env`（端口、DB 配置、存储路径、Python 路径等）。
- ❌ **不用重启**：
  - 只改前端（`frontend/`）。
  - 只改 Python 脚本（`python_scripts/`），因为是子进程，每次都会重新拉起。

> 实操：终端里 Ctrl+C 停掉 `go run cmd/server/main.go`，再执行一次 `go run cmd/server/main.go` 即可。

### 2. 什么时候需要执行数据库迁移（.sql）

- **首次初始化**：
  - `001_init.sql`：建表和索引。
  - `002_seed_default_user.sql`：插入默认 `users.id = 1`，避免 `datasets_user_id_fkey` 这类外键错误。
- **以后新增表或字段**：
  - 新增 `003_xxx.sql` 之类迁移时，只需要执行**新加的迁移**，不要重复跑旧的。
- **不需要迁移的情况**：
  - 只改业务逻辑、路由、前端、Python，但不改表结构。

#### 2.1 数据库迁移是什么、会不会跟着数据库、什么时候需要重新执行

**迁移（migration）** = 一段 SQL，用来**改表结构**（加列、改约束等）。执行一次后，**改动会永久保存在当前这个数据库里**，不会因为重启应用或重启 Docker 而消失。

- **「这些更改会跟着数据库吗？」**  
  会。迁移改的是**数据库本身**（PostgreSQL 里的表结构、数据）。只要不删库、不换库，这些列和约束会一直在。

- **「每次都要执行这些语句吗？」**  
  **不用每次**。每条迁移在**同一个数据库上只需执行一次**。执行过一次 006、007 后，`evaluations` 表里已经有 `status`、`error_message`、`name` 列了，不用再跑。

- **什么时候需要执行 / 重新执行？**
  - **新库**：新建了一个数据库（例如新电脑克隆项目、新环境 `docker-compose up` 建了新的 Postgres 卷），需要按顺序执行从 001 到你用到的所有迁移。
  - **旧库升级**：以前只跑过 001～003，现在代码用到了评估状态、数据集用途等，就需要**补跑** 006、007、008、009，每个**只跑一次**即可。
  - **同一条迁移对同一库重复执行**：本项目的迁移用了 `ADD COLUMN IF NOT EXISTS` 等，**重复执行不会报错**，也不会重复加列；但正常使用下没必要重复执行。

- **那条命令在干什么？**  
  `Get-Content internal/database/migrations/006_add_evaluation_status.sql | docker exec -i postgres-mcp-training psql -U mcp_user -d mcp_training`  
  - `Get-Content ...`：读出 006 这个 SQL 文件的内容。  
  - `| docker exec -i postgres-mcp-training psql ...`：把内容通过管道传给**正在运行的 Postgres 容器**里的 `psql`，在 `mcp_training` 库里执行这段 SQL。  
  也就是：**把本地的 006.sql 在 Docker 里的数据库上执行一遍**，执行完，库里就多了对应列，以后不用再执行这条。

#### 2.2 本项目的迁移清单（按顺序）

| 迁移文件 | 作用 | 何时需要执行 |
|----------|------|--------------|
| `001_init.sql` | 建表（datasets, training_jobs, models, evaluations 等） | 全新库第一次初始化 |
| `002_seed_default_user.sql` | 插入默认用户 id=1（若仍用 users 表） | 依赖 users 时首次初始化 |
| `003_add_job_name.sql` | 训练任务表增加 `name` 列 | 旧库未加过时执行一次 |
| `005_remove_users.sql` | 移除 users 相关（若项目已不用用户表） | 仅旧库曾建过 users 时按需执行 |
| `006_add_evaluation_status.sql` | evaluations 表增加 `status`、`error_message` | 要用「评估中/失败/原因」时执行一次 |
| `007_add_evaluation_name.sql` | evaluations 表增加 `name` | 要用评估任务名称列时执行一次 |
| `008_add_dataset_usage.sql` | datasets 表增加 `usage`（训练/测试集区分） | 要用训练集/测试集分离时执行一次 |
| `009_dataset_delete_set_null.sql` | 删除数据集时训练任务不级联删除，仅置空 dataset_id | 要保留已删数据集对应的任务与模型时执行一次 |
| `010_create_pipeline_instances.sql` | 2.0 流水线实例表（session_id、job_id、model_id、eval_id 等） | 使用 Agent 版「一键流水线」或「流水线历史」前执行一次 |

执行过一次后，**这些更改会一直跟着这个数据库**；只有换新库或新环境时，才需要重新按顺序执行对应的迁移。

#### 2.3 2.0 转型检查（流水线与双版本）

- **双版本**：侧栏底部可切换「经典版 / 手动版」与「Agent 版」；两版共用同一 DB，数据互通。
- **一键流水线**：Agent 版画布选择数据集后「启动 Agent 流水线」，由编排层经 MCP 消息依次执行清洗 → 训练 → 评估。
- **流水线历史**：经典版侧栏「流水线历史」可查看所有流水线实例（会话、状态、job_id、model_id、eval_id）；需先执行迁移 `010_create_pipeline_instances.sql`。
- **训练 ↔ 模型 ↔ 评估**：训练任务列表有「模型」列与「创建评估」快捷入口；从训练页点「创建评估」会跳转评估页并自动打开创建弹窗且预填该模型。

### 3. 推荐命令（按当前 `.env`：root/5433）

在项目根目录，初始化 + seed 一次：

```bash
psql -h localhost -p 5433 -U root -d mcp_training -f internal/database/migrations/001_init.sql
psql -h localhost -p 5433 -U root -d mcp_training -f internal/database/migrations/002_seed_default_user.sql
```

使用 Docker 时（PowerShell），例如执行 006、007：

```powershell
Get-Content internal/database/migrations/006_add_evaluation_status.sql | docker exec -i postgres-mcp-training psql -U mcp_user -d mcp_training
Get-Content internal/database/migrations/007_add_evaluation_name.sql | docker exec -i postgres-mcp-training psql -U mcp_user -d mcp_training
```

---

## 九、接下来可以做什么

- **讲清楚**：用「数据流」那一段 + 一个你跟过的请求（如上传数据集）给同学/老师讲一遍。
- **改小功能**：例如改前端文案、给某个 API 加一个查询参数、在评估脚本里多算一个指标。
- **读 PRD 非功能**：错误重试、单元测试、日志规范，按 PRD 和 README 里的文档慢慢补。

有问题随时查 `docs/API.md`、`PRD.md` 和本文件；改代码前先确定「这条请求」的完整链路，再动对应层（Handler → Agent → Python）。

---

## 十、Git：rebase、分支与从历史中移除不需要的文件

本节整理「改写提交历史、去掉误提交的大文件」时用到的 Git 知识，便于以后查阅和操作。

### 1. 基本概念

- **分支**：本质是指向某次提交的指针。`main` 指向当前分支最新提交；`origin/main` 是上次从远程拉取时远程 `main` 的位置。
- **提交历史**：一串按时间顺序排列的提交；每次提交有唯一 hash，包含「改了什么文件」和「父提交」。
- **改写历史**：rebase、amend、filter-branch 等会生成新的提交 hash，历史线会变；若已推送到远程，需要**强制推送**才能更新远程。

### 2. 什么时候用 rebase

- **整理本地提交**：把多个小提交合并、改提交信息、调顺序。
- **从某次提交里删掉不该提交的文件**：例如某次 commit 误把 `data/`、`results/` 等大文件加进去了，希望从**那一次提交**起就不再包含这些文件，让后续 push 变快、仓库变小。

注意：rebase 会改写历史，只适合在**尚未推送**或**确定可以强制推送**的分支上做；多人协作分支要慎用。

### 3. 交互式 rebase（`git rebase -i <父提交>`）

命令形式：

```bash
git rebase -i <commit-hash>
```

会列出「从 `<commit-hash>` 之后到当前 HEAD」的所有提交，在编辑器里可以对每一行做：

| 命令 | 含义 |
|------|------|
| `pick` | 保留该提交，不修改 |
| `edit` | 停在该提交上，改完再 `git rebase --continue` |
| `reword` | 保留改动，只改提交信息 |
| `drop` | 丢弃该提交 |
| `squash` | 与上一个提交合并 |

常用流程：把某一行从 `pick` 改成 `edit` → 保存关闭 → Git 停在那次提交 → 你修改工作区或暂存区 → `git commit --amend` → `git rebase --continue`。

### 4. 从「某一次提交」里移除已跟踪的大文件/目录

目标：历史中**某一次提交**误加了 `data/`、`results/` 等，希望从那一次起这些路径就不再出现在 Git 历史里。

#### 4.1 思路

- 用 `git rebase -i` 在**误提交的那次**上选 `edit`。
- 停在那次提交时，用 `git rm -r --cached <路径>` 只从**索引（暂存区）**里删掉这些路径，不删本地文件。
- 用 `git commit --amend --no-edit` 把「删除这些路径」写进当前这次提交。
- `git rebase --continue` 让后面的提交依次重放；若后面某次变成空提交，可用 `git rebase --skip`。

这样，**该提交及之后**的历史里都不再包含这些文件，push 时就不会再上传它们。

#### 4.2 具体步骤（示例：从 46001dd 里移除 data/ 和 results/）

1. **确认要改的提交的父提交**  
   例如要改的提交是 `46001dd`，其父提交是 `c0c8e7e`（first commit）。

2. **避免「未跟踪文件被覆盖」**  
   若工作区有未跟踪的 `data/`、`results/`、`logs/`，rebase 在切到旧提交时可能报错：  
   `The following untracked working tree files would be overwritten by checkout`  
   解决：先把这些目录临时移走，rebase 完成再移回。

   ```powershell
   Move-Item -Path data -Destination ../data.bak -Force
   Move-Item -Path results -Destination ../results.bak -Force
   Move-Item -Path logs -Destination ../logs.bak -Force
   ```

3. **开始交互式 rebase**

   ```bash
   git rebase -i c0c8e7e
   ```

   在编辑器里把 **46001dd** 那一行的 `pick` 改成 **`edit`**，保存并关闭。

4. **停在那次提交时，从索引移除目录并修正该提交**

   ```bash
   git rm -r --cached data/
   git rm -r --cached results/
   git commit --amend --no-edit
   git rebase --continue
   ```

   若后续停在「chore: 不再跟踪 data/」且提示无改动（因为前面已经删掉了），可执行：

   ```bash
   git rebase --skip
   ```

   然后继续 `git rebase --continue` 直到完成。

5. **把临时移走的目录移回**

   ```powershell
   Move-Item -Path ../data.bak -Destination data -Force
   Move-Item -Path ../results.bak -Destination results -Force
   Move-Item -Path ../logs.bak -Destination logs -Force
   ```

6. **强制推送**（历史已改写，必须 force）

   ```bash
   git push --force-with-lease
   ```

   `--force-with-lease` 比 `--force` 更安全：若期间有人先 push 了同一分支，会拒绝覆盖，避免丢别人的提交。

### 5. 只「从当前起不再跟踪」、不改写历史

若不想动历史，只希望**以后**不再把 `data/`、`results/` 纳入提交：

1. 在 `.gitignore` 里加上（示例）：

   ```
   /data
   data/
   results/
   *.safetensors
   *.pt
   *.pth
   *.bin
   ```

2. 从当前索引里移除（不删本地文件）：

   ```bash
   git rm -r --cached data/
   git rm -r --cached results/
   ```

3. 提交这次「停止跟踪」的改动：

   ```bash
   git add .
   git commit -m "chore: 不再跟踪 data/、results/"
   ```

这样历史里**过去**的提交仍然包含大文件，push 已推送过的分支时仍可能很慢；要彻底让仓库变小，需要像上一节那样用 rebase 从历史里移除。

### 6. rebase 进行中 / 卡住时

- **正在 rebase、想继续**：  
  - 改完当前提交后：`git rebase --continue`  
  - 当前提交想跳过（例如变成空提交）：`git rebase --skip`  
  - 想放弃这次 rebase，回到 rebase 之前的状态：`git rebase --abort`

- **`git rebase --abort` 报错**：  
  若提示「untracked working tree files would be overwritten by reset」，说明工作区有未跟踪文件会被重置覆盖。先把该文件或目录临时移走，再执行 `git rebase --abort`，成功后再移回。

- **提示已有 rebase 在进行**：  
  `fatal: It seems that there is already a rebase-merge directory...`  
  先决定是继续还是放弃：  
  - 继续：`git rebase --continue`（或先做完当前步骤再 continue）  
  - 放弃：先移开冲突的未跟踪文件（若有），再 `git rebase --abort`  
  不要在不了解的情况下手动删 `.git/rebase-merge`，以免状态错乱。

### 7. 多分支时的注意点

- **只改当前分支**：`git rebase -i` 只影响当前分支上的提交；其他分支不受影响，直到你合并或再 rebase 它们。
- **改过历史后**：同一分支在远程需要 `git push --force-with-lease`；别人若已经基于旧历史做了提交，需要他们用 `git pull --rebase` 或根据你的新历史重新整理自己的提交。
- **origin/main 与本地 main**：`Your branch is ahead of 'origin/main' by N commits` 表示本地有 N 个提交还没 push；改过历史后，这 N 个提交的 hash 可能都变了，推送时要用 force-with-lease。

### 8. 小结命令速查

| 目的 | 命令 |
|------|------|
| 从某次提交起移除目录（需先移走工作区同名未跟踪目录） | `git rebase -i <父提交>` → 该提交改 `edit` → 停住后 `git rm -r --cached data/ results/` → `git commit --amend --no-edit` → `git rebase --continue` |
| 只从当前起不再跟踪、不删本地文件 | `git rm -r --cached data/ results/` → `git add .` → `git commit` |
| 改写历史后推送到远程 | `git push --force-with-lease` |
| 放弃正在进行的 rebase | `git rebase --abort`（若有未跟踪文件冲突，先移走再 abort） |
| 空提交时继续 rebase | `git rebase --skip` |

把以上用到的知识（rebase、处理多分支、从分支历史中移除不想要的文件）集中放在本节，便于以后在同一项目或类似场景下复现操作。
