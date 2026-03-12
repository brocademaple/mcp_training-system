# 仅提交代码（排除 data、模型等）并推送

在项目根目录执行（PowerShell 或 CMD）：

```powershell
# 1. 添加除 data、模型、日志、报告、结果以外的所有代码
git add .gitignore
git add cmd/
git add docs/
git add frontend/
git add internal/
git add python_scripts/
git add .env.example
git add docker-compose.yml
git add go.mod
git add go.sum

# 2. 查看将要提交的文件（确认没有 data/、results/、logs/、reports/）
git status

# 3. 提交
git commit -m "chore: 更新代码，排除 data 与模型等本地产物"

# 4. 推送
git push
```

当前 `.gitignore` 已忽略：`data/`、`模型/`、`results/`、`logs/`、`reports/`、`*.exe`、`*.safetensors`、`*.pt`、`*.pth`、`.cursor/` 等，使用上面命令只会添加源码与配置，不会包含训练数据与模型文件。
