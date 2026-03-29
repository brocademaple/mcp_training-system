---
name: git-push-exclude-data
description: 将当前修改提交并推送到 Git 远程仓库，且排除 data/、模型、数据集、日志、报告、训练产物等非功能代码。在用户要求「上传到 git」「推到远程」「提交并推送」且需排除数据/模型文件时使用。
---

# Git 提交并推送（排除数据与模型）

## 何时使用

- 用户要求把当前修改「上传到 git」「推到远程」「提交到远程仓库」等。
- 需排除 `data/`、模型文件、数据集、日志、报告等非功能代码，只提交业务代码与配置。

## 排除范围（与项目 .gitignore 一致）

**不要加入暂存区、不要提交：**

- `data/`、`/data`（数据集、上传文件等）
- `模型/`
- `logs/`、`reports/`、`results/`
- `.env`
- `*.exe`、`*.zip`、`*.safetensors`、`*.pt`、`*.pth`、`*.bin`
- `.cursor/`、`.idea/`、`.vscode/`、`venv/`、`__pycache__/`
- 其他在项目根目录 `.gitignore` 中已列出的条目

提交前先查看 `git status`，仅对**未在 .gitignore 中**的修改执行 `git add`（或按下面「推荐流程」只 add 明确路径）。

## 推荐流程

1. **查看状态**：`git status`，确认有哪些修改与未跟踪文件。
2. **按路径添加**：只 add 业务代码与文档，例如：
   - `frontend/src/**`、`cmd/**`、`internal/**`、`python_scripts/**`
   - 根目录 `README.md`、`PRD.md`、`.gitignore`、配置文件（若需提交）
   - **docs/**：本仓库仅跟踪 GitHub Pages 相关文件（见 [github-upload-mcp-training-system](../github-upload-mcp-training-system/SKILL.md)），不要 `git add docs/` 整目录
   - 具体路径以本次修改为准，**不要** `git add .` 或 `git add data/`。
3. **提交**：`git commit -m "简短描述"`，可用中文；若提交信息较长，可用 `-F` 从文件读取。
4. **推送**：`git push origin <当前分支>`（多为 `main`）。

## 注意事项

- 若 `data/` 或 `模型/` 曾被打进仓库，需用 `git rm -r --cached data/`（或对应路径）从索引移除后再提交，并确保 `.gitignore` 已包含这些路径。
- 推送若因权限/网络失败，提示用户在本机执行 `git push` 并检查认证与远程地址。
