---
name: github-upload-mcp-training-system
description: 将本仓库（mcp-training-system）安全提交并推送到 GitHub：排除 data/、论文与个人文档、仅放行 GitHub Pages 所需 docs 文件，并说明 Windows PowerShell、凭据与常见坑。在用户要求「上传到 GitHub」「push 到远程」「同步代码到 GitHub」时使用。
---

# MCP Training System：上传到 GitHub

## 何时使用

- 用户要把**当前项目**提交并推送到 **GitHub**（或首次关联远程后推送）。
- 需要同时满足：**不上传数据与模型**、**不把个人/论文文档推上去**、**保留 GitHub Pages 展示文件**。

## 与本仓库其他约定的关系

- 更轻量的「只排除数据再 push」说明见同目录下的 [git-push-exclude-data](../git-push-exclude-data/SKILL.md)；本技能补充 **GitHub 全流程** 与 **本仓库特有的 docs 规则**。
- `.cursor/skills/` 在根目录 [.gitignore](../../.gitignore) 中**被单独放行**（`!.cursor/skills/**`），便于把技能文档随仓库分享给协作者；`.cursor` 下其他文件仍默认不提交。

---

## 推送前必须知道的排除规则

以下路径**不应**进入提交（与根目录 [.gitignore](../../.gitignore) 一致；提交前用 `git status` 核对）：

| 类别 | 路径/模式 | 说明 |
|------|-----------|------|
| 数据与上传 | `data/`、`/data` | 数据集、用户上传文件 |
| 模型与训练产物 | `模型/`、`*.safetensors`、`*.pt`、`*.pth`、`*.bin` | 体积大且环境相关 |
| 运行输出 | `logs/`、`reports/`、`results/` | 日志与报告 |
| 密钥 | `.env` | 绝不可提交 |
| 本地 IDE | `.cursor/`、`.vscode/`、`.idea/` | 本仓库已忽略 `.cursor/` |
| **docs 其余内容** | `docs/*` 下除例外外的全部 | 见下一节 |

### docs/ 的特殊规则（GitHub Pages）

本仓库**只跟踪**用于 Pages 的静态资源，其余 `docs/` 内容（如 `thesis/`、`LEARNING.md`、各类技术 Markdown）**留在本地，不提交**。

`.gitignore` 使用「先忽略再反选」：

```gitignore
docs/*
!docs/index.html
!docs/style.css
!docs/images/
!docs/images/**
```

**Agent 操作要点：**

- 修改了 `docs/index.html`、`docs/style.css` 或 `docs/images/**` 时，需 `git add` 这些路径，线上 Pages 才会更新。
- 不要 `git add docs/` 整目录（会试图添加仍被忽略的 md；且易误加 thesis）。
- 若历史上曾把整包 `docs/` 提交过，需用 `git rm -r --cached docs/` 再按规则只加允许的文件（见「常见问题」）。

### 不要提交的杂项

- 仓库根下若出现**路径乱码的误生成文件**（例如复制路径失败产生的 `.sql`），应删除后再 `git status`，勿加入暂存区。
- 根目录 `migrations/` 若与 `internal/database/migrations/` **重复**，以 **internal/database/migrations/** 为准；不要随意把误放的根目录副本加入 Git。

---

## 推荐操作流程（在本机执行）

以下命令在**仓库根目录**执行。当前环境为 **Windows PowerShell** 时，请用 **`;` 分隔命令**，不要用 `&&`（旧版 PowerShell 可能报错）。

1. **查看状态**

   ```powershell
   git status
   ```

2. **按路径添加（不要无脑 `git add .`）**

   典型可提交范围（按本次实际改动增减）：

   - `cmd/`、`internal/`、`frontend/`、`python_scripts/`（若存在）
   - 根目录 `README.md`、`PRD.md`、`.gitignore`、`go.mod` 等配置（**注意**：本仓库 `.gitignore` 含 `go.sum`，若需协作构建，应评估是否移除对 `go.sum` 的忽略并单独提交，此处不强制改仓库策略）
   - `docs/index.html`、`docs/style.css`、`docs/images/`（Pages 需要时）
   - `migrations/` 仅当确认是**正式迁移**且与 `internal/database/migrations/` 策略一致时再添加

   示例：

   ```powershell
   git add .gitignore README.md cmd/ internal/ frontend/
   git add docs/index.html docs/style.css docs/images/
   ```

3. **提交**

   ```powershell
   git commit -m "feat: 简述本次改动（中文可）"
   ```

4. **推送**

   ```powershell
   git branch --show-current
   git push origin main
   ```

   分支名若不是 `main`，将 `main` 换成当前分支。

---

## GitHub 侧注意

- **远程地址**：使用 `git remote -v` 确认 `origin` 指向你的 GitHub 仓库（HTTPS 或 SSH）。
- **身份验证**：HTTPS 推送失败时，在本机完成 **Git Credential**、**Personal Access Token** 或改用 **SSH**，不要要求把 token 写进仓库。
- **GitHub Pages**：若站点源为 **`/docs`**，只有已跟踪的 `docs/index.html` 等会出现在线上；推送后构建通常需要 **1～3 分钟**。
- **大文件**：不要提交模型与数据；若误提交过大 blob，需用 `git filter-repo` 等清理（超出本技能步骤，需单独处理）。

---

## 常见问题

**Q：`data/` 曾经进过仓库，现在还在远程历史里？**  
A：在 `.gitignore` 已包含 `data/` 的前提下，执行 `git rm -r --cached data/`（仅删索引、不删本地），再提交一次；历史清理需另做 filter。

**Q：想恢复「整包 docs」到 Git，但又要排除 thesis？**  
A：不要用单一 `docs/` 全跟踪；应维持当前 negation 模式，或改为 `docs/thesis/`、`docs/LEARNING.md` 等**显式 ignore** 列表，避免把个人论文推上去。

**Q：推送报 `SEC_E_NO_CREDENTIALS` 或 403？**  
A：在本机重新登录 GitHub、更新 token，或检查是否对该仓库有写权限；Agent 无法代替用户完成交互式登录。

**Q：`git status` 里仍有应忽略的目录？**  
A：确认 `.gitignore` 规则；若文件已被跟踪，需 `git rm -r --cached <路径>` 后再提交。

---

## Agent 执行时的检查清单

1. 读 `.gitignore`，确认本次 `git add` 不包含 `data/`、`logs/`、`results/`、`.env` 及未反选的 `docs/` 文件。
2. 若用户只要「页面更新」，至少包含 `docs/index.html`、`docs/style.css` 及变更的图片。
3. 提交信息用完整句子，说明「改了什么、为什么」。
4. 推送失败时说明原因并给出本机认证/网络排查方向，不要伪造已推送。
