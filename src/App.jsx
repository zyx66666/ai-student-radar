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
  X,
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
const beijingTimeZone = "Asia/Shanghai";
const favoritesStorageKey = "ai-student-radar-favorites";
const scheduleLabel = "每日北京时间 08:00 / 12:00 / 18:00 自动采集";

function normalizeNewsPayload(payload) {
  if (Array.isArray(payload)) {
    return {
      meta: null,
      dailyBrief: null,
      clusters: [],
      articles: payload,
    };
  }
  if (payload && Array.isArray(payload.articles)) {
    return {
      meta: payload.meta ?? null,
      dailyBrief: payload.daily_brief ?? null,
      clusters: Array.isArray(payload.clusters) ? payload.clusters : [],
      articles: payload.articles,
    };
  }
  throw new Error("news.json format is invalid");
}

function normalizeFavoriteId(id) {
  if (typeof id === "number" && Number.isFinite(id)) {
    return id;
  }
  if (typeof id === "string") {
    const trimmed = id.trim();
    if (!trimmed) {
      return null;
    }
    return /^\d+$/.test(trimmed) ? Number(trimmed) : trimmed;
  }
  return null;
}

function loadFavoriteIds() {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return new Set();
    }
    const raw = window.localStorage.getItem(favoritesStorageKey);
    if (!raw) {
      return new Set();
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return new Set();
    }
    const validIds = parsed
      .map(normalizeFavoriteId)
      .filter((id) => id !== null);
    return new Set(validIds);
  } catch {
    return new Set();
  }
}

function getBeijingDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: beijingTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: value.year,
    month: value.month,
    day: value.day,
    weekday: value.weekday,
  };
}

function getBeijingDisplayDate(date = new Date()) {
  const { year, month, day, weekday } = getBeijingDateParts(date);
  return `${year}.${month}.${day} ${weekday}`;
}

function getBeijingFileDate(date = new Date()) {
  const { year, month, day } = getBeijingDateParts(date);
  return `${year}-${month}-${day}`;
}

