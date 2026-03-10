# MCP Training System 部署文档

## 1. 生产环境要求

### 1.1 硬件要求

**最低配置**:
- CPU: 4核
- 内存: 8GB
- 硬盘: 50GB SSD
- GPU: 可选（推荐用于训练加速）

**推荐配置**:
- CPU: 8核+
- 内存: 16GB+
- 硬盘: 100GB+ SSD
- GPU: NVIDIA GPU with CUDA support

### 1.2 软件要求

**操作系统**:
- Ubuntu 20.04+ / CentOS 8+ / macOS 12+
- Windows 10+ (开发环境)

**运行时环境**:
- Go 1.21+
- Python 3.8+
- PostgreSQL 14+
- Redis 7.0+
- Docker 20.10+ (可选)
- Docker Compose 2.0+ (可选)

### 1.3 网络要求

- 开放端口 8080 (HTTP API)
- 开放端口 5432 (PostgreSQL，仅内网)
- 开放端口 6379 (Redis，仅内网)

---

## 2. Docker 部署步骤

### 2.1 启动数据库服务

```bash
# 启动 PostgreSQL 和 Redis
docker-compose up -d

# 查看服务状态
docker-compose ps

# 查看日志
docker-compose logs -f
```

### 2.2 初始化数据库

```bash
# 方式1: 使用 psql 命令行
psql -h localhost -U mcp_user -d mcp_training -f internal/database/migrations/001_init.sql

# 方式2: 使用 Docker exec
docker exec -i postgres-mcp-training psql -U mcp_user -d mcp_training < internal/database/migrations/001_init.sql
```

### 2.3 验证数据库

```bash
# 连接数据库
psql -h localhost -U mcp_user -d mcp_training

# 查看表
\dt

# 退出
\q
```

---

## 3. 应用部署

### 3.1 安装依赖

```bash
# Go 依赖
go mod download

# Python 依赖
pip3 install -r python_scripts/requirements.txt

# 或使用虚拟环境
python3 -m venv venv
source venv/bin/activate  # Linux/Mac
# venv\Scripts\activate   # Windows
pip install -r python_scripts/requirements.txt
```

### 3.2 配置环境变量

```bash
# 复制配置文件
cp .env.example .env

# 编辑配置文件
vim .env
```

**关键配置项**:
```bash
# 服务器配置
SERVER_HOST=0.0.0.0
SERVER_PORT=8080

# 数据库配置
DB_HOST=localhost
DB_PORT=5432
DB_USER=mcp_user
DB_PASSWORD=mcp_password
DB_NAME=mcp_training

# Redis 配置
REDIS_HOST=localhost
REDIS_PORT=6379

# Python 路径
PYTHON_PATH=python3
```

### 3.3 创建必要目录

```bash
mkdir -p data/uploads data/cleaned data/models reports logs
```

### 3.4 启动服务

```bash
# 开发环境
go run cmd/server/main.go

# 生产环境（编译后运行）
go build -o mcp-server cmd/server/main.go
./mcp-server
```

### 3.5 使用 systemd 管理服务（Linux）

创建服务文件 `/etc/systemd/system/mcp-training.service`:

```ini
[Unit]
Description=MCP Training System
After=network.target postgresql.service redis.service

[Service]
Type=simple
User=mcp
WorkingDirectory=/opt/mcp-training-system
ExecStart=/opt/mcp-training-system/mcp-server
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

启动服务:
```bash
sudo systemctl daemon-reload
sudo systemctl enable mcp-training
sudo systemctl start mcp-training
sudo systemctl status mcp-training
```

---

## 4. 监控和日志

### 4.1 日志管理

**应用日志位置**:
```bash
./logs/app_YYYY-MM-DD.log
```

**查看实时日志**:
```bash
tail -f logs/app_$(date +%Y-%m-%d).log
```

**日志轮转配置** (`/etc/logrotate.d/mcp-training`):
```
/opt/mcp-training-system/logs/*.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
}
```

### 4.2 数据库监控

```bash
# PostgreSQL 连接数
psql -U mcp_user -d mcp_training -c "SELECT count(*) FROM pg_stat_activity;"

# 数据库大小
psql -U mcp_user -d mcp_training -c "SELECT pg_size_pretty(pg_database_size('mcp_training'));"
```

### 4.3 Redis 监控

```bash
# 连接 Redis
redis-cli

# 查看信息
INFO

# 查看内存使用
INFO memory

# 查看键数量
DBSIZE
```

---

## 5. 故障排查

### 5.1 常见问题

**问题1: 数据库连接失败**
```bash
# 检查 PostgreSQL 是否运行
docker ps | grep postgres

# 检查连接
psql -h localhost -U mcp_user -d mcp_training

# 解决方案: 重启数据库
docker-compose restart postgres
```

**问题2: Redis 连接失败**
```bash
# 检查 Redis 是否运行
docker ps | grep redis

# 测试连接
redis-cli ping

# 解决方案: 重启 Redis
docker-compose restart redis
```

**问题3: Python 脚本执行失败**
```bash
# 检查 Python 版本
python3 --version

# 检查依赖
pip3 list | grep torch

# 重新安装依赖
pip3 install -r python_scripts/requirements.txt
```

### 5.2 性能优化建议

1. **数据库优化**: 定期执行 VACUUM 和 ANALYZE
2. **Redis 优化**: 设置合理的内存限制和淘汰策略
3. **并发控制**: 根据硬件配置调整训练任务并发数
4. **日志管理**: 定期清理旧日志文件

---

## 6. 备份和恢复

### 6.1 数据库备份

```bash
# 备份数据库
pg_dump -h localhost -U mcp_user mcp_training > backup_$(date +%Y%m%d).sql

# 恢复数据库
psql -h localhost -U mcp_user -d mcp_training < backup_20260110.sql
```

### 6.2 文件备份

```bash
# 备份数据文件
tar -czf data_backup_$(date +%Y%m%d).tar.gz data/

# 恢复数据文件
tar -xzf data_backup_20260110.tar.gz
```
