import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  Bell,
  BookOpen,
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
  Code2,
  Layers3,
  Archive,
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
const selectedLearningTasksStorageKey = "ai-student-radar-learning-tasks";
const completedTaskIdsStorageKey = "ai-student-radar-completed-tasks";
const materialPurposesStorageKey = "ai-student-radar-material-purposes";
const scheduleLabel = "每日北京时间 08:00 / 12:00 / 18:00 自动采集";
const materialPurposes = ["研究计划素材", "论文选题", "项目灵感", "产品案例", "课程汇报", "英文阅读", "暂存"];

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

function loadStoredStringSet(storageKey) {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return new Set();
    }
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return new Set();
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return new Set();
    }
    return new Set(parsed.map((item) => String(item)).filter(Boolean));
  } catch {
    return new Set();
  }
}

function loadStoredObject(storageKey) {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return {};
    }
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
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

function normalizeTitleForDedupe(title) {
  return String(title ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

function uniqueByTitle(items) {
  const seen = new Set();
  return items.filter((article) => {
    const normalizedTitle = normalizeTitleForDedupe(article.title);
    if (!normalizedTitle || seen.has(normalizedTitle)) {
      return false;
    }
    seen.add(normalizedTitle);
    return true;
  });
}

function applyDiverseQuotas(items, quotas, limit = 10, groupGetter = articleQuotaGroup) {
  const used = {};
  const selected = [];
  for (const article of items) {
    const group = groupGetter(article);
    used[group] = used[group] ?? 0;
    if (used[group] >= (quotas[group] ?? limit)) {
      continue;
    }
    selected.push(article);
    used[group] += 1;
    if (selected.length >= limit) {
      break;
    }
  }
  return selected;
}

function applyTopQuotas(items) {
  return applyDiverseQuotas(
    items,
    {
      paper: 4,
      robotics: 3,
      product_agent: 3,
      industry: 2,
      other: 10,
    },
    10,
  );
}

function getArticleTags(article) {
  const values = [
    ...(Array.isArray(article.tags) ? article.tags : []),
    ...(Array.isArray(article.knowledge) ? article.knowledge : []),
    article.category,
  ];
  return values.filter(Boolean).map((item) => String(item));
}

function includesAnyText(values, keywords) {
  const haystack = values.join(" ").toLowerCase();
  return keywords.some((keyword) => haystack.includes(keyword.toLowerCase()));
}

function articleText(article) {
  return [
    article.title,
    article.summary,
    article.why,
    article.source,
    article.category,
    ...(Array.isArray(article.tags) ? article.tags : []),
    ...(Array.isArray(article.knowledge) ? article.knowledge : []),
  ]
    .filter(Boolean)
    .join(" ");
}

function inferTopic(article) {
  const text = articleText(article);
  if (includesAnyText([text], ["机器人", "具身", "VLA", "SLAM", "导航", "机械臂", "robot"])) {
    return "机器人/具身智能";
  }
  if (includesAnyText([text], ["Agent", "工具调用", "workflow", "工作流"])) {
    return "AI Agent";
  }
  if (includesAnyText([text], ["多模态", "vision", "video", "audio", "视觉", "语音"])) {
    return "多模态";
  }
  if (includesAnyText([text], ["安全", "对齐", "隐私", "prompt injection", "权限"])) {
    return "AI安全";
  }
  if (includesAnyText([text], ["产品", "用户", "商业", "Product", "PM"])) {
    return "AI产品";
  }
  if (includesAnyText([text], ["开源", "GitHub", "代码", "Hugging Face", "repo"])) {
    return "开源项目";
  }
  if (includesAnyText([text], ["arXiv", "论文", "paper", "benchmark"])) {
    return "论文";
  }
  return article.category || "大模型";
}

function inferContentType(article) {
  const text = articleText(article);
  if (isPaperArticle(article) || includesAnyText([text], ["arXiv", "论文", "paper"])) {
    return "paper";
  }
  if (includesAnyText([text], ["GitHub", "开源", "代码", "repo", "SDK"])) {
    return "open_source";
  }
  if (includesAnyText([text], ["工具", "tool", "workflow", "插件"])) {
    return "tool";
  }
  if (article.category === "AI产品" || includesAnyText([text], ["产品", "用户", "竞品", "Product Hunt", "PM"])) {
    return "product";
  }
  if (includesAnyText([text], ["融资", "投资", "funding", "raises"])) {
    return "news";
  }
  return "trend";
}

function matchesCategory(article, selectedCategory) {
  if (selectedCategory === "全部") {
    return true;
  }
  return [article.category, article.topic, ...(article.tags ?? []), ...(article.knowledge ?? [])].includes(selectedCategory);
}

function matchesSearch(article, normalizedQuery) {
  if (!normalizedQuery) {
    return true;
  }
  return [article.title, article.source, article.category, article.topic, article.summary, article.studentReason]
    .join(" ")
    .toLowerCase()
    .includes(normalizedQuery);
}

function getSaveAs(article) {
  if (Array.isArray(article.save_as) && article.save_as.length) {
    return article.save_as;
  }
  if (Array.isArray(article.saveAs) && article.saveAs.length) {
    return article.saveAs;
  }
  if (article.contentType === "paper") {
    return ["论文选题", "申请素材", "学习笔记"];
  }
  if (article.contentType === "product") {
    return ["产品案例", "学习笔记"];
  }
  if (article.contentType === "open_source" || article.contentType === "tool") {
    return ["项目灵感", "课程汇报"];
  }
  if (article.topic === "机器人/具身智能" || article.topic === "AI Agent") {
    return ["项目灵感", "申请素材"];
  }
  return ["学习笔记", "暂存"];
}

function isAiHotArticle(article) {
  const tags = getArticleTags(article);
  return article.source === "AI HOT 精选" || tags.includes("AI HOT");
}

function isFinancingOnlyArticle(article) {
  const text = articleText(article);
  const financing = includesAnyText([text], ["融资", "投资", "估值", "募资", "fundraise", "funding", "raises", "round"]);
  const technicalSignal = includesAnyText(
    [text],
    ["模型", "Agent", "工具", "论文", "开源", "GitHub", "Hugging Face", "机器人", "多模态", "benchmark", "产品", "workflow"],
  );
  return financing && !technicalSignal;
}

function isMarketingNoiseArticle(article) {
  const text = articleText(article);
  return includesAnyText([text], ["限时", "优惠", "折扣", "邀请码", "注册", "广告", "赞助", "购买", "课程报名", "营销"]);
}

function computeNoisePenalty(article) {
  const text = articleText(article);
  let penalty = article.spam_score ?? article.spamScore ?? 0;
  if (isFinancingOnlyArticle(article)) {
    penalty += 18;
  }
  if (isMarketingNoiseArticle(article)) {
    penalty += 18;
  }
  if (includesAnyText([text], ["震惊", "重磅炸裂", "全网沸腾", "封神", "吊打"])) {
    penalty += 8;
  }
  if (String(article.summary ?? "").trim().length < 24) {
    penalty += 10;
  }
  if ((article.relevance_score ?? article.relevance ?? article.finalScore ?? 70) < 58) {
    penalty += 6;
  }
  return clampScore(penalty);
}

function computeStudentDailyScores(article) {
  const tags = getArticleTags(article);
  const text = articleText(article);
  const contentType = article.contentType || inferContentType(article);
  const topic = article.topic || inferTopic(article);
  const relevanceBase = article.relevance_score ?? article.relevance ?? article.finalScore ?? 70;
  const student_relevance = clampScore(
    relevanceBase +
      (includesAnyText([text], ["AI", "大模型", "Agent", "多模态", "机器人", "具身", "论文", "开源", "产品"]) ? 8 : 0) -
      (includesAnyText([text], ["融资", "估值", "股价"]) ? 10 : 0),
  );
  const learning_value = clampScore(
    (article.actionability_score ?? article.finalScore ?? 68) +
      (["paper", "open_source", "tool"].includes(contentType) ? 12 : 0) +
      (tags.some((tag) => ["论文", "开源项目", "AI Agent", "机器人", "多模态"].includes(tag)) ? 6 : 0),
  );
  const source_credibility = clampScore(article.credibility_score ?? article.credibility ?? (isAiHotArticle(article) ? 82 : 70));
  const trend_importance = clampScore(
    article.trend_score ??
      article.heat ??
      (["大模型", "AI Agent", "多模态", "机器人/具身智能", "AI产品"].includes(topic) ? 76 : 64),
  );
  const readability = clampScore(
    article.difficulty === "入门" ? 88 : article.difficulty === "中等" ? 80 : article.readTime === "2 min" || article.readTime === "3 min" ? 78 : 66,
  );
  const product_project_inspiration = clampScore(
    (["product", "open_source", "tool"].includes(contentType) ? 84 : 64) +
      (includesAnyText([text], ["workflow", "工具", "项目", "demo", "代码", "产品", "Agent"]) ? 8 : 0),
  );
  const noise_penalty = computeNoisePenalty(article);
  const student_daily_score = Math.round(
    student_relevance * 0.3 +
      learning_value * 0.2 +
      source_credibility * 0.15 +
      trend_importance * 0.15 +
      readability * 0.1 +
      product_project_inspiration * 0.1 -
      noise_penalty,
  );

  return {
    student_relevance,
    learning_value,
    source_credibility,
    trend_importance,
    readability,
    product_project_inspiration,
    noise_penalty,
    student_daily_score: clampScore(student_daily_score),
  };
}

function getDailyDiversityGroup(article) {
  const text = articleText(article);
  if (includesAnyText([text], ["Agent", "工作流", "workflow", "自动化", "工具调用", "coding agent"])) {
    return "agent_tool";
  }
  if (isPaperArticle(article) || includesAnyText([text], ["论文", "benchmark", "评测", "方法", "arXiv"])) {
    return "paper_method";
  }
  if (article.contentType === "open_source" || includesAnyText([text], ["开源", "GitHub", "Hugging Face", "repo", "代码"])) {
    return "open_source";
  }
  if (article.contentType === "product" || article.topic === "AI产品" || includesAnyText([text], ["产品", "用户", "案例"])) {
    return "product_case";
  }
  if (article.topic === "机器人/具身智能" || includesAnyText([text], ["机器人", "具身", "多模态", "VLA", "视频", "图像"])) {
    return "multimodal_robotics";
  }
  if (includesAnyText([text], ["算力", "芯片", "产业", "公司", "发布", "模型", "OpenAI", "Google", "Anthropic", "Meta", "NVIDIA"])) {
    return "model_industry";
  }
  return "trend_background";
}

const dailyTopicRules = [
  { topic: "机器人 / 具身智能", keywords: ["robot", "robotics", "vla", "embodied", "具身", "机器人", "sim2real", "机械臂"] },
  { topic: "AI Agent", keywords: ["agent", "tool use", "workflow", "browser", "computer use", "自动化", "智能体", "工具调用"] },
  { topic: "多模态", keywords: ["multimodal", "vlm", "vision-language", "image", "video", "audio", "多模态", "视觉语言", "图像", "视频"] },
  { topic: "AI 安全", keywords: ["safety", "alignment", "jailbreak", "permission", "security", "risk", "安全", "对齐", "越狱", "权限"] },
  { topic: "开源工具", keywords: ["open-source", "github", "repo", "release", "开源", "复现", "代码"] },
  { topic: "论文 / 研究方法", keywords: ["benchmark", "evaluation", "paper", "arxiv", "论文", "评测", "方法", "实验"] },
  { topic: "AI 产品", keywords: ["product", "app", "saas", "应用", "产品", "商业化", "用户"] },
  { topic: "AI 芯片", keywords: ["chip", "gpu", "nvidia", "算力", "芯片", "推理加速"] },
  { topic: "自动驾驶", keywords: ["autonomous driving", "dashcam", "自动驾驶", "驾驶", "车载"] },
  { topic: "医疗 AI", keywords: ["medical", "health", "medicine", "医疗", "诊断"] },
  { topic: "教育 AI", keywords: ["education", "learning", "tutor", "教育", "学习助手"] },
  { topic: "模型评测", keywords: ["benchmark", "eval", "evaluation", "leaderboard", "评测", "榜单"] },
  { topic: "开发工具", keywords: ["coding", "developer", "devtool", "ide", "编程", "开发工具", "代码助手"] },
  { topic: "大模型", keywords: ["llm", "large language model", "gpt", "claude", "gemini", "大模型", "基础模型"] },
];

function extractDailyTopicTags(article) {
  const text = [
    article.title,
    article.summary,
    article.category,
    article.studentValue,
    article.studentReason,
    article.nextAction,
    ...(article.tags ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const matched = dailyTopicRules
    .filter((rule) => rule.keywords.some((keyword) => text.includes(keyword.toLowerCase())))
    .map((rule) => rule.topic);
  if (!matched.length && article.topic) {
    matched.push(article.topic === "机器人/具身智能" ? "机器人 / 具身智能" : article.topic);
  }
  return Array.from(new Set(matched)).slice(0, 3);
}

function getDailyScoreLevel(score) {
  if (score >= 90) {
    return "今日必读";
  }
  if (score >= 80) {
    return "优先阅读";
  }
  return "可以浏览";
}

function normalizeDailyArticle(article, index) {
  const topicTags = extractDailyTopicTags(article);
  const extraUseTags = [];
  if (article.contentType === "open_source" || article.contentType === "tool") {
    extraUseTags.push("工具上手", "开源工具");
  }
  if (article.contentType === "trend") {
    extraUseTags.push("长期趋势");
  }
  if (article.topic === "机器人/具身智能" || article.topic === "AI Agent") {
    extraUseTags.push("研究方向");
  }
  const useTags = Array.from(new Set([...(article.saveAs ?? getSaveAs(article)), ...extraUseTags])).slice(0, 4);
  return {
    ...article,
    rank: index + 1,
    student_score: article.studentDailyScore,
    student_reason: article.studentReason,
    student_value: article.studentValue,
    action_suggestion: article.nextAction,
    reading_time: article.readTime,
    topic_tags: topicTags,
    use_tags: useTags,
  };
}

function selectStudentDailyTop10(items) {
  const top20 = uniqueByTitle(items)
    .filter((article) => isAiHotArticle(article))
    .filter((article) => !isFinancingOnlyArticle(article))
    .filter((article) => !isMarketingNoiseArticle(article))
    .filter((article) => String(article.summary ?? "").trim().length > 0)
    .filter((article) => (article.studentDailyBreakdown?.student_relevance ?? 0) >= 60)
    .filter((article) => (article.studentDailyBreakdown?.noise_penalty ?? 0) <= 15)
    .sort((left, right) => {
      const scoreDelta = (right.studentDailyScore ?? 0) - (left.studentDailyScore ?? 0);
      if (scoreDelta !== 0) {
        return scoreDelta;
      }
      return (parseArticleTime(right.publishedAt) ?? 0) - (parseArticleTime(left.publishedAt) ?? 0);
    })
    .slice(0, 20);

  const diversified = applyDiverseQuotas(
    top20,
    {
      model_industry: 2,
      agent_tool: 2,
      paper_method: 2,
      open_source: 1,
      product_case: 1,
      multimodal_robotics: 1,
      trend_background: 1,
    },
    10,
    getDailyDiversityGroup,
  );

  const selected = diversified.length >= 10
    ? diversified
    : [...diversified, ...top20.filter((article) => !new Set(diversified.map((item) => item.id)).has(article.id))].slice(0, 10);

  return selected
    .filter((article) => (article.studentDailyScore ?? 0) >= 70)
    .sort((left, right) => (right.studentDailyScore ?? 0) - (left.studentDailyScore ?? 0))
    .map(normalizeDailyArticle);
}

function isPaperSource(article) {
  return includesAnyText([article.source ?? ""], ["arxiv", "hugging face papers", "hf papers"]);
}

function isPaperArticle(article) {
  const tags = getArticleTags(article);
  const paperSource = isPaperSource(article);
  if (paperSource) {
    return true;
  }
  if (tags.includes("论文")) {
    return true;
  }
  return (
    ["论文", "多模态", "AI Agent", "机器人/具身智能", "机器人", "具身智能"].includes(article.category) &&
    paperSource
  );
}

function normalizeBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return ["true", "yes", "有", "开源", "代码"].some((item) => value.toLowerCase().includes(item));
  }
  return false;
}

function scoreFromValue(value, fallback) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return clampScore(value);
  }
  if (typeof value === "string") {
    if (["高", "强", "很高"].some((item) => value.includes(item))) {
      return 88;
    }
    if (["低", "弱"].some((item) => value.includes(item))) {
      return 58;
    }
  }
  return fallback;
}

