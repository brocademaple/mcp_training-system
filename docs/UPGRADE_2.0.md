# MCP Training System 2.0 升级说明

## 升级内容

本次升级实现了从1.0手动SaaS到2.0 Multi-Agent + MCP驱动系统的核心功能。

### 主要变更

#### 后端改动

1. **MCP消息扩展** (`internal/mcp/message.go`)
   - 添加 `session_id` 和 `pipeline_instance_id` 字段
   - 支持会话级别的消息追踪

2. **流水线编排** (`internal/mcp/coordinator.go`)
   - 新增 `RunPipeline()` 方法：自动执行 清洗→训练→评估 全流程
   - 新增 `GetPipelineStatus()` 方法：查询流水线执行状态
   - 异步执行流水线，支持状态实时更新

3. **数据模型** (`internal/models/pipeline.go`)
   - 新增 `PipelineInstance` 模型
   - 记录流水线执行状态、当前步骤、关联的任务/模型/评估ID

4. **API接口** (`internal/handlers/pipeline_handler.go`)
   - `POST /api/v1/pipelines` - 创建并启动流水线
   - `GET /api/v1/pipelines` - 获取流水线列表
   - `GET /api/v1/pipelines/:id` - 查询流水线状态

5. **数据库迁移** (`migrations/004_create_pipeline_instances.sql`)
   - 创建 `pipeline_instances` 表

#### 前端改动

1. **版本切换** (`frontend/src/components/Layout/index.tsx`)
   - 侧边栏底部新增版本切换开关
   - 支持"经典版"和"Agent版"切换
   - 版本偏好保存在 localStorage

2. **一键流水线页面** (`frontend/src/pages/Pipeline/index.tsx`)
   - 选择数据集后一键启动完整流水线
   - 实时展示流水线执行进度（清洗→训练→评估）
   - 流水线列表展示历史执行记录

3. **路由更新** (`frontend/src/App.tsx`)
   - 新增 `/pipeline` 路由

## 使用说明

### 1. 运行数据库迁移

```bash
# 在PostgreSQL中执行迁移脚本
psql -U postgres -d mcp_training -f migrations/004_create_pipeline_instances.sql
```

### 2. 启动后端服务

```bash
go run cmd/server/main.go
# 或使用编译后的可执行文件
./server.exe
```

### 3. 启动前端

```bash
cd frontend
npm install
npm run dev
```

### 4. 使用Agent版功能

1. 打开系统，在侧边栏底部找到版本切换开关
2. 切换到"Agent版"
3. 点击侧边栏的"一键流水线"菜单
4. 选择一个已清洗的数据集
5. 点击"启动流水线"按钮
6. 系统将自动执行：数据清洗 → 模型训练 → 模型评估
7. 在流水线列表中查看执行进度和结果

## 双版本并存

- **经典版**：保留原有的手动操作流程（数据集管理、训练任务、模型管理、评估任务）
- **Agent版**：新增一键流水线功能，自动化执行完整流程
- 两个版本共享同一数据库，数据完全互通
- 在Agent版创建的训练任务、模型、评估结果在经典版中可见可用

## 技术架构

```
前端 (React + Ant Design)
    ↓
API层 (/api/v1/pipelines)
    ↓
PipelineHandler
    ↓
MCP Coordinator (编排层)
    ↓
MCP消息驱动
    ↓
DataAgent / TrainingAgent / EvaluationAgent
    ↓
Python脚本执行 + 数据库
```

## 下一步计划 (2.0b)

- 增强会话管理和可观测性
- 流水线步骤详细日志
- 支持自定义训练配置
- Skill和Workflow模板管理
