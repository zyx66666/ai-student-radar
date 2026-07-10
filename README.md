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
npm run fetch:news
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

## 数据采集

```bash
python backend/collect_news.py
```

采集器会优先读取 RSS/Atom 和 arXiv API，写入本地 SQLite：

```text
backend/data/news.sqlite
```

每次采集后会导出前端可读取的数据：

```text
public/data/news.json
```

当前数据源包括 OpenAI Blog、Google DeepMind Blog、Anthropic News、Hugging Face Papers、arXiv cs.AI/cs.LG/cs.RO、TechCrunch AI、The Decoder 和量子位。前端线上唯一数据源是 `public/data/news.json`；本地或部署环境读取失败时，会自动回退到内置 mock 数据，避免页面空白。

常用采集参数：

```bash
python backend/collect_news.py --limit-per-source 4 --export-limit 30
```

### AI 摘要与评分

采集器会为每条内容输出结构化分析字段：

- `one_sentence_summary`
- `importance`
- `audience`
- `action_suggestion`
- `relevance_score`
- `credibility_score`
- `novelty_score`
- `trend_score`
- `actionability_score`
- `spam_score`
- `final_score`

评分公式：

```text
final_score = 相关度 35% + 来源可信度 20% + 新颖性 15% + 热度 15% + 行动价值 15% - 垃圾惩罚
```

如果配置了 `OPENAI_API_KEY`，脚本会使用 LLM 生成结构化 JSON 分析；模型可通过 `AI_RADAR_MODEL` 或 `OPENAI_MODEL` 指定。没有 API Key 或调用失败时，会自动退回本地规则评分。

## GitHub Pages 部署

本项目已配置 GitHub Actions：

- push 到 `main`：自动 build 并部署到 GitHub Pages。
- 每天北京时间 08:00：自动采集新闻、更新 `backend/data/news.sqlite`、导出 `public/data/news.json`、build 并部署。
- `workflow_dispatch`：可在 GitHub Actions 页面手动触发一次数据更新和部署。

部署 workflow 位于：

```text
.github/workflows/deploy.yml
```

`vite.config.js` 支持 GitHub Pages 子路径。workflow 会根据仓库名设置 `VITE_BASE_PATH`：

- 普通项目仓库：`https://<user>.github.io/<repo>/`
- 用户或组织主页仓库：`https://<user>.github.io/`

## GitHub 仓库设置

首次推送后，在 GitHub 仓库中打开 Pages：

1. 进入仓库 `Settings`。
2. 打开左侧 `Pages`。
3. 在 `Build and deployment` 中把 `Source` 设为 `GitHub Actions`。
4. 回到 `Actions`，等待 `Deploy to GitHub Pages` workflow 完成。
5. 部署成功后，Pages 页面会显示站点 URL。

## GitHub Secrets 与变量

如果希望每日采集使用 OpenAI 做结构化摘要和评分，在仓库里配置：

1. 进入 `Settings` -> `Secrets and variables` -> `Actions`。
2. 在 `Secrets` 新增 `OPENAI_API_KEY`。
3. 在 `Variables` 可选新增 `AI_RADAR_MODEL`，例如 `gpt-4o-mini`。

不配置 `OPENAI_API_KEY` 也可以正常运行；采集脚本会自动使用本地规则评分，不会让 GitHub Actions 失败。

## 手动触发每日更新

1. 打开 GitHub 仓库的 `Actions`。
2. 选择 `Build and Deploy to GitHub Pages`。
3. 点击 `Run workflow`。
4. 选择 `main` 分支并运行。

这会执行一次完整流程：采集 -> 更新 SQLite -> 导出 `news.json` -> build -> deploy。

## 技术栈

- React
- Vite
- lucide-react
- GitHub Actions
- GitHub Pages
- SQLite