function getPaperInsight(article) {
  const raw = article.paperInsight ?? {};
  const tags = getArticleTags(article);
  const text = [article.title, article.summary, article.why, article.project, tags.join(" ")].join(" ");
  const isRobotics = includesAnyText([text], ["机器人", "具身", "VLA", "SLAM", "导航", "机械臂", "robot"]);
  const isAgent = includesAnyText([text], ["Agent", "工具调用", "Tool", "多步骤"]);
  const hasCode = normalizeBoolean(raw.has_code ?? raw.hasCode) || article.actions?.includes("看代码") || includesAnyText([article.source ?? "", text], ["github", "hugging face", "code"]);
  const finalScore = article.finalScore ?? article.relevance ?? 72;
  const reproducibilityScore = hasCode ? 88 : article.actions?.includes("做项目") ? 76 : 62;
  const applicationScore = scoreFromValue(raw.application_value ?? raw.applicationValue, isRobotics || isAgent ? 88 : 72);
  const surveyScore = scoreFromValue(raw.survey_value ?? raw.surveyValue, tags.length >= 3 ? 82 : 68);
  const readabilityScore = article.difficulty === "入门" || article.difficulty === "中等" ? 80 : 66;
  const noveltyScore = Math.min(92, finalScore + (includesAnyText([text], ["new", "提出", "首次", "benchmark"]) ? 5 : 0));
  const directionScore = Math.min(96, finalScore + (isRobotics ? 8 : isAgent ? 5 : 0));
  const priority =
    raw.paper_priority_score ??
    raw.paperPriorityScore ??
    Math.round(
      directionScore * 0.28 +
        reproducibilityScore * 0.2 +
        applicationScore * 0.2 +
        noveltyScore * 0.17 +
        readabilityScore * 0.15,
    );

  return {
    direction: raw.direction || raw.research_direction || (isRobotics ? "机器人/具身智能" : isAgent ? "AI Agent" : article.category || "AI研究"),
    researchQuestion:
      raw.research_question ||
      raw.researchQuestion ||
      `这项工作试图解决 ${tags.slice(0, 2).join("、") || article.category} 场景中的关键能力瓶颈。`,
    coreMethod:
      raw.core_method ||
      raw.coreMethod ||
      article.summary ||
      "需要阅读原文的 Method / Approach 部分提炼核心方法。",
    dataset:
      raw.dataset ||
      raw.benchmark ||
      raw.dataset_benchmark ||
      "原文未标注，精读时重点查找数据集、Benchmark 与评价指标。",
    hasCode,
    reproductionDifficulty:
      raw.reproduction_difficulty ||
      raw.reproductionDifficulty ||
      (hasCode ? "中等，可从代码或开源实现切入" : "偏高，先复现指标表或核心流程"),
    undergraduateDifficulty:
      raw.undergraduate_difficulty || raw.undergraduateDifficulty || article.difficulty || "中等",
    readTime: raw.read_time || raw.readTime || article.readTime || "20-35 min",
    applicationValue:
      raw.application_value ||
      raw.applicationValue ||
      (applicationScore >= 82 ? "高：适合写进研究计划/个人陈述素材库" : "中：适合补充方向认知"),
    surveyValue:
      raw.survey_value ||
      raw.surveyValue ||
      (surveyScore >= 80 ? "高：可整理到综述脉络" : "中：可作为背景案例"),
    recommendedAction:
      raw.recommended_action || raw.recommendedAction || article.project || "先读摘要和实验，再决定是否精读全文。",
    paperPriorityScore: clampScore(priority),
    applicationScore,
    surveyScore,
  };
}