async function fetchNewsArticles(cacheBust = false) {
  const suffix = cacheBust ? `?t=${Date.now()}` : "";
  const response = await fetch(`${import.meta.env.BASE_URL}data/news.json${suffix}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`news.json ${response.status}`);
  }
  const payload = await response.json();
  const normalized = normalizeNewsPayload(payload);
  if (normalized.articles.length === 0) {
    throw new Error("news.json is empty");
  }
  return {
    meta: normalized.meta,
    dailyBrief: normalized.dailyBrief,
    clusters: normalized.clusters,
    articles: normalized.articles.map(hydrateFeedArticle),
  };
}

function parseArticleTime(value) {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function isWithinHours(publishedAt, hours) {
  const timestamp = parseArticleTime(publishedAt);
  if (timestamp === null) {
    return false;
  }
  const now = Date.now();
  return timestamp <= now + 5 * 60 * 1000 && now - timestamp <= hours * 60 * 60 * 1000;
}

function isWithinDays(publishedAt, days) {
  return isWithinHours(publishedAt, days * 24);
}

function sortByScoreAndTime(left, right) {
  const scoreDelta = (right.finalScore ?? right.relevance ?? 0) - (left.finalScore ?? left.relevance ?? 0);
  if (scoreDelta !== 0) {
    return scoreDelta;
  }
  return (parseArticleTime(right.publishedAt) ?? 0) - (parseArticleTime(left.publishedAt) ?? 0);
}

function getSafeArticleUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.href;
    }
  } catch {
    return "";
  }
  return "";
}

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

function articleQuotaGroup(article) {
  const tags = article.knowledge ?? article.tags ?? [];
  if (article.category === "论文" || tags.includes("论文") || article.source?.includes("arXiv")) {
    return "paper";
  }
  if (article.category === "机器人/具身智能" || tags.includes("机器人") || tags.includes("具身智能")) {
    return "robotics";
  }
  if (["AI产品", "AI Agent", "开源项目"].includes(article.category)) {
    return "product_agent";
  }
  if (["融资动态", "AI芯片"].includes(article.category) || tags.includes("算力")) {
    return "industry";
  }
  return "other";
}

function applyTopQuotas(items) {
  const quotas = {
    paper: 4,
    robotics: 3,
    product_agent: 3,
    industry: 2,
    other: 10,
  };
  const used = {};
  const selected = [];
  for (const article of items) {
    const group = articleQuotaGroup(article);
    used[group] = used[group] ?? 0;
    if (used[group] >= quotas[group]) {
      continue;
    }
    selected.push(article);
    used[group] += 1;
    if (selected.length >= 10) {
      break;
    }
  }
  return selected;
}

function hydrateFeedArticle(article, index) {
  const score = article.final_score ?? article.score ?? 72;
  const tags = Array.isArray(article.tags) && article.tags.length ? article.tags : [article.category ?? "AI新闻"];
  const relevance = article.relevance_score ?? Math.min(99, Math.max(58, score + (tags.some((tag) => ["机器人", "具身智能", "机器人/具身智能", "AI Agent", "多模态"].includes(tag)) ? 8 : 0)));

  return {
    id: article.id ?? index + 1,
    title: article.title,
    url: article.url,
    source: article.source ?? "AI Radar",
    publishedAt: article.published_at,
    time: formatFeedTime(article.published_at),
    category: article.category ?? "AI新闻",
    finalScore: score,
    credibility: article.credibility_score ?? Math.min(99, Math.max(60, score + 6)),
    heat: article.trend_score ?? Math.min(99, Math.max(55, score)),
    relevance,
    summary: article.tldr || article.one_sentence_summary || article.summary || "这条内容来自自动采集源，建议打开原文进一步判断价值。",
    why: article.why_it_matters || article.importance || `来自 ${article.source ?? "可信来源"}，与 ${tags.slice(0, 3).join("、")} 相关，适合纳入每日 AI 情报追踪。`,
    studentValue: article.student_value || article.audience || "适合作为学习、科研申请或产品分析素材。",
    researchValue: article.research_value || "可提炼为研究计划或论文阅读素材。",
    pmValue: article.pm_value || "可转化为产品分析卡片。",
    difficulty: article.difficulty || "中等",
    readTime: article.read_time || "3 min",
    actions: buildActions({ ...article, tags }),
    knowledge: tags.slice(0, 4),
    project:
      article.next_action ||
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

function TopBar({ query, setQuery, refreshCount, onRefresh, meta, loadedCount }) {
  const stats = meta
    ? [
        `采集 ${meta.collected_count ?? loadedCount}`,
        `过滤 ${meta.filtered_count ?? 0}`,
        `保留 ${meta.kept_count ?? loadedCount}`,
        `来源 ${meta.source_count ?? "-"}`,
      ]
    : [`已加载 ${loadedCount} 条`];

  return (
    <header className="topbar glass-panel">
      <div className="date-block">
        <CalendarDays size={19} />
        <div>
          <span>{getBeijingDisplayDate()}</span>
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
        {stats.map((item) => (
          <span key={item}>{item}</span>
        ))}
        <span>{meta?.schedule_label ?? scheduleLabel}</span>
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
  const articleUrl = getSafeArticleUrl(article.url);

  return (
    <article className="article-card glass-panel">
      <div className="article-rank">{String(article.id).padStart(2, "0")}</div>
      <div className="article-body">
        <div className="article-meta">
          <span>{article.source}</span>
          <span>{article.time}</span>
          <span>{article.category}</span>
        </div>
        <h2>
          {articleUrl ? (
            <a
              className="article-title-link"
              href={articleUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="打开原文"
            >
              {article.title}
            </a>
          ) : (
            article.title
          )}
        </h2>
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

function buildFallbackBrief(visibleArticles) {
  if (!visibleArticles.length) {
    return {
      headline: "今日主线：等待下一批高价值情报",
      summary: "当前页面没有匹配内容，可以调整筛选条件，或等待下一次自动采集更新 news.json。",
      student_actions: ["调整分类或关键词", "等待下一次自动采集", "手动刷新已部署的 news.json"],
    };
  }
  const top = visibleArticles[0];
  const categoryCounts = visibleArticles.reduce((acc, article) => {
    acc[article.category] = (acc[article.category] ?? 0) + 1;
    return acc;
  }, {});
  const leading = Object.entries(categoryCounts)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([category]) => category)
    .join("、");
  return {
    headline: `今日主线：${leading}值得重点追踪`,
    summary: `当前页面最值得沉淀的是《${top.title}》。可以把它转化为学习笔记、科研计划素材或产品分析卡。`,
    student_actions: [top.project, "收藏最高分内容并补充 3 条要点", "每周复盘时整理为申请素材库"],
  };
}

function buildFallbackClusters(items) {
  const buckets = items.reduce((acc, article) => {
    const key = article.category || article.knowledge?.[0] || "AI动态";
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(article);
    return acc;
  }, {});

  return Object.entries(buckets)
    .map(([topic, articlesInCluster]) => {
      const top = [...articlesInCluster].sort(sortByScoreAndTime)[0];
      const heat = Math.min(
        100,
        Math.round(
          articlesInCluster.reduce((sum, article) => sum + (article.finalScore ?? article.relevance ?? 60), 0) /
            articlesInCluster.length +
            Math.min(articlesInCluster.length, 8) * 2,
        ),
      );
      return {
        topic,
        heat,
        article_count: articlesInCluster.length,
        why_hot: `${topic}在当前页面出现 ${articlesInCluster.length} 次，代表内容是《${top.title}》。`,
        student_action: top.project,
      };
    })
    .sort((left, right) => right.heat - left.heat)
    .slice(0, 8);
}

function ClusterModal({ clusters, articles, onClose }) {
  const visibleClusters = clusters.length ? clusters : buildFallbackClusters(articles);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-modal="true"
        className="cluster-modal glass-panel"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="cluster-modal-heading">
          <div>
            <div className="section-label">
              <Layers3 size={17} />
              热点聚类
            </div>
            <h2>从零散资讯看主题走势</h2>
          </div>
          <button className="icon-button" onClick={onClose} type="button">
            <X size={17} />
            <span>关闭</span>
          </button>
        </div>

        <div className="cluster-list">
          {visibleClusters.map((cluster) => (
            <article className="cluster-card" key={cluster.topic}>
              <div className="cluster-card-top">
                <h3>{cluster.topic}</h3>
                <strong>{cluster.heat ?? 70}</strong>
              </div>
              <p>{cluster.why_hot}</p>
              <div className="cluster-meta">
                <span>{cluster.article_count ?? 0} 篇相关文章</span>
                <span>热度 {cluster.heat ?? 70}</span>
              </div>
              <div className="project-line">
                <Target size={15} />
                <span>{cluster.student_action}</span>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function DailySummary({ visibleArticles, favorites, onExport, dailyBrief }) {
  const brief = dailyBrief?.headline ? dailyBrief : buildFallbackBrief(visibleArticles);
  const actions = Array.isArray(brief.student_actions) ? brief.student_actions.slice(0, 3) : [];

  return (
    <section className="daily-summary glass-panel">
      <div>
        <div className="section-label">
          <CheckCircle2 size={17} />
          每日总结
        </div>
        <h2>{brief.headline}</h2>
        <p>{brief.summary}</p>
        {actions.length ? (
          <div className="summary-action-list">
            {actions.map((action) => (
              <span key={action}>{action}</span>
            ))}
          </div>
        ) : null}
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

function buildMarkdown(items, favorites, activeNav, dailyBrief) {
  const date = getBeijingDisplayDate();
  const reportTitle = activeNav === "今日精选" ? "今日精选 · 最近24小时 AI 情报 Top10" : `AI Student Radar ${activeNav}`;
  const brief = dailyBrief?.headline ? dailyBrief : buildFallbackBrief(items);
  const lines = [
    `# ${reportTitle} · ${date}`,
    "",
    "## 今日主线",
    brief.headline,
    "",
    brief.summary,
    "",
    "## 学生行动建议",
    ...(Array.isArray(brief.student_actions) ? brief.student_actions.map((action) => `- ${action}`) : []),
    "",
    "## Top 情报",
  ];

  items.forEach((item, index) => {
    lines.push(
      "",
      `### ${index + 1}. ${item.title}${favorites.has(item.id) ? " [已收藏]" : ""}`,
      `- 来源：${item.source} / ${item.time} / ${item.category}`,
      `- 原文链接：${item.url || "无"}`,
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
  const [favorites, setFavorites] = useState(() => loadFavoriteIds());
  const [refreshCount, setRefreshCount] = useState(0);
  const [feedArticles, setFeedArticles] = useState(articles);
  const [newsMeta, setNewsMeta] = useState(null);
  const [dailyBrief, setDailyBrief] = useState(null);
  const [clusters, setClusters] = useState([]);
  const [clusterOpen, setClusterOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadNews() {
      try {
        const nextNews = await fetchNewsArticles();
        if (!cancelled) {
          setFeedArticles(nextNews.articles);
          setNewsMeta(nextNews.meta);
          setDailyBrief(nextNews.dailyBrief);
          setClusters(nextNews.clusters);
        }
      } catch (error) {
        if (!cancelled) {
          setFeedArticles(articles);
          setNewsMeta(null);
          setDailyBrief(null);
          setClusters([]);
          console.info("Using bundled mock articles:", error);
        }
      }
    }

    loadNews();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        favoritesStorageKey,
        JSON.stringify(Array.from(favorites)),
      );
    } catch {
      // ignore localStorage errors
    }
  }, [favorites]);

  const visibleArticles = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const isTodaySelection = activeNav === "今日精选";
    const windowedArticles = feedArticles.filter((article) =>
      isTodaySelection ? isWithinHours(article.publishedAt, 24) : isWithinDays(article.publishedAt, 3),
    );

    const filteredArticles = windowedArticles.filter((article) => {
      const categoryMatch = category === "全部" || article.category === category;
      const navMatch =
        isTodaySelection ||
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

    return isTodaySelection ? applyTopQuotas(filteredArticles.sort(sortByScoreAndTime)) : filteredArticles;
  }, [activeNav, category, favorites, feedArticles, query]);

  function toggleFavorite(id) {
    const favoriteId = normalizeFavoriteId(id);
    if (favoriteId === null) {
      return;
    }
    setFavorites((current) => {
      const next = new Set(current);
      if (next.has(favoriteId)) {
        next.delete(favoriteId);
      } else {
        next.add(favoriteId);
      }
      return next;
    });
  }

  function exportMarkdown() {
    const markdown = buildMarkdown(visibleArticles, favorites, activeNav, dailyBrief);
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ai-student-radar-${getBeijingFileDate()}.md`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function refreshDashboardData() {
    try {
      const nextNews = await fetchNewsArticles(true);
      setFeedArticles(nextNews.articles);
      setNewsMeta(nextNews.meta);
      setDailyBrief(nextNews.dailyBrief);
      setClusters(nextNews.clusters);
      setRefreshCount((count) => count + 1);
    } catch (error) {
      console.info("Refresh kept current dashboard data:", error);
    }
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
          onRefresh={refreshDashboardData}
          meta={newsMeta}
          loadedCount={feedArticles.length}
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
                  最近24小时 Top 10
                </div>
                <h2>从信息流转成学习和申请素材</h2>
              </div>
              <button className="ghost-button" onClick={() => setClusterOpen(true)} type="button">
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
                  <span>
                    {activeNav === "今日精选"
                      ? "最近24小时暂无新情报，可等待下一次自动采集或手动刷新。"
                      : activeNav === "我的收藏"
                        ? "还没有收藏内容，点击资讯卡片里的收藏按钮即可加入。"
                      : "换一个关键词或分类试试。"}
                  </span>
                </div>
              ) : null}
            </div>

            <DailySummary
              dailyBrief={dailyBrief}
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
      {clusterOpen ? (
        <ClusterModal
          articles={visibleArticles.length ? visibleArticles : feedArticles}
          clusters={clusters}
          onClose={() => setClusterOpen(false)}
        />
      ) : null}
    </main>
  );
}
