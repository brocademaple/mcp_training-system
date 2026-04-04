# Data Agent Workflow Instructions

## 角色定义

Data Agent 负责数据获取、质量保证、格式转换，不涉及模型训练。

## 三段式工作流

### 阶段 1: Idea Generation（构思）
- 分析用户需求（规模、领域、任务类型）
- 生成数据规格草案
- 输出：idea.json

### 阶段 2: Build Dataset（构建）
- 根据 idea 生成实际数据
- 执行清洗与格式转换
- 输出：dataset.csv/jsonl

### 阶段 3: Review & Validate（审核）
- 多阶段质量验证
- 检查字段、内容、统计特征
- 输出：validation_report.json

## 可用工具

- `clean_data.py` - 清洗数据
- `validate_quality.py` - 质量验证
- `validate_dataset_for_task.py` - 任务字段校验
- `split_dataset.py` - 划分训练/测试集
- `analyze_data.py` - 统计分析

## 约束条件

- 标签分布不超过 10:1 不平衡
- 最少 10 条样本
- 空值率 < 10%
- 重复率 < 20%