function paperPriorityScore(article) {
  return getPaperInsight(article).paperPriorityScore;
}

function taskIdForArticle(article, suffix) {
  return `article-${article.id}-${suffix}`;
}

function normalizeLearningTask(article, task, index) {
  const group = task.group || task.bucket || task.period || "本周任务";
  return {
    id: String(task.id || task.task_id || taskIdForArticle(article, `custom-${index}`)),
    group,
    title: task.title || task.name || `沉淀《${article.title}》`,
    sourceArticle: task.source_article || task.sourceArticle || article.title,
    sourceArticleId: article.id,
    type: task.type || task.task_type || (article.actions?.includes("读论文") ? "读论文" : "写分析"),
    estimate: task.estimate || task.time || task.duration || "30 min",
    difficulty: task.difficulty || article.difficulty || "中等",
    skills: Array.isArray(task.skills) ? task.skills : getArticleTags(article).slice(0, 3),
    why: task.why || task.reason || article.why,
    doneCriteria: task.done_criteria || task.doneCriteria || task.acceptance || "形成可复用的笔记或清单。",
    output: task.output || task.deliverable || task.final_output || "一页学习笔记",
    selected: false,
  };
}

function fallbackTaskType(article) {
  if (article.actions?.includes("读论文")) {
    return "读论文";
  }
  if (article.actions?.includes("看代码")) {
    return "看代码";
  }
  if (article.category === "AI产品") {
    return "写分析";
  }
  if (article.actions?.includes("做项目")) {
    return "做项目";
  }
  return "申请沉淀";
}

function buildFallbackLearningTasks(article) {
  const skills = getArticleTags(article).slice(0, 3);
  const taskType = fallbackTaskType(article);
  return [
    {
      id: taskIdForArticle(article, "30m"),
      group: "今日 30 分钟",
      title: `快速判断：${article.title}`,
      sourceArticle: article.title,
      sourceArticleId: article.id,
      type: taskType,
      estimate: "30 min",
      difficulty: article.difficulty || "中等",
      skills,
      why: article.why,
      doneCriteria: "写下 3 个关键词、1 句价值判断和是否继续精读。",
      output: "3 行速读卡片",
    },
    {
      id: taskIdForArticle(article, "90m"),
      group: "今日 90 分钟",
      title: `${taskType === "读论文" ? "精读论文" : taskType === "看代码" ? "看代码结构" : "拆解案例"}：${article.category}`,
      sourceArticle: article.title,
      sourceArticleId: article.id,
      type: taskType,
      estimate: "90 min",
      difficulty: article.difficulty || "中等",
      skills,
      why: article.studentValue || article.why,
      doneCriteria: "完成问题、方法、证据、局限和下一步行动五栏记录。",
      output: taskType === "写分析" ? "产品分析卡" : "结构化阅读笔记",
    },
    {
      id: taskIdForArticle(article, "week"),
      group: "本周任务",
      title: `把 ${article.category} 动态转成作品集素材`,
      sourceArticle: article.title,
      sourceArticleId: article.id,
      type: article.actions?.includes("做项目") ? "做项目" : "申请沉淀",
      estimate: "2-3 h",
      difficulty: "中等",
      skills,
      why: article.researchValue || "把零散资讯沉淀成申请和项目素材。",
      doneCriteria: "产出 1 页图文说明，包含背景、方法、个人理解和可延展项目。",
      output: "申请素材卡 / 项目想法页",
    },
    {
      id: taskIdForArticle(article, "route"),
      group: "四周路线",
      title: `围绕 ${skills[0] || article.category} 做一个小闭环`,
      sourceArticle: article.title,
      sourceArticleId: article.id,
      type: "做项目",
      estimate: "4 weeks",
      difficulty: "进阶",
      skills,
      why: article.project,
      doneCriteria: "完成资料调研、最小实验、结果记录和复盘展示。",
      output: "可展示的小项目 README",
    },
  ];
}

function getArticleLearningTasks(article) {
  if (Array.isArray(article.learningTasks) && article.learningTasks.length) {
    return article.learningTasks.map((task, index) => normalizeLearningTask(article, task, index));
  }
  return buildFallbackLearningTasks(article);
}

function getPrimaryLearningTask(article) {
  return getArticleLearningTasks(article)[0];
}

function buildLearningTaskPlan(sourceArticles, selectedLearningTaskIds) {
  const tasks = sourceArticles.flatMap((article) => getArticleLearningTasks(article));
  const uniqueTasks = Array.from(new Map(tasks.map((task) => [task.id, task])).values());
  const sortedTasks = uniqueTasks.sort((left, right) => {
    const leftSelected = selectedLearningTaskIds.has(left.id) ? 1 : 0;
    const rightSelected = selectedLearningTaskIds.has(right.id) ? 1 : 0;
    if (leftSelected !== rightSelected) {
      return rightSelected - leftSelected;
    }
    const leftArticle = sourceArticles.find((article) => article.id === left.sourceArticleId);
    const rightArticle = sourceArticles.find((article) => article.id === right.sourceArticleId);
    return (rightArticle?.finalScore ?? 0) - (leftArticle?.finalScore ?? 0);
  });

  const groupLimits = {
    "今日 30 分钟": 4,
    "今日 90 分钟": 3,
    本周任务: 5,
    四周路线: 3,
  };
  const groupCounts = {};
  return sortedTasks.filter((task) => {
    groupCounts[task.group] = groupCounts[task.group] ?? 0;
    if (groupCounts[task.group] >= (groupLimits[task.group] ?? 4)) {
      return false;
    }
    groupCounts[task.group] += 1;
    return true;
  });
}

