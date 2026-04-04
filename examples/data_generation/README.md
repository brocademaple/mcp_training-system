# Data Agent 三段式流程使用指南

## 快速开始

### 1. 执行数据库迁移

```bash
docker exec -i postgres-mcp-training psql -U mcp_user -d mcp_training < internal/database/migrations/014_create_data_generation_tasks.sql
```

### 2. 使用多阶段验证

```bash
python python_scripts/data/validate_quality.py data.csv Classification
```

### 3. API 调用示例

```bash
# 验证数据质量
curl -X POST http://localhost:8080/api/v1/data-agent/validate \
  -H "Content-Type: application/json" \
  -d '{"file_path": "data.csv", "task_family": "Classification"}'
```

## 验证规则

- 标签不平衡 < 10:1
- 最少样本数 >= 10
- 空值率 < 10%
- 重复率 < 20%
- 文本平均长度 >= 10

## 目录结构

```
data/
├── ideas/          # 阶段1：构思输出
├── drafts/         # 阶段2：构建草稿
└── approved/       # 阶段3：审核通过
```
