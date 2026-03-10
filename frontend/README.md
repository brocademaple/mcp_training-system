# MCP Training System - 前端

基于 React + TypeScript + Ant Design 的现代化前端应用。

## 技术栈

- **框架**: React 18
- **语言**: TypeScript
- **UI库**: Ant Design 5
- **路由**: React Router 6
- **HTTP客户端**: Axios
- **构建工具**: Vite
- **图表**: Recharts

## 项目结构

```
frontend/
├── src/
│   ├── components/          # 公共组件
│   │   └── Layout/         # 布局组件
│   ├── pages/              # 页面组件
│   │   ├── Dashboard/      # 仪表盘
│   │   ├── Dataset/        # 数据集管理
│   │   ├── Training/       # 训练任务管理
│   │   └── Evaluation/     # 模型评估
│   ├── services/           # API服务层
│   │   ├── api.ts         # Axios配置
│   │   ├── dataset.ts     # 数据集API
│   │   ├── training.ts    # 训练API
│   │   └── evaluation.ts  # 评估API
│   ├── types/             # TypeScript类型定义
│   ├── App.tsx            # 根组件
│   ├── main.tsx           # 入口文件
│   └── index.css          # 全局样式
├── index.html             # HTML模板
├── package.json           # 依赖配置
├── tsconfig.json          # TypeScript配置
└── vite.config.ts         # Vite配置
```

## 快速开始

### 1. 安装依赖

```bash
cd frontend
npm install
```

### 2. 启动开发服务器

```bash
npm run dev
```

前端将在 `http://localhost:3000` 启动

### 3. 构建生产版本

```bash
npm run build
```

构建产物将输出到 `dist/` 目录

## 功能模块

### 1. 仪表盘 (Dashboard)
- 显示系统概览统计
- 数据集总数、就绪数量、处理中数量
- 训练任务统计
- 最近数据集列表

### 2. 数据集管理 (Dataset Management)
- 上传CSV数据集
- 查看数据集列表
- 实时显示数据集状态（上传中、处理中、就绪、错误）
- 显示数据集详细信息（行数、列数、文件大小）

### 3. 训练任务管理 (Training Management)
- 创建训练任务
- 选择数据集和模型类型
- 配置超参数（学习率、批次大小、训练轮数）
- 查看训练任务列表
- 实时显示训练进度和状态

### 4. 模型评估 (Evaluation)
- 创建评估任务
- 查看评估结果
- 显示准确率、精确率、召回率、F1分数
- 查看详细评估报告

## API接口

前端通过代理访问后端API，配置在 `vite.config.ts` 中：

```typescript
proxy: {
  '/api': {
    target: 'http://localhost:8080',
    changeOrigin: true,
  },
}
```

### 主要API端点

- `POST /api/v1/datasets/upload` - 上传数据集
- `GET /api/v1/datasets` - 获取数据集列表
- `GET /api/v1/datasets/:id` - 获取数据集详情
- `POST /api/v1/training/jobs` - 创建训练任务
- `GET /api/v1/training/jobs/:id` - 获取训练任务状态
- `POST /api/v1/evaluations` - 创建评估任务
- `GET /api/v1/evaluations/:id` - 获取评估结果

## 开发说明

### 添加新页面

1. 在 `src/pages/` 创建新页面组件
2. 在 `src/App.tsx` 添加路由
3. 在 `src/components/Layout/index.tsx` 添加菜单项

### 添加新API

1. 在 `src/types/index.ts` 定义类型
2. 在 `src/services/` 创建对应的服务文件
3. 在页面组件中调用服务

### 样式定制

- 全局样式：修改 `src/index.css`
- 组件样式：在组件目录下创建 `.css` 文件
- Ant Design主题：在 `src/main.tsx` 的 `ConfigProvider` 中配置

## 注意事项

1. **后端依赖**: 前端需要后端服务运行在 `http://localhost:8080`
2. **CORS**: 后端已配置CORS中间件，允许跨域请求
3. **文件上传**: 仅支持CSV文件，最大100MB
4. **实时更新**: 部分页面需要手动刷新获取最新数据

## 常见问题

### Q: 无法连接到后端？
A: 确保后端服务已启动在 `http://localhost:8080`，检查 `vite.config.ts` 中的代理配置。

### Q: 上传文件失败？
A: 检查文件格式是否为CSV，文件大小是否超过100MB。

### Q: 页面数据不更新？
A: 点击页面上的"刷新"按钮手动刷新数据。

## 后续优化

- [ ] 添加WebSocket支持实时训练进度推送
- [ ] 添加图表可视化训练曲线
- [ ] 添加用户认证和权限管理
- [ ] 添加暗色主题支持
- [ ] 优化移动端响应式布局