function hydrateFeedArticle(article, index) {
  const score = article.final_score ?? article.score ?? 72;
  const tags = Array.isArray(article.tags) && article.tags.length ? article.tags : [article.category ?? "AI新闻"];
  const relevance = article.relevance_score ?? Math.min(99, Math.max(58, score + (tags.some((tag) => ["机器人", "具身智能", "机器人/具身智能", "AI Agent", "多模态"].includes(tag)) ? 8 : 0)));
  const publishedAt = article.published_at ?? article.publishedAt ?? new Date().toISOString();
  const topic = article.topic || inferTopic({ ...article, tags, knowledge: tags });
  const contentType = article.content_type || article.contentType || inferContentType({ ...article, tags, knowledge: tags, topic });
  const normalizedArticle = { ...article, tags, topic, contentType };
  const studentDailyBreakdown = computeStudentDailyScores(normalizedArticle);
  const studentReason =
    article.student_reason ||
    article.studentReason ||
    article.why_it_matters ||
    article.importance ||
    `它能帮你判断 ${topic} 方向的新问题、新方法或产品机会，适合转成可复用素材。`;
  const nextAction =
    article.next_action ||
    article.nextAction ||
    article.action_suggestion ||
    (contentType === "paper"
      ? "用 30 分钟读 Abstract、Introduction 和实验表，记录研究问题与可复现线索。"
      : contentType === "product"
        ? "画一张用户痛点、功能链路、AI 能力和竞品对照的产品分析卡。"
        : contentType === "open_source" || contentType === "tool"
          ? "打开项目页，跑通 README 中最小示例并记录依赖和输入输出。"
          : "收藏后写 3 条学习笔记：发生了什么、为什么重要、下一步能做什么。");

  return {
    id: article.id ?? index + 1,
    title: article.title,
    url: article.url,
    source: article.source ?? "AI Radar",
    publishedAt,
    time: article.time ?? formatFeedTime(publishedAt),
    category: article.category ?? "AI新闻",
    tags,
    contentType,
    topic,
    finalScore: score,
    credibility: article.credibility_score ?? Math.min(99, Math.max(60, score + 6)),
    heat: article.trend_score ?? Math.min(99, Math.max(55, score)),
    spamScore: article.spam_score ?? article.spamScore ?? 0,
    relevance,
    studentDailyScore: article.student_daily_score ?? article.studentDailyScore ?? studentDailyBreakdown.student_daily_score,
    studentDailyBreakdown,
    summary: article.tldr || article.one_sentence_summary || article.summary || "这条内容来自自动采集源，建议打开原文进一步判断价值。",
    why: article.why_it_matters || article.importance || `来自 ${article.source ?? "可信来源"}，与 ${tags.slice(0, 3).join("、")} 相关，适合纳入每日 AI 情报追踪。`,
    studentValue: article.student_value || article.audience || "适合作为学习、科研申请或产品分析素材。",
    studentFit: article.student_fit || article.studentFit || (score >= 86 ? "适合重点跟进的本科高年级/申请准备学生" : "适合建立方向认知的本科生"),
    studentReason,
    researchValue: article.research_value || "可提炼为研究计划或论文阅读素材。",
    pmValue: article.pm_value || "可转化为产品分析卡片。",
    difficulty: article.difficulty || "中等",
    readTime: article.read_time || "3 min",
    nextAction,
    saveAs: getSaveAs(normalizedArticle),
    readingMode:
      article.reading_mode ||
      article.readingMode ||
      (contentType === "paper" ? (score >= 84 ? "精读" : "略读") : score >= 82 ? "重点读" : "快速扫读"),
    projectTask:
      article.project_task ||
      article.projectTask ||
      (contentType === "open_source" || contentType === "tool"
        ? "跑通最小示例，记录安装步骤、输入输出和一个可改进点。"
        : "把关键结论转成一个 1 页实验或项目想法。"),
    productInsight:
      article.product_insight ||
      article.productInsight ||
      "从目标用户、痛点、核心链路、AI 能力和可模仿功能五个角度拆解。",
    actions: buildActions({ ...article, tags }),
    knowledge: tags.slice(0, 4),
    paperInsight: article.paper_insight ?? article.paperInsight ?? null,
    learningTasks: article.learning_tasks ?? article.learningTasks ?? null,
    project:
      nextAction ||
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
              {item === "我的素材库" && favoritesCount > 0 ? (
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

function TopBar({ query, setQuery, refreshCount, onRefresh, meta, loadedCount, compact = false }) {
  const stats = meta
    ? [
        `采集 ${meta.collected_count ?? loadedCount}`,
        `过滤 ${meta.filtered_count ?? 0}`,
        `保留 ${meta.kept_count ?? loadedCount}`,
        `来源 ${meta.source_count ?? "-"}`,
      ]
    : [`已加载 ${loadedCount} 条`];

  return (
    <header className={compact ? "topbar glass-panel compact-topbar" : "topbar glass-panel"}>
      <div className="date-block">
        <CalendarDays size={19} />
        <div>
          <span>{getBeijingDisplayDate()}</span>
          <strong>学生 AI 情报转化</strong>
        </div>
      </div>

      {!compact ? (
        <label className="search-box">
          <Search size={18} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索机器人、Agent、论文、产品..."
            aria-label="搜索情报"
          />
        </label>
      ) : null}

      <div className="top-stats" aria-label="今日统计">
        {stats.map((item) => (
          <span key={item}>{item}</span>
        ))}
        <span>{meta?.schedule_label ?? scheduleLabel}</span>
      </div>

      {!compact ? (
        <button className="icon-button primary" onClick={onRefresh} type="button">
          <RefreshCcw size={18} />
          <span>刷新 {refreshCount ? `+${refreshCount}` : ""}</span>
        </button>
      ) : null}
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

function ArticleCard({ article, favorite, learningTaskSelected, scoreLabel = "推荐分", scoreValue, onToggleFavorite, onToggleLearningTask }) {
  const relevanceTone = article.relevance > 90 ? "green" : "cyan";
  const finalScore = scoreValue ?? article.finalScore ?? article.relevance;
  const articleUrl = getSafeArticleUrl(article.url);
  const primaryLearningTask = getPrimaryLearningTask(article);

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
        <div className="student-fields">
          <div>
            <span>为什么值得学生看</span>
            <strong>{article.studentReason}</strong>
          </div>
          <div>
            <span>适合谁看</span>
            <strong>{article.studentFit}</strong>
          </div>
          <div>
            <span>阅读难度</span>
            <strong>{article.difficulty} · {article.readTime}</strong>
          </div>
        </div>
        <div className="project-line">
          <Target size={16} />
          <span>
            <strong>今日行动建议</strong>
            {article.nextAction}
          </span>
        </div>
        <div className="save-as-row">
          <span>可沉淀为</span>
          {article.saveAs.map((item) => (
            <em key={item}>{item}</em>
          ))}
        </div>
      </div>

      <div className="article-side">
        <div className="final-score">
          <span>{scoreLabel}</span>
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
          <button
            className={learningTaskSelected ? "action learning active" : "action learning"}
            onClick={() => onToggleLearningTask?.(primaryLearningTask.id)}
            type="button"
          >
            <GraduationCap size={15} />
            <span>{learningTaskSelected ? "已加入计划" : "加入学习计划"}</span>
          </button>
        </div>
      </div>
    </article>
  );
}

function DailyArticleCard({ article, favorite, highlighted, onToggleFavorite, articleRef }) {
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const articleUrl = getSafeArticleUrl(article.url);
  const score = article.student_score ?? article.studentDailyScore ?? 0;

  return (
    <article ref={articleRef} className={highlighted ? "daily-article-card glass-panel highlighted" : "daily-article-card glass-panel"}>
      <div className="daily-rank">No.{article.rank}</div>
      <div className="daily-article-body">
        <div className="article-meta">
          <span>{article.source}</span>
          <span>{article.time}</span>
          <span>{article.category}</span>
        </div>
        <h2>
          {articleUrl ? (
            <a className="article-title-link" href={articleUrl} target="_blank" rel="noopener noreferrer" title="打开原文">
              {article.title}
            </a>
          ) : (
            article.title
          )}
        </h2>
        <p className="summary">{article.summary}</p>
        <p className="why">
          <ShieldCheck size={16} />
          {article.student_reason}
        </p>
        <div className="project-line">
          <Target size={16} />
          <span>
            <strong>行动建议</strong>
            {article.action_suggestion}
          </span>
        </div>
        <div className="daily-meta-row">
          <span>难度 {article.difficulty}</span>
          <span>阅读 {article.reading_time}</span>
        </div>
        <div className="save-as-row">
          <span>标签</span>
          {[...(article.topic_tags ?? []), ...(article.use_tags ?? [])].slice(0, 6).map((item) => (
            <em key={item}>{item}</em>
          ))}
        </div>
        {analysisOpen ? (
          <div className="student-analysis">
            <InfoBlock label="适合谁看" value={article.student_value} />
            <InfoBlock label="可沉淀为" value={(article.use_tags ?? []).join("、")} />
            <InfoBlock label="可信度 / 热度 / 相关度" value={`${article.credibility} / ${article.heat} / ${article.relevance}`} />
            <InfoBlock label="学生评分拆解" value={`学习价值 ${article.studentDailyBreakdown?.learning_value ?? "-"}，噪声扣分 ${article.studentDailyBreakdown?.noise_penalty ?? 0}`} />
          </div>
        ) : null}
      </div>
      <div className="daily-article-side">
        <div className="daily-score">
          <span>学生必读分</span>
          <strong>{score}</strong>
          <em>{getDailyScoreLevel(score)}</em>
        </div>
        <div className="daily-action-row">
          {articleUrl ? (
            <a className="action" href={articleUrl} target="_blank" rel="noopener noreferrer">
              <ChevronRight size={15} />
              <span>打开原文</span>
            </a>
          ) : null}
          <button className="action" onClick={() => setAnalysisOpen((open) => !open)} type="button">
            <BookOpen size={15} />
            <span>学生解析</span>
          </button>
          <button className={favorite ? "action active" : "action"} onClick={onToggleFavorite} type="button">
            <Heart size={15} />
            <span>{favorite ? "已加入素材库" : "加入素材库"}</span>
          </button>
        </div>
      </div>
    </article>
  );
}

function PaperCard({ article, favorite, learningTaskSelected, onToggleFavorite, onToggleLearningTask }) {
  const insight = getPaperInsight(article);
  const articleUrl = getSafeArticleUrl(article.url);
  const primaryLearningTask = getPrimaryLearningTask(article);

  return (
    <article className="paper-card glass-panel">
      <div className="paper-card-heading">
        <div>
          <div className="article-meta">
            <span>{article.source}</span>
            <span>{article.time}</span>
            <span>{insight.direction}</span>
          </div>
          <h2>
            {articleUrl ? (
              <a className="article-title-link" href={articleUrl} target="_blank" rel="noopener noreferrer">
                {article.title}
              </a>
            ) : (
              article.title
            )}
          </h2>
        </div>
        <div className="final-score compact-score">
          <span>论文优先级</span>
          <strong>{insight.paperPriorityScore}</strong>
        </div>
      </div>

      <div className="paper-grid">
        <InfoBlock label="研究方向" value={insight.direction} />
        <InfoBlock label="一句话研究问题" value={insight.researchQuestion} />
        <InfoBlock label="方法关键词" value={insight.coreMethod} />
        <InfoBlock label="代码/数据/Benchmark" value={`${insight.hasCode ? "有代码线索" : "代码待确认"} · ${insight.dataset}`} />
        <InfoBlock label="阅读难度" value={`${insight.undergraduateDifficulty} · ${insight.readTime}`} />
        <InfoBlock label="推荐阅读方式" value={article.readingMode} />
        <InfoBlock label="读前需要补充" value={article.knowledge.join("、") || "线性代数、深度学习基础、论文实验读法"} />
        <InfoBlock label="30分钟阅读任务" value={insight.recommendedAction} />
      </div>

      <div className="save-as-row">
        <span>可转化为</span>
        {["研究计划素材", "课程项目", "毕设选题", "竞赛方向"].map((item) => (
          <em key={item}>{item}</em>
        ))}
      </div>

      <div className="action-row paper-actions">
        <button className={favorite ? "action active" : "action"} onClick={onToggleFavorite} type="button">
          <Heart size={15} />
          <span>{favorite ? "已收藏" : "收藏"}</span>
        </button>
        <button
          className={learningTaskSelected ? "action learning active" : "action learning"}
          onClick={() => onToggleLearningTask?.(primaryLearningTask.id)}
          type="button"
        >
          <GraduationCap size={15} />
          <span>{learningTaskSelected ? "已加入计划" : "加入学习计划"}</span>
        </button>
      </div>
    </article>
  );
}

function InfoBlock({ label, value }) {
  return (
    <div className="info-block">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PaperRadar({ articles: sourceArticles, favorites, selectedLearningTasks, onToggleFavorite, onToggleLearningTask }) {
  const [activeTab, setActiveTab] = useState("今日必读");
  const papers = sourceArticles.filter(isPaperArticle).sort((left, right) => paperPriorityScore(right) - paperPriorityScore(left));
  const stats = {
    today: papers.filter((article) => isWithinHours(article.publishedAt, 24)).length,
    deepRead: papers.filter((article) => getPaperInsight(article).paperPriorityScore >= 82).length,
    reproducible: papers.filter((article) => getPaperInsight(article).hasCode).length,
    application: papers.filter((article) => getPaperInsight(article).applicationScore >= 80).length,
    robotics: papers.filter((article) => getPaperInsight(article).direction === "机器人/具身智能").length,
  };
  const tabs = ["今日必读", "可复现", "申请素材", "综述素材", "暂存池"];
  const visiblePapers = papers.filter((article) => {
    const insight = getPaperInsight(article);
    if (activeTab === "可复现") return insight.hasCode;
    if (activeTab === "申请素材") return insight.applicationScore >= 80;
    if (activeTab === "综述素材") return insight.surveyScore >= 78;
    if (activeTab === "暂存池") return insight.paperPriorityScore < 76;
    return true;
  });

  return (
    <div className="tool-page">
      <section className="metric-strip">
        <MetricCard label="今日论文" value={stats.today} />
        <MetricCard label="建议精读" value={stats.deepRead} />
        <MetricCard label="可复现" value={stats.reproducible} />
        <MetricCard label="申请素材" value={stats.application} />
        <MetricCard label="具身论文" value={stats.robotics} />
      </section>
      <div className="inner-tabs">
        {tabs.map((tab) => (
          <button className={activeTab === tab ? "selected" : ""} key={tab} onClick={() => setActiveTab(tab)} type="button">
            {tab}
          </button>
        ))}
      </div>
      <div className="article-list">
        {visiblePapers.map((article) => (
          <PaperCard
            article={article}
            favorite={favorites.has(article.id)}
            key={article.id}
            learningTaskSelected={selectedLearningTasks.has(getPrimaryLearningTask(article).id)}
            onToggleFavorite={() => onToggleFavorite(article.id)}
            onToggleLearningTask={onToggleLearningTask}
          />
        ))}
        {!visiblePapers.length ? <EmptyState text="当前筛选下没有论文，可以切换 tab 或等待下一次采集。" /> : null}
      </div>
    </div>
  );
}

function MetricCard({ label, value }) {
  return (
    <div className="metric-card glass-panel">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function ProjectLab({ articles: sourceArticles, favorites, selectedLearningTasks, onToggleFavorite, onToggleLearningTask }) {
  const projectItems = sourceArticles
    .filter((article) =>
      ["open_source", "tool"].includes(article.contentType) ||
      article.actions.includes("看代码") ||
      getPaperInsight(article).hasCode ||
      includesAnyText([article.source, article.title], ["GitHub", "Hugging Face"]),
    )
    .sort(sortByScoreAndTime);

  return (
    <div className="card-lab-grid">
      {projectItems.map((article) => (
        <ProjectCard
          article={article}
          favorite={favorites.has(article.id)}
          key={article.id}
          learningTaskSelected={selectedLearningTasks.has(getPrimaryLearningTask(article).id)}
          onToggleFavorite={() => onToggleFavorite(article.id)}
          onToggleLearningTask={onToggleLearningTask}
        />
      ))}
      {!projectItems.length ? <EmptyState text="当前筛选下暂无可实验项目，试试切到开源项目或论文分类。" /> : null}
    </div>
  );
}

function ProjectCard({ article, favorite, learningTaskSelected, onToggleFavorite, onToggleLearningTask }) {
  const articleUrl = getSafeArticleUrl(article.url);
  const primaryLearningTask = getPrimaryLearningTask(article);
  const duration = article.difficulty === "入门" ? "30分钟" : article.finalScore >= 86 ? "1天" : "2小时";

  return (
    <article className="transform-card glass-panel">
      <div className="article-meta">
        <span>{article.source}</span>
        <span>{article.topic}</span>
      </div>
      <h2>
        {articleUrl ? (
          <a className="article-title-link" href={articleUrl} target="_blank" rel="noopener noreferrer">
            {article.title}
          </a>
        ) : (
          article.title
        )}
      </h2>
      <div className="paper-grid">
        <InfoBlock label="适合方向" value={article.topic} />
        <InfoBlock label="上手难度" value={article.difficulty} />
        <InfoBlock label="预计耗时" value={duration} />
        <InfoBlock label="可以完成的小任务" value={article.projectTask} />
        <InfoBlock label="最终产出物" value="最小 demo、复现实验记录或 README 展示页" />
        <InfoBlock label="适合沉淀为" value="课程作业 / 竞赛demo / 简历项目 / 申请项目经历" />
      </div>
      <CardActions
        favorite={favorite}
        learningTaskSelected={learningTaskSelected}
        onToggleFavorite={onToggleFavorite}
        onToggleLearningTask={() => onToggleLearningTask(primaryLearningTask.id)}
      />
    </article>
  );
}

function ProductObservation({ articles: sourceArticles, favorites, selectedLearningTasks, onToggleFavorite, onToggleLearningTask }) {
  const productItems = sourceArticles
    .filter((article) => article.contentType === "product" || article.category === "AI产品" || article.topic === "AI产品")
    .sort(sortByScoreAndTime);

  return (
    <div className="card-lab-grid">
      {productItems.map((article) => (
        <ProductCard
          article={article}
          favorite={favorites.has(article.id)}
          key={article.id}
          learningTaskSelected={selectedLearningTasks.has(getPrimaryLearningTask(article).id)}
          onToggleFavorite={() => onToggleFavorite(article.id)}
          onToggleLearningTask={onToggleLearningTask}
        />
      ))}
      {!productItems.length ? <EmptyState text="当前筛选下暂无产品案例，试试切到 AI产品 或 Agent 分类。" /> : null}
    </div>
  );
}

function ProductCard({ article, favorite, learningTaskSelected, onToggleFavorite, onToggleLearningTask }) {
  const articleUrl = getSafeArticleUrl(article.url);
  const primaryLearningTask = getPrimaryLearningTask(article);

  return (
    <article className="transform-card glass-panel product-card">
      <div className="article-meta">
        <span>{article.source}</span>
        <span>{article.time}</span>
      </div>
      <h2>
        {articleUrl ? (
          <a className="article-title-link" href={articleUrl} target="_blank" rel="noopener noreferrer">
            {article.title}
          </a>
        ) : (
          article.title
        )}
      </h2>
      <div className="paper-grid">
        <InfoBlock label="目标用户" value={article.studentFit} />
        <InfoBlock label="解决的痛点" value={article.studentReason} />
        <InfoBlock label="核心功能链路" value={article.productInsight} />
        <InfoBlock label="使用的AI能力" value={article.knowledge.join("、") || article.topic} />
        <InfoBlock label="竞品或相似产品" value="同类 AI Agent、Copilot、自动化工作流或垂直工具" />
        <InfoBlock label="产品思维启发" value={article.pmValue} />
        <InfoBlock label="可模仿的小功能" value="做一个输入内容、生成结构化卡片、支持导出的最小功能闭环" />
      </div>
      <CardActions
        favorite={favorite}
        learningTaskSelected={learningTaskSelected}
        onToggleFavorite={onToggleFavorite}
        onToggleLearningTask={() => onToggleLearningTask(primaryLearningTask.id)}
      />
    </article>
  );
}

function CardActions({ favorite, learningTaskSelected, onToggleFavorite, onToggleLearningTask }) {
  return (
    <div className="action-row paper-actions">
      <button className={favorite ? "action active" : "action"} onClick={onToggleFavorite} type="button">
        <Heart size={15} />
        <span>{favorite ? "已收藏" : "收藏"}</span>
      </button>
      <button className={learningTaskSelected ? "action learning active" : "action learning"} onClick={onToggleLearningTask} type="button">
        <GraduationCap size={15} />
        <span>{learningTaskSelected ? "已加入计划" : "加入学习计划"}</span>
      </button>
    </div>
  );
}

function MaterialLibrary({ articles: sourceArticles, favorites, materialPurposesById, onSetMaterialPurpose }) {
  const savedArticles = sourceArticles.filter((article) => favorites.has(article.id));
  const grouped = materialPurposes.reduce((acc, purpose) => {
    acc[purpose] = [];
    return acc;
  }, {});
  savedArticles.forEach((article) => {
    const purpose = materialPurposesById[article.id] || "暂存";
    (grouped[purpose] ?? grouped["暂存"]).push(article);
  });

  return (
    <div className="material-library">
      {materialPurposes.map((purpose) => (
        <section className="material-bucket glass-panel" key={purpose}>
          <div className="bucket-heading">
            <h3>{purpose}</h3>
            <span>{grouped[purpose].length}</span>
          </div>
          <div className="bucket-list">
            {grouped[purpose].map((article) => (
              <article className="bucket-item" key={article.id}>
                <strong>{article.title}</strong>
                <p>{article.summary}</p>
                <select value={materialPurposesById[article.id] || "暂存"} onChange={(event) => onSetMaterialPurpose(article.id, event.target.value)}>
                  {materialPurposes.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </article>
            ))}
            {!grouped[purpose].length ? <span className="bucket-empty">暂无内容</span> : null}
          </div>
        </section>
      ))}
      {!savedArticles.length ? <EmptyState text="还没有收藏内容。收藏后会先进入暂存，再按用途整理成素材库。" /> : null}
    </div>
  );
}

function LearningPlan({ sourceArticles, favorites, selectedLearningTasks, completedTaskIds, onToggleTaskDone }) {
  const priorityArticles = sourceArticles.filter((article) => isWithinDays(article.publishedAt, 3)).sort(sortByScoreAndTime);
  const selectedArticles = priorityArticles.filter((article) => selectedLearningTasks.has(getPrimaryLearningTask(article).id));
  const favoriteArticles = priorityArticles.filter((article) => favorites.has(article.id));
  const taskSource = [...selectedArticles, ...favoriteArticles, ...priorityArticles].filter(
    (article, index, array) => array.findIndex((item) => item.id === article.id) === index,
  );
  const tasks = buildStudentPlanTasks(taskSource);
  const completedCount = tasks.filter((task) => completedTaskIds.has(task.id)).length;
  const groups = ["今日30分钟计划", "今日60分钟计划", "本周能力补强", "本周产出目标"];

  return (
    <div className="learning-page">
      <section className="learning-progress glass-panel">
        <div>
          <div className="section-label">
            <GraduationCap size={17} />
            学习计划
          </div>
          <h2>把今天看到的情报变成可交付任务</h2>
        </div>
        <strong>{completedCount}/{tasks.length}</strong>
        <span>本周完成</span>
      </section>
      {groups.map((group) => (
        <section className="task-section" key={group}>
          <h3>{group}</h3>
          <div className="task-grid">
            {tasks.filter((task) => task.group === group).map((task) => (
              <TaskCard
                completed={completedTaskIds.has(task.id)}
                key={task.id}
                task={task}
                onToggleDone={() => onToggleTaskDone(task.id)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function buildStudentPlanTasks(sourceArticles) {
  const topArticles = sourceArticles.slice(0, 8);
  const fallback = topArticles.length ? topArticles : articles.map(hydrateFeedArticle).slice(0, 4);
  const baseTasks = fallback.flatMap((article) => getArticleLearningTasks(article));
  const compact = [];

  if (fallback[0]) {
    compact.push({
      id: `daily-30-${fallback[0].id}`,
      group: "今日30分钟计划",
      title: "10分钟读学生解析，15分钟拆一篇论文/案例，5分钟写3条笔记",
      sourceArticle: fallback[0].title,
      type: fallback[0].contentType === "paper" ? "读论文" : "写分析",
      estimate: "30 min",
      difficulty: fallback[0].difficulty,
      skills: fallback[0].knowledge,
      why: fallback[0].studentReason,
      doneCriteria: "完成 3 条可沉淀笔记，并决定是否收藏。",
      output: "3 条学习笔记",
    });
  }
  if (fallback[1]) {
    compact.push({
      id: `daily-60-${fallback[1].id}`,
      group: "今日60分钟计划",
      title: `精读/拆解：${fallback[1].title}`,
      sourceArticle: fallback[1].title,
      type: fallback[1].contentType === "open_source" ? "看代码" : fallback[1].contentType === "paper" ? "读论文" : "写分析",
      estimate: "60 min",
      difficulty: fallback[1].difficulty,
      skills: fallback[1].knowledge,
      why: fallback[1].why,
      doneCriteria: "整理问题、方法、证据、局限和下一步行动。",
      output: fallback[1].contentType === "product" ? "产品分析卡" : "结构化阅读卡",
    });
  }

  baseTasks.slice(0, 4).forEach((task, index) => {
    compact.push({
      ...task,
      id: `skill-${task.id}`,
      group: "本周能力补强",
      estimate: task.estimate === "4 weeks" ? "2 h" : task.estimate,
      title: task.title,
    });
    if (index < 3) {
      compact.push({
        ...task,
        id: `output-${task.id}`,
        group: "本周产出目标",
        title: `产出物：${task.output}`,
        estimate: "1-2 h",
        doneCriteria: "能放进素材库、README、课程汇报或申请素材。",
      });
    }
  });

  return Array.from(new Map(compact.map((task) => [task.id, task])).values()).slice(0, 12);
}

function TaskCard({ task, completed, onToggleDone }) {
  return (
    <article className={completed ? "task-card glass-panel completed" : "task-card glass-panel"}>
      <div className="task-card-top">
        <span>{task.type}</span>
        <button className={completed ? "action active" : "action"} onClick={onToggleDone} type="button">
          <CheckCircle2 size={15} />
          {completed ? "已完成" : "标记完成"}
        </button>
      </div>
      <h4>{task.title}</h4>
      <p>{task.sourceArticle}</p>
      <div className="paper-grid">
        <InfoBlock label="预计时间" value={task.estimate} />
        <InfoBlock label="难度" value={task.difficulty} />
        <InfoBlock label="关联技能" value={(task.skills ?? []).join("、") || "AI 阅读与表达"} />
        <InfoBlock label="为什么做" value={task.why} />
        <InfoBlock label="完成标准" value={task.doneCriteria} />
        <InfoBlock label="最终产出物" value={task.output} />
      </div>
    </article>
  );
}

function EmptyState({ text }) {
  return (
    <div className="empty-state glass-panel">
      <Star size={22} />
      <strong>没有匹配内容</strong>
      <span>{text}</span>
    </div>
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

function rankWeight(rank) {
  if (rank === 1) {
    return 1.3;
  }
  if (rank <= 3) {
    return 1.15;
  }
  if (rank <= 6) {
    return 1;
  }
  return 0.85;
}

function buildDailyTrendItems(articles) {
  const map = new Map();
  articles.forEach((article, index) => {
    const rank = article.rank ?? index + 1;
    const weight = ((article.student_score ?? article.studentDailyScore ?? 70) / 100) * rankWeight(rank);
    (article.topic_tags ?? extractDailyTopicTags(article)).slice(0, 3).forEach((topic) => {
      const current = map.get(topic) ?? { topic, heat: 0, count: 0, ranks: [] };
      current.heat += weight;
      current.count += 1;
      current.ranks.push(rank);
      map.set(topic, current);
    });
  });
  return Array.from(map.values())
    .sort((left, right) => right.heat - left.heat)
    .slice(0, 4);
}

function DailyTrendPanel({ articles }) {
  const trends = buildDailyTrendItems(articles);
  const maxHeat = Math.max(...trends.map((trend) => trend.heat), 1);

  return (
    <section className="side-panel glass-panel daily-side-panel">
      <div className="panel-heading stacked">
        <div>
          <div className="panel-title-line">
            <TrendingUp size={18} />
            <h3>Top10 热点趋势</h3>
          </div>
          <p>基于今日 10 条必读资讯自动生成</p>
        </div>
      </div>
      <div className="trend-list">
        {trends.map((trend) => (
          <div className="trend-item daily-trend-item" key={trend.topic} title={`命中：${trend.ranks.map((rank) => `No.${rank}`).join("、")}`}>
            <div>
              <span>{trend.topic}</span>
              <strong>{trend.count}/10</strong>
            </div>
            <div className="meter" aria-label={`${trend.topic} 命中 ${trend.count} 条`}>
              <i style={{ width: `${Math.max(18, (trend.heat / maxHeat) * 100)}%` }} />
            </div>
          </div>
        ))}
        {!trends.length ? <p className="side-empty">等待 Top10 数据生成趋势</p> : null}
      </div>
    </section>
  );
}

function buildReadingRecommendations(articles) {
  if (!articles.length) {
    return [];
  }
  const recommendations = [];
  const first = articles[0];
  recommendations.push({
    id: `main-${first.id}`,
    article: first,
    title: `先读 No.${first.rank}: 建立今日主线`,
    reason: "这是今天学生必读分最高的内容，适合先读，帮助你理解今天最重要的 AI 变化。",
    output: first.use_tags?.[0] ?? "学习笔记",
  });

  const learningKeywords = ["项目灵感", "论文选题", "学习资源", "工具上手", "课程汇报", "学习笔记"];
  const learning = articles.find((article) => article.id !== first.id && article.use_tags?.some((tag) => learningKeywords.includes(tag))) ?? articles[1];
  if (learning) {
    recommendations.push({
      id: `learning-${learning.id}`,
      article: learning,
      title: `再读 No.${learning.rank}: 转化为项目 / 论文灵感`,
      reason: `它适合从 ${learning.topic_tags?.[0] ?? learning.category} 切入，整理成可执行的小任务或阅读卡。`,
      output: learning.use_tags?.find((tag) => learningKeywords.includes(tag)) ?? learning.use_tags?.[0] ?? "项目灵感",
    });
  }

  const saveKeywords = ["申请素材", "产品案例", "开源工具", "研究方向", "长期趋势"];
  const usedIds = new Set(recommendations.map((item) => item.article.id));
  const saved = articles.find((article) => !usedIds.has(article.id) && article.use_tags?.some((tag) => saveKeywords.includes(tag))) ??
    articles.find((article) => !usedIds.has(article.id));
  if (saved) {
    recommendations.push({
      id: `save-${saved.id}`,
      article: saved,
      title: `收藏 No.${saved.rank}: 加入长期素材库`,
      reason: `它更适合长期追踪，可沉淀为 ${saved.use_tags?.[0] ?? "申请素材"}。`,
      output: saved.use_tags?.find((tag) => saveKeywords.includes(tag)) ?? saved.use_tags?.[0] ?? "申请素材",
    });
  }

  return recommendations.slice(0, Math.min(3, articles.length));
}

function DailyReadingPanel({ articles, onJumpToArticle }) {
  const recommendations = buildReadingRecommendations(articles);

  return (
    <section className="side-panel glass-panel daily-side-panel">
      <div className="panel-heading stacked">
        <div>
          <div className="panel-title-line">
            <BookOpen size={18} />
            <h3>我该读什么</h3>
          </div>
          <p>根据今日 Top10 自动推荐阅读顺序</p>
        </div>
      </div>
      <ol className="daily-reading-list">
        {recommendations.map((item) => (
          <li key={item.id}>
            <button onClick={() => onJumpToArticle(item.article.id)} type="button">
              <strong>{item.title}</strong>
              <span>{item.reason}</span>
              <em>可转化成: {item.output}</em>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

function TodaySidePanels({ articles, onJumpToArticle }) {
  return (
    <>
      <DailyTrendPanel articles={articles} />
      <DailyReadingPanel articles={articles} onJumpToArticle={onJumpToArticle} />
    </>
  );
}

function ContextRail({ activeNav, articles: railArticles, favorites, selectedLearningTasks, completedTaskIds, onJumpToArticle }) {
  if (activeNav === "今日必读") {
    return <TodaySidePanels articles={railArticles} onJumpToArticle={onJumpToArticle} />;
  }

  if (activeNav === "论文雷达") {
    const papers = railArticles.filter(isPaperArticle).sort((left, right) => paperPriorityScore(right) - paperPriorityScore(left));
    const reproducible = papers.filter((article) => getPaperInsight(article).hasCode);
    const applicationReady = papers.filter((article) => getPaperInsight(article).applicationScore >= 80);
    return (
      <>
        <SimplePanel icon={BookOpen} title="本周论文阅读漏斗" items={[`待扫读 ${papers.length} 篇`, `建议精读 ${papers.filter((item) => paperPriorityScore(item) >= 82).length} 篇`, `可复现 ${reproducible.length} 篇`]} />
        <SimplePanel icon={Target} title="推荐精读方向" items={topTopics(papers).map((item) => `${item.topic} · ${item.count} 篇`)} />
        <SimplePanel icon={Archive} title="申请素材论文" items={applicationReady.slice(0, 4).map((item) => item.title)} />
        <SimplePanel icon={Code2} title="可复现论文" items={reproducible.slice(0, 4).map((item) => item.title)} />
      </>
    );
  }

  if (activeNav === "学习计划") {
    const totalTasks = buildStudentPlanTasks(railArticles).length;
    const completed = Array.from(completedTaskIds).length;
    return (
      <>
        <SimplePanel icon={Target} title="本周目标" items={["完成 1 篇论文阅读卡", "做 1 个项目 idea", "整理 1 张产品分析卡", "沉淀 1 条申请素材"]} />
        <SimplePanel icon={Gauge} title="能力短板" items={topTopics(railArticles).map((item) => `${item.topic} 需要补强`)} />
        <SimplePanel icon={FolderOpen} title="产出物清单" items={["论文阅读卡", "项目 README", "产品分析卡", "申请素材段落"]} />
        <SimplePanel icon={CheckCircle2} title="完成进度" items={[`已完成 ${completed}/${totalTasks}`, `已加入计划 ${selectedLearningTasks.size} 项`, `收藏可转任务 ${favorites.size} 条`]} />
      </>
    );
  }

  if (activeNav === "项目实验室") {
    return (
      <>
        <SimplePanel icon={Code2} title="适合今天动手" items={railArticles.slice(0, 4).map((item) => item.projectTask)} />
        <SimplePanel icon={Target} title="项目产出方向" items={["课程作业", "竞赛 demo", "简历项目", "申请项目经历"]} />
        <SkillPanel />
      </>
    );
  }

  if (activeNav === "产品观察") {
    return (
      <>
        <SimplePanel icon={Layers3} title="产品拆解角度" items={["目标用户", "核心痛点", "AI 能力链路", "竞品与可模仿功能"]} />
        <SimplePanel icon={Sparkles} title="今日可模仿功能" items={railArticles.slice(0, 4).map((item) => item.productInsight)} />
        <MaterialPanel />
      </>
    );
  }

  if (activeNav === "我的素材库") {
    return (
      <>
        <SimplePanel icon={Archive} title="素材整理建议" items={["研究计划素材优先写背景和个人兴趣", "项目灵感优先补输入输出", "产品案例优先补用户痛点"]} />
        <SimplePanel icon={FolderOpen} title="用途分类" items={materialPurposes} />
      </>
    );
  }

  return (
    <>
      <TrendPanel />
      <ReadingPanel />
      <MaterialPanel />
      <SkillPanel />
    </>
  );
}

function SimplePanel({ icon: Icon, title, items }) {
  const normalizedItems = items?.filter(Boolean).slice(0, 5) ?? [];
  return (
    <section className="side-panel glass-panel">
      <div className="panel-heading">
        <Icon size={18} />
        <h3>{title}</h3>
      </div>
      <ol className="reading-list">
        {normalizedItems.length ? normalizedItems.map((item) => <li key={item}>{item}</li>) : <li>等待更多数据后生成建议</li>}
      </ol>
    </section>
  );
}

function topTopics(items) {
  const counts = items.reduce((acc, item) => {
    const topic = item.topic || item.category || "AI";
    acc[topic] = (acc[topic] ?? 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts)
    .map(([topic, count]) => ({ topic, count }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 4);
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
  const reportTitle = activeNav === "今日必读" ? "今日必读 · AI HOT 学生友好版 Top10" : `AI Student Radar ${activeNav}`;
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
      `- ${activeNav === "今日必读" ? "学生必读分" : "推荐分"}：${activeNav === "今日必读" ? item.studentDailyScore : item.finalScore ?? item.relevance}`,
      `- 评分：可信度 ${item.credibility}，热度 ${item.heat}，相关度 ${item.relevance}`,
      `- 摘要：${item.summary}`,
      `- 推荐理由：${item.why}`,
      `- 行动建议：${item.nextAction || item.project}`,
      `- 知识点：${item.knowledge.join("、")}`,
    );
  });

  return lines.join("\n");
}

export default function App() {
  const [activeNav, setActiveNav] = useState("今日必读");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("全部");
  const [favorites, setFavorites] = useState(() => loadFavoriteIds());
  const [selectedLearningTasks, setSelectedLearningTasks] = useState(() => loadStoredStringSet(selectedLearningTasksStorageKey));
  const [completedTaskIds, setCompletedTaskIds] = useState(() => loadStoredStringSet(completedTaskIdsStorageKey));
  const [materialPurposesById, setMaterialPurposesById] = useState(() => loadStoredObject(materialPurposesStorageKey));
  const [refreshCount, setRefreshCount] = useState(0);
  const [feedArticles, setFeedArticles] = useState(() => articles.map(hydrateFeedArticle));
  const [newsMeta, setNewsMeta] = useState(null);
  const [dailyBrief, setDailyBrief] = useState(null);
  const [clusters, setClusters] = useState([]);
  const [clusterOpen, setClusterOpen] = useState(false);
  const [highlightedArticleId, setHighlightedArticleId] = useState(null);
  const dailyArticleRefs = useRef({});

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
          setFeedArticles(articles.map(hydrateFeedArticle));
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

  useEffect(() => {
    try {
      window.localStorage.setItem(selectedLearningTasksStorageKey, JSON.stringify(Array.from(selectedLearningTasks)));
    } catch {
      // ignore localStorage errors
    }
  }, [selectedLearningTasks]);

  useEffect(() => {
    try {
      window.localStorage.setItem(completedTaskIdsStorageKey, JSON.stringify(Array.from(completedTaskIds)));
    } catch {
      // ignore localStorage errors
    }
  }, [completedTaskIds]);

  useEffect(() => {
    try {
      window.localStorage.setItem(materialPurposesStorageKey, JSON.stringify(materialPurposesById));
    } catch {
      // ignore localStorage errors
    }
  }, [materialPurposesById]);

  const filteredRecentArticles = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return feedArticles
      .filter((article) => isWithinDays(article.publishedAt, 3))
      .filter((article) => matchesCategory(article, category) && matchesSearch(article, normalizedQuery));
  }, [category, feedArticles, query]);

  const todayArticles = useMemo(() => {
    return selectStudentDailyTop10(feedArticles);
  }, [feedArticles]);

  const visibleArticles = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (activeNav === "今日必读") {
      return todayArticles;
    }
    if (activeNav === "论文雷达") {
      return filteredRecentArticles.filter(isPaperArticle);
    }
    if (activeNav === "项目实验室") {
      return filteredRecentArticles.filter((article) => ["open_source", "tool"].includes(article.contentType) || article.actions.includes("看代码"));
    }
    if (activeNav === "产品观察") {
      return filteredRecentArticles.filter((article) => article.contentType === "product" || article.topic === "AI产品");
    }
    if (activeNav === "我的素材库") {
      return feedArticles.filter((article) => favorites.has(article.id) && matchesCategory(article, category) && matchesSearch(article, normalizedQuery));
    }
    return filteredRecentArticles;
  }, [activeNav, category, favorites, feedArticles, filteredRecentArticles, query, todayArticles]);

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

  function toggleLearningTask(taskId) {
    setSelectedLearningTasks((current) => {
      const next = new Set(current);
      const normalizedId = String(taskId);
      if (next.has(normalizedId)) {
        next.delete(normalizedId);
      } else {
        next.add(normalizedId);
      }
      return next;
    });
  }

  function toggleTaskDone(taskId) {
    setCompletedTaskIds((current) => {
      const next = new Set(current);
      const normalizedId = String(taskId);
      if (next.has(normalizedId)) {
        next.delete(normalizedId);
      } else {
        next.add(normalizedId);
      }
      return next;
    });
  }

  function setMaterialPurpose(articleId, purpose) {
    setMaterialPurposesById((current) => ({
      ...current,
      [articleId]: materialPurposes.includes(purpose) ? purpose : "暂存",
    }));
  }

  function jumpToDailyArticle(articleId) {
    const target = dailyArticleRefs.current[articleId];
    if (!target) {
      return;
    }
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedArticleId(articleId);
    window.setTimeout(() => {
      setHighlightedArticleId((current) => (current === articleId ? null : current));
    }, 1000);
  }

  function exportMarkdown() {
    const markdown = buildMarkdown(visibleArticles, favorites, activeNav, activeNav === "今日必读" ? null : dailyBrief);
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

  const pageCopy = {
    今日必读: {
      label: "AI HOT 学生友好榜 Top 10",
      title: "每天从 AI HOT 精选中，为 AI 方向学生筛出最值得看的 10 条内容。不是资讯越多越好，而是帮你判断哪些值得读、哪些值得收藏、哪些可以转化成学习、项目或申请素材。",
      cluster: false,
    },
    论文雷达: {
      label: "论文决策工具",
      title: "判断哪些论文值得精读、复现和写进申请",
      cluster: false,
    },
    项目实验室: {
      label: "项目实验室",
      title: "把开源、工具和可复现论文转成小实验",
      cluster: false,
    },
    产品观察: {
      label: "产品分析卡",
      title: "从 AI 产品动态里训练 PM 视角",
      cluster: false,
    },
    我的素材库: {
      label: "收藏素材库",
      title: "按用途整理研究、项目、产品和英文阅读素材",
      cluster: false,
    },
    学习计划: {
      label: "任务规划",
      title: "把情报转成今天和本周的行动清单",
      cluster: false,
    },
  }[activeNav] ?? {
    label: activeNav,
    title: "从信息流转成学习和申请素材",
    cluster: false,
  };

  return (
    <main className={activeNav === "今日必读" ? "app-shell today-view" : "app-shell"}>
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
          compact={activeNav === "今日必读"}
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
                  {pageCopy.label}
                </div>
                <h2 className={activeNav === "今日必读" ? "daily-page-title" : undefined}>{pageCopy.title}</h2>
              </div>
              {pageCopy.cluster ? (
                <button className="ghost-button" onClick={() => setClusterOpen(true)} type="button">
                  查看聚类
                  <ChevronRight size={16} />
                </button>
              ) : null}
            </div>

            {activeNav !== "今日必读" ? <CategoryTabs selected={category} setSelected={setCategory} /> : null}

            {activeNav === "今日必读" ? (
              <>
              <div className="today-mobile-panels">
                <TodaySidePanels articles={visibleArticles} onJumpToArticle={jumpToDailyArticle} />
              </div>
              <div className="article-list">
                {visibleArticles.map((article) => (
                  <DailyArticleCard
                    articleRef={(node) => {
                      if (node) {
                        dailyArticleRefs.current[article.id] = node;
                      }
                    }}
                    article={article}
                    favorite={favorites.has(article.id)}
                    highlighted={highlightedArticleId === article.id}
                    key={article.id}
                    onToggleFavorite={() => toggleFavorite(article.id)}
                  />
                ))}
                {visibleArticles.length > 0 && visibleArticles.length < 10 ? (
                  <div className="daily-note glass-panel">AI Hot 今日高分内容不足 10 条，已展示当前相对最值得阅读内容。</div>
                ) : null}
                {visibleArticles.length === 0 ? (
                  <EmptyState text="AI HOT 精选里暂时没有满足学生必读规则的内容，可等待下一次自动采集或手动刷新。" />
                ) : null}
              </div>
              </>
            ) : null}

            {activeNav === "论文雷达" ? (
              <PaperRadar
                articles={filteredRecentArticles}
                favorites={favorites}
                selectedLearningTasks={selectedLearningTasks}
                onToggleFavorite={toggleFavorite}
                onToggleLearningTask={toggleLearningTask}
              />
            ) : null}

            {activeNav === "项目实验室" ? (
              <ProjectLab
                articles={filteredRecentArticles}
                favorites={favorites}
                selectedLearningTasks={selectedLearningTasks}
                onToggleFavorite={toggleFavorite}
                onToggleLearningTask={toggleLearningTask}
              />
            ) : null}

            {activeNav === "产品观察" ? (
              <ProductObservation
                articles={filteredRecentArticles}
                favorites={favorites}
                selectedLearningTasks={selectedLearningTasks}
                onToggleFavorite={toggleFavorite}
                onToggleLearningTask={toggleLearningTask}
              />
            ) : null}

            {activeNav === "我的素材库" ? (
              <MaterialLibrary
                articles={visibleArticles}
                favorites={favorites}
                materialPurposesById={materialPurposesById}
                onSetMaterialPurpose={setMaterialPurpose}
              />
            ) : null}

            {activeNav === "学习计划" ? (
              <LearningPlan
                completedTaskIds={completedTaskIds}
                favorites={favorites}
                selectedLearningTasks={selectedLearningTasks}
                sourceArticles={filteredRecentArticles.length ? filteredRecentArticles : feedArticles}
                onToggleTaskDone={toggleTaskDone}
              />
            ) : null}

            {activeNav !== "学习计划" ? (
              <DailySummary
                dailyBrief={activeNav === "今日必读" ? null : dailyBrief}
                favorites={favorites}
                visibleArticles={visibleArticles}
                onExport={exportMarkdown}
              />
            ) : null}
          </section>

          <aside className="right-rail">
            <ContextRail
              activeNav={activeNav}
              articles={visibleArticles.length ? visibleArticles : filteredRecentArticles}
              completedTaskIds={completedTaskIds}
              favorites={favorites}
              onJumpToArticle={jumpToDailyArticle}
              selectedLearningTasks={selectedLearningTasks}
            />
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
