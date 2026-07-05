# AI Student Radar

面向 AI/机器人方向学生的每日 AI 情报看板前端 MVP。它把 AI 新闻、论文、开源项目和产品动态整理成适合学习、科研申请和产品分析沉淀的仪表盘。

## 功能

- 今日 Top 情报卡片：来源、时间、分类、可信度、热度、相关度、摘要和行动建议。
- 学生视角沉淀：为什么值得看、涉及知识点、可做小项目、申请素材。
- 筛选与搜索：按机器人、具身智能、AI Agent、多模态、AI 产品、AI 安全、开源项目筛选。
- 本地交互：收藏、刷新状态、导出 Markdown 日报。
- 响应式 UI：桌面三栏看板，移动端纵向信息流。

## 本地开发

```bash
npm install
npm run dev
```

默认开发地址：

```text
http://127.0.0.1:5173/
```

## 生产构建

```bash
npm run build
```

构建产物会生成在 `dist/`。

## GitHub Pages 部署

本项目已配置 GitHub Actions：push 到 `main` 分支后自动构建并部署到 GitHub Pages。

部署 workflow 位于：

```text
.github/workflows/deploy.yml
```

`vite.config.js` 会在 GitHub Actions 中自动读取仓库名，设置正确的 Pages base path：

- 普通项目仓库：`https://<user>.github.io/<repo>/`
- 用户或组织主页仓库：`https://<user>.github.io/`

## GitHub 仓库设置

首次推送后，在 GitHub 仓库中打开 Pages：

1. 进入仓库 `Settings`。
2. 打开左侧 `Pages`。
3. 在 `Build and deployment` 中把 `Source` 设为 `GitHub Actions`。
4. 回到 `Actions`，等待 `Deploy to GitHub Pages` workflow 完成。
5. 部署成功后，Pages 页面会显示站点 URL。

## 技术栈

- React
- Vite
- lucide-react
- GitHub Actions
- GitHub Pages
