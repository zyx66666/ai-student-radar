import React, { useEffect, useMemo, useState } from "react";
import {
  Archive,
  Bell,
  BookOpen,
  Bot,
  BrainCircuit,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Code2,
  Download,
  FileText,
  Flame,
  FolderOpen,
  Gauge,
  GraduationCap,
  Heart,
  Layers3,
  Menu,
  RefreshCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  Target,
  TrendingUp,
} from "lucide-react";
import duneBackground from "./assets/dune-background.png";
import {
  applicationMaterials,
  articles,
  categories,
  navItems,
  readingQueue,
  skillMap,
  trends,
} from "./data";

const navIcons = [
  Sparkles,
  FileText,
  Bot,
  Layers3,
  Code2,
  Heart,
  GraduationCap,
];

const actionIcons = {
  读论文: BookOpen,
  看代码: Code2,
  写笔记: FileText,
  做项目: Target,
  收藏: Heart,
};

const defaultActions = ["写笔记", "收藏"];

function formatFeedTime(value) {
  if (!value) {
    return "刚刚";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "刚刚";
  }
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function buildActions(article) {
  const tags = article.tags ?? [];
  const actions = new Set(defaultActions);
  if (article.category === "论文" || tags.includes("论文") || article.source?.includes("arXiv")) {
    actions.add("读论文");
  }
  if (tags.includes("开源项目") || article.source?.includes("Hugging Face")) {
    actions.add("看代码");
  }
  if (["机器人", "具身智能", "机器人/具身智能", "AI Agent", "多模态"].includes(article.category)) {
    actions.add("做项目");
  }
  return Array.from(actions);
}

function hydrateFeedArticle(article, index) {
  const score = article.final_score ?? article.score ?? 72;
  const tags = Array.isArray(article.tags) && article.tags.length ? article.tags : [article.category ?? "AI新闻"];
  const relevance = article.relevance_score ?? Math.min(99, Math.max(58, score + (tags.some((tag) => ["机器人", "具身智能", "机器人/具身智能", "AI Agent", "多模态"].includes(tag)) ? 8 : 0)));

  return {
    id: article.id ?? index + 1,
    title: article.title,
    source: article.source ?? "AI Radar",
    time: formatFeedTime(article.published_at),
    category: article.category ?? "AI新闻",
    finalScore: score,
    credibility: article.credibility_score ?? Math.min(99, Math.max(60, score + 6)),
    heat: article.trend_score ?? Math.min(99, Math.max(55, score)),
    relevance,
    summary: article.one_sentence_summary || article.summary || "这条内容来自自动采集源，建议打开原文进一步判断价值。",
    why: article.importance || `来自 ${article.source ?? "可信来源"}，与 ${tags.slice(0, 3).join("、")} 相关，适合纳入每日 AI 情报追踪。`,
    actions: buildActions({ ...article, tags }),
    knowledge: tags.slice(0, 4),
    project:
      article.action_suggestion ||
      (article.category === "AI产品"
        ? "整理一张产品分析卡：用户痛点、核心能力、竞品和 PM 启发"
        : article.category === "论文"
          ? "按研究问题、方法、结果、局限和可复现性写一页阅读笔记"
          : "把这条动态拆成一个可复现的小项目或申请素材片段"),
  };
}

function clampScore(score) {
  return Math.max(0, Math.min(100, score));
}

function ScorePill({ label, value, tone = "cyan" }) {
  return (
    <div className={`score-pill ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Sidebar({ active, onSelect, favoritesCount }) {
  return (
    <aside className="sidebar glass-panel">
      <div className="brand">
        <div className="brand-mark">
          <BrainCircuit size={24} strokeWidth={1.9} />
        </div>
        <div>
          <h1>AI Student Radar</h1>
          <p>学生成长型 AI 情报系统</p>
        </div>
      </div>

      <nav className="nav-list" aria-label="主导航">
        {navItems.map((item, index) => {
          const Icon = navIcons[index];
          const selected = active === item;
          return (
            <button
              className={`nav-item ${selected ? "active" : ""}`}
              key={item}
              onClick={() => onSelect(item)}
              type="button"
            >
              <Icon size={18} strokeWidth={1.8} />
              <span>{item}</span>
              {item === "我的收藏" && favoritesCount > 0 ? (
                <em>{favoritesCount}</em>
              ) : null}
            </button>
          );
        })}
      </nav>

      <div className="source-strip">
        <span>可信源</span>
        <strong>RSS / arXiv / HF / GitHub</strong>
      </div>
    </aside>
  );
}

function TopBar({ query, setQuery, refreshCount, onRefresh }) {
  return (
    <header className="topbar glass-panel">
      <div className="date-block">
        <CalendarDays size={19} />
        <div>
          <span>2026.07.05 周日</span>
          <strong>今日 AI 情报</strong>
        </div>
      </div>

      <label className="search-box">
        <Search size={18} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索机器人、Agent、论文、产品..."
          aria-label="搜索情报"
        />
      </label>

      <div className="top-stats" aria-label="今日统计">
        <span>采集 126</span>
        <span>过滤 54</span>
        <span>保留 72</span>
      </div>

      <button className="icon-button primary" onClick={onRefresh} type="button">
        <RefreshCcw size={18} />
        <span>刷新 {refreshCount ? `+${refreshCount}` : ""}</span>
      </button>
    </header>
  );
}

function CategoryTabs({ selected, setSelected }) {
  return (
    <div className="category-tabs" role="tablist" aria-label="情报分类">
      {categories.map((category) => (
        <button
          key={category}
          className={selected === category ? "selected" : ""}
          onClick={() => setSelected(category)}
          role="tab"
          type="button"
        >
          {category}
        </button>
      ))}
    </div>
  );
}

function ArticleCard({ article, favorite, onToggleFavorite }) {
  const relevanceTone = article.relevance > 90 ? "green" : "cyan";
  const finalScore = article.finalScore ?? article.relevance;

  return (
    <article className="article-card glass-panel">
      <div className="article-rank">{String(article.id).padStart(2, "0")}</div>
      <div className="article-body">
        <div className="article-meta">
          <span>{article.source}</span>
          <span>{article.time}</span>
          <span>{article.category}</span>
        </div>
        <h2>{article.title}</h2>
        <p className="summary">{article.summary}</p>
        <p className="why">
          <ShieldCheck size={16} />
          {article.why}
        </p>
        <div className="knowledge-row">
          {article.knowledge.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
        <div className="project-line">
          <Target size={16} />
          <span>{article.project}</span>
        </div>
      </div>

      <div className="article-side">
        <div className="final-score">
          <span>推荐分</span>
          <strong>{finalScore}</strong>
        </div>
        <div className="score-grid">
          <ScorePill label="可信度" value={article.credibility} tone="blue" />
          <ScorePill label="热度" value={article.heat} tone="amber" />
          <ScorePill label="相关度" value={article.relevance} tone={relevanceTone} />
        </div>
        <div className="action-row">
          {article.actions.map((action) => {
            const Icon = actionIcons[action];
            const isFavorite = action === "收藏" && favorite;
            return (
              <button
                className={isFavorite ? "action active" : "action"}
                key={action}
                onClick={action === "收藏" ? onToggleFavorite : undefined}
                type="button"
              >
                <Icon size={15} />
                <span>{action}</span>
              </button>
            );
          })}
        </div>
      </div>
    </article>
  );
}

function TrendPanel() {
  return (
    <section className="side-panel glass-panel">
      <div className="panel-heading">
        <TrendingUp size={18} />
        <h3>热点趋势</h3>
      </div>
      <div className="trend-list">
        {trends.map((trend) => (
          <div className="trend-item" key={trend.label}>
            <div>
              <span>{trend.label}</span>
              <strong>{trend.delta}</strong>
            </div>
            <div className="meter" aria-label={`${trend.label} 热度 ${trend.value}`}>
              <i style={{ width: `${clampScore(trend.value)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ReadingPanel() {
  return (
    <section className="side-panel glass-panel">
      <div className="panel-heading">
        <BookOpen size={18} />
        <h3>我该读什么</h3>
      </div>
      <ol className="reading-list">
        {readingQueue.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ol>
    </section>
  );
}

function MaterialPanel() {
  return (
    <section className="side-panel glass-panel compact">
      <div className="panel-heading">
        <Archive size={18} />
        <h3>申请素材</h3>
      </div>
      <div className="material-grid">
        {applicationMaterials.map((item) => (
          <button type="button" key={item}>
            <FolderOpen size={15} />
            {item}
          </button>
        ))}
      </div>
    </section>
  );
}

function SkillPanel() {
  return (
    <section className="side-panel glass-panel">
      <div className="panel-heading">
        <Gauge size={18} />
        <h3>能力地图</h3>
      </div>
      <div className="skill-list">
        {skillMap.map((item) => (
          <div className="skill-item" key={item.skill}>
            <span>{item.skill}</span>
            <div className="skill-meter">
              <i style={{ width: `${item.level}%` }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function DailySummary({ visibleArticles, favorites, onExport }) {
  const top = visibleArticles[0];

  return (
    <section className="daily-summary glass-panel">
      <div>
        <div className="section-label">
          <CheckCircle2 size={17} />
          每日总结
        </div>
        <h2>今日主线：具身智能和多模态 Agent 正在合流</h2>
        <p>
          最值得沉淀的是机器人 VLA、低成本多模态 Agent、仿真数据闭环和 Agent
          权限边界。建议把 {top?.title ?? "今日精选"} 写成一张研究计划素材卡。
        </p>
      </div>
      <div className="summary-actions">
        <div>
          <strong>{visibleArticles.length}</strong>
          <span>条高价值内容</span>
        </div>
        <div>
          <strong>{favorites.size}</strong>
          <span>条已收藏</span>
        </div>
        <button className="icon-button" onClick={onExport} type="button">
          <Download size={17} />
          <span>导出 Markdown</span>
        </button>
      </div>
    </section>
  );
}

function buildMarkdown(items, favorites) {
  const date = "2026.07.05 周日";
  const lines = [
    `# AI Student Radar 日报 ${date}`,
    "",
    "## 今日主线",
    "具身智能、多模态 Agent、机器人仿真和 Agent 安全是今天最值得追踪的方向。",
    "",
    "## Top 情报",
  ];

  items.forEach((item, index) => {
    lines.push(
      "",
      `### ${index + 1}. ${item.title}${favorites.has(item.id) ? " [已收藏]" : ""}`,
      `- 来源：${item.source} / ${item.time} / ${item.category}`,
      `- 推荐分：${item.finalScore ?? item.relevance}`,
      `- 评分：可信度 ${item.credibility}，热度 ${item.heat}，相关度 ${item.relevance}`,
      `- 摘要：${item.summary}`,
      `- 推荐理由：${item.why}`,
      `- 行动建议：${item.project}`,
      `- 知识点：${item.knowledge.join("、")}`,
    );
  });

  return lines.join("\n");
}

export default function App() {
  const [activeNav, setActiveNav] = useState("今日精选");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("全部");
  const [favorites, setFavorites] = useState(new Set([1, 2]));
  const [refreshCount, setRefreshCount] = useState(0);
  const [feedArticles, setFeedArticles] = useState(articles);

  useEffect(() => {
    let cancelled = false;

    async function loadNews() {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}data/news.json`, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`news.json ${response.status}`);
        }
        const payload = await response.json();
        if (!Array.isArray(payload) || payload.length === 0) {
          throw new Error("news.json is empty");
        }
        if (!cancelled) {
          setFeedArticles(payload.map(hydrateFeedArticle));
        }
      } catch (error) {
        if (!cancelled) {
          setFeedArticles(articles);
          console.info("Using bundled mock articles:", error);
        }
      }
    }

    loadNews();

    return () => {
      cancelled = true;
    };
  }, []);

  const visibleArticles = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return feedArticles.filter((article) => {
      const categoryMatch = category === "全部" || article.category === category;
      const navMatch =
        activeNav === "今日精选" ||
        activeNav === "学习计划" ||
        (activeNav === "我的收藏" && favorites.has(article.id)) ||
        (activeNav === "论文雷达" && article.actions.includes("读论文")) ||
        (activeNav === "机器人/具身智能" &&
          ["机器人", "具身智能", "机器人/具身智能"].includes(article.category)) ||
        (activeNav === "AI产品" && article.category === "AI产品") ||
        (activeNav === "开源项目" && article.actions.includes("看代码"));

      const queryMatch =
        !normalizedQuery ||
        [article.title, article.source, article.category, article.summary]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);

      return categoryMatch && navMatch && queryMatch;
    });
  }, [activeNav, category, favorites, feedArticles, query]);

  function toggleFavorite(id) {
    setFavorites((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function exportMarkdown() {
    const markdown = buildMarkdown(visibleArticles, favorites);
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "ai-student-radar-2026-07-05.md";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="app-shell">
      <img className="dune-asset" src={duneBackground} alt="" aria-hidden="true" />
      <div className="ambient-lines" aria-hidden="true" />

      <Sidebar
        active={activeNav}
        favoritesCount={favorites.size}
        onSelect={setActiveNav}
      />

      <section className="workspace">
        <TopBar
          query={query}
          refreshCount={refreshCount}
          setQuery={setQuery}
          onRefresh={() => setRefreshCount((count) => count + 1)}
        />

        <div className="mobile-menu glass-panel">
          <Menu size={18} />
          <span>{activeNav}</span>
          <Bell size={18} />
        </div>

        <div className="content-grid">
          <section className="feed-column">
            <div className="feed-heading">
              <div>
                <div className="section-label">
                  <Flame size={17} />
                  今日 Top 10
                </div>
                <h2>从信息流转成学习和申请素材</h2>
              </div>
              <button className="ghost-button" type="button">
                查看聚类
                <ChevronRight size={16} />
              </button>
            </div>

            <CategoryTabs selected={category} setSelected={setCategory} />

            <div className="article-list">
              {visibleArticles.map((article) => (
                <ArticleCard
                  article={article}
                  favorite={favorites.has(article.id)}
                  key={article.id}
                  onToggleFavorite={() => toggleFavorite(article.id)}
                />
              ))}
              {visibleArticles.length === 0 ? (
                <div className="empty-state glass-panel">
                  <Star size={22} />
                  <strong>没有匹配情报</strong>
                  <span>换一个关键词或分类试试。</span>
                </div>
              ) : null}
            </div>

            <DailySummary
              favorites={favorites}
              visibleArticles={visibleArticles}
              onExport={exportMarkdown}
            />
          </section>

          <aside className="right-rail">
            <TrendPanel />
            <ReadingPanel />
            <MaterialPanel />
            <SkillPanel />
          </aside>
        </div>
      </section>
    </main>
  );
}
