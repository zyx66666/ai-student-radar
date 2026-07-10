#!/usr/bin/env python3
"""Collect AI news and papers into SQLite and export public/data/news.json.

The collector intentionally uses RSS/Atom feeds and public API-style XML first.
For sources without a stable public RSS feed, it falls back to shallow public
page link extraction instead of complex crawling.
"""

from __future__ import annotations

import argparse
import datetime as dt
import email.utils
import html
import json
import os
import re
import sqlite3
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from difflib import SequenceMatcher
from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "backend" / "data" / "news.sqlite"
JSON_PATH = ROOT / "public" / "data" / "news.json"
USER_AGENT = "AIStudentRadar/0.1 (+https://github.com/ai-student-radar)"
AIHOT_USER_AGENT = "aihot-skill/0.3.4 (+https://aihot.virxact.com/aihot-skill/)"
TITLE_SIMILARITY_THRESHOLD = 0.9
OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions"
DEFAULT_OPENAI_MODEL = "gpt-4o-mini"
UTC = dt.timezone.utc
VALID_CATEGORIES = [
    "大模型",
    "AI Agent",
    "机器人/具身智能",
    "多模态",
    "AI产品",
    "AI芯片",
    "自动驾驶",
    "AI安全",
    "论文",
    "开源项目",
    "融资动态",
]


@dataclass(frozen=True)
class Source:
    name: str
    url: str
    kind: str
    category: str
    tags: tuple[str, ...]


SOURCES = [
    Source("AI HOT 精选", "https://aihot.virxact.com/api/public/items?mode=selected&take=50", "aihot", "大模型", ("AI HOT", "中文", "AI新闻")),
    Source("OpenAI Blog", "https://openai.com/news/rss.xml", "rss", "AI Agent", ("OpenAI", "LLM", "AI产品")),
    Source("Google DeepMind Blog", "https://deepmind.google/blog/rss.xml", "rss", "机器人", ("DeepMind", "多模态", "具身智能")),
    Source("Anthropic News", "https://www.anthropic.com/news", "page", "AI安全", ("Anthropic", "Claude", "AI安全")),
    Source("Hugging Face Papers", "https://huggingface.co/papers", "page", "论文", ("Hugging Face", "论文", "开源项目")),
    Source("arXiv cs.AI", "https://export.arxiv.org/api/query?search_query=cat:cs.AI&start=0&max_results=15&sortBy=submittedDate&sortOrder=descending", "arxiv", "论文", ("arXiv", "AI", "论文")),
    Source("arXiv cs.LG", "https://export.arxiv.org/api/query?search_query=cat:cs.LG&start=0&max_results=15&sortBy=submittedDate&sortOrder=descending", "arxiv", "论文", ("arXiv", "机器学习", "论文")),
    Source("arXiv cs.RO", "https://export.arxiv.org/api/query?search_query=cat:cs.RO&start=0&max_results=15&sortBy=submittedDate&sortOrder=descending", "arxiv", "机器人", ("arXiv", "机器人", "具身智能")),
    Source("TechCrunch AI", "https://techcrunch.com/category/artificial-intelligence/feed/", "rss", "AI产品", ("TechCrunch", "创业", "AI产品")),
    Source("The Decoder", "https://the-decoder.com/feed/", "rss", "AI新闻", ("The Decoder", "AI研究", "趋势")),
    Source("量子位", "https://www.qbitai.com/feed", "rss", "AI新闻", ("量子位", "中文", "AI新闻")),
]


KEYWORD_TAGS = {
    "llm": ("大模型",),
    "large language": ("大模型",),
    "gpt": ("大模型",),
    "claude": ("大模型",),
    "gemini": ("大模型",),
    "model": ("大模型",),
    "robot": ("机器人", "具身智能"),
    "robotics": ("机器人", "具身智能"),
    "embodied": ("具身智能",),
    "agent": ("AI Agent",),
    "agents": ("AI Agent",),
    "multimodal": ("多模态",),
    "vision": ("多模态", "CV"),
    "safety": ("AI安全",),
    "alignment": ("AI安全",),
    "chip": ("AI芯片",),
    "nvidia": ("AI芯片",),
    "semiconductor": ("AI芯片",),
    "autonomous": ("自动驾驶",),
    "driving": ("自动驾驶",),
    "open source": ("开源项目",),
    "github": ("开源项目",),
    "paper": ("论文",),
    "funding": ("融资动态",),
    "raises": ("融资动态",),
    "investment": ("融资动态",),
    "startup": ("融资动态", "AI产品"),
    "大模型": ("大模型",),
    "论文": ("论文",),
    "机器人": ("机器人",),
    "具身": ("具身智能",),
    "智能体": ("AI Agent",),
    "多模态": ("多模态",),
    "安全": ("AI安全",),
    "融资": ("融资动态",),
}


AIHOT_CATEGORY_MAP = {
    "ai-models": "大模型",
    "ai-products": "AI产品",
    "industry": "融资动态",
    "paper": "论文",
    "tip": "AI产品",
}


SOURCE_CREDIBILITY = {
    "OpenAI Blog": 96,
    "Google DeepMind Blog": 96,
    "Anthropic News": 94,
    "Hugging Face Papers": 88,
    "arXiv cs.AI": 84,
    "arXiv cs.LG": 84,
    "arXiv cs.RO": 86,
    "TechCrunch AI": 78,
    "The Decoder": 82,
    "量子位": 76,
}


class LinkCollector(HTMLParser):
    def __init__(self, base_url: str, allowed_patterns: tuple[str, ...]):
        super().__init__()
        self.base_url = base_url
        self.allowed_patterns = allowed_patterns
        self.links: list[tuple[str, str]] = []
        self._href: str | None = None
        self._text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != "a":
            return
        href = dict(attrs).get("href")
        if not href:
            return
        absolute = urllib.parse.urljoin(self.base_url, href)
        if any(pattern in absolute for pattern in self.allowed_patterns):
            self._href = absolute.split("#", 1)[0]
            self._text = []

    def handle_data(self, data: str) -> None:
        if self._href:
            self._text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag != "a" or not self._href:
            return
        title = clean_text(" ".join(self._text))
        if len(title) >= 12:
            self.links.append((self._href, title))
        self._href = None
        self._text = []


def fetch_text(url: str, timeout: int = 20, headers: dict[str, str] | None = None) -> str:
    request_headers = {"User-Agent": USER_AGENT}
    if headers:
        request_headers.update(headers)
    request = urllib.request.Request(url, headers=request_headers)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        return response.read().decode(charset, errors="replace")


def clean_text(value: str | None) -> str:
    if not value:
        return ""
    value = re.sub(r"<[^>]+>", " ", value)
    value = html.unescape(value)
    value = re.sub(r"\s+", " ", value)
    return value.strip()


def normalize_title(value: str) -> str:
    value = clean_text(value).casefold()
    value = re.sub(r"[^\w\u4e00-\u9fff]+", "", value)
    return value


def parse_date(value: str | None) -> str:
    if not value:
        return dt.datetime.now(UTC).isoformat()
    value = clean_text(value)
    try:
        parsed = email.utils.parsedate_to_datetime(value)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=UTC)
        return parsed.astimezone(UTC).isoformat()
    except Exception:
        pass
    normalized = value.replace("Z", "+00:00")
    try:
        parsed = dt.datetime.fromisoformat(normalized)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=UTC)
        return parsed.astimezone(UTC).isoformat()
    except Exception:
        return dt.datetime.now(UTC).isoformat()


def parse_datetime(value: str | None) -> dt.datetime | None:
    if not value:
        return None
    try:
        parsed = dt.datetime.fromisoformat(clean_text(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=UTC)
        return parsed.astimezone(UTC)
    except Exception:
        return None


def infer_tags_and_category(title: str, summary: str, source: Source) -> tuple[str, list[str]]:
    text = f"{title} {summary}".casefold()
    tags = list(source.tags)
    for keyword, keyword_tags in KEYWORD_TAGS.items():
        if keyword in text:
            for tag in keyword_tags:
                if tag not in tags:
                    tags.append(tag)

    category = normalize_category(source.category)
    priority = ["机器人/具身智能", "AI Agent", "多模态", "AI安全", "AI芯片", "自动驾驶", "开源项目", "论文", "融资动态", "AI产品", "大模型"]
    for candidate in priority:
        if candidate in tags or (candidate == "机器人/具身智能" and ("机器人" in tags or "具身智能" in tags)):
            category = candidate
            break
    return category, tags[:8]


def normalize_category(value: str | None) -> str:
    if value in ("机器人", "具身智能"):
        return "机器人/具身智能"
    if value in VALID_CATEGORIES:
        return value
    if value == "AI新闻":
        return "大模型"
    return "论文" if value == "paper" else "大模型"


def clamp_score(value: float, low: int = 0, high: int = 100) -> int:
    return int(max(low, min(high, round(value))))


def calculate_final_score(scores: dict) -> int:
    weighted = (
        scores["relevance_score"] * 0.35
        + scores["credibility_score"] * 0.20
        + scores["novelty_score"] * 0.15
        + scores["trend_score"] * 0.15
        + scores["actionability_score"] * 0.15
    )
    return clamp_score(weighted - scores["spam_score"])


def local_analysis(title: str, summary: str, tags: list[str], source: Source, category: str) -> dict:
    text = f"{title} {summary}".casefold()
    student_goal_tags = {"机器人", "具身智能", "机器人/具身智能", "AI Agent", "多模态", "论文", "开源项目", "AI产品", "AI安全", "自动驾驶", "AI芯片"}
    relevance = 48 + sum(8 for tag in tags if tag in student_goal_tags)
    if category in ("机器人/具身智能", "AI Agent", "论文", "多模态"):
        relevance += 14
    credibility = SOURCE_CREDIBILITY.get(source.name, 72)
    novelty = 58
    trend = 55
    actionability = 52

    novelty_terms = ("introduc", "launch", "release", "new", "first", "novel", "preview", "announc", "提出", "发布", "首次", "新")
    trend_terms = ("agent", "robot", "multimodal", "safety", "chip", "nvidia", "open source", "具身", "智能体", "多模态", "芯片")
    action_terms = ("code", "github", "dataset", "benchmark", "paper", "arxiv", "open source", "repo", "代码", "数据集", "论文", "开源")
    spam_terms = ("sponsored", "coupon", "seo", "casino", "deal", "promo", "广告", "折扣", "优惠")

    novelty += sum(5 for term in novelty_terms if term in text)
    trend += sum(5 for term in trend_terms if term in text)
    actionability += sum(7 for term in action_terms if term in text)
    if source.name.startswith("arXiv") or "论文" in tags:
        actionability += 8
        novelty += 6
    if "开源项目" in tags:
        actionability += 10
    if "融资动态" in tags:
        actionability -= 6
    spam = sum(8 for term in spam_terms if term in text)
    if len(summary) < 60:
        spam += 4
    if re.search(r"[!?]{2,}|震惊|必看|史上最", title):
        spam += 8

    scores = {
        "relevance_score": clamp_score(relevance),
        "credibility_score": clamp_score(credibility),
        "novelty_score": clamp_score(novelty),
        "trend_score": clamp_score(trend),
        "actionability_score": clamp_score(actionability),
        "spam_score": clamp_score(spam, 0, 30),
    }
    scores["final_score"] = calculate_final_score(scores)

    title_text = clean_text(title)
    one_sentence = f"这条内容关注《{title_text}》，适合作为{category}方向的每日追踪素材。"
    audience = "AI/机器人方向本科生、准备申请研究生的同学"
    if category == "AI产品":
        audience = "关注 AI 产品经理、产品分析和商业化案例的学生"
    elif category == "融资动态":
        audience = "关注 AI 产业趋势、创业公司和投研素材的学生"
    elif category == "AI芯片":
        audience = "关注 AI 基础设施、芯片和算力生态的学生"

    return {
        "one_sentence_summary": one_sentence,
        "importance": f"它和{category}相关，可作为学习路线、科研计划或产品案例库的素材。",
        "audience": audience,
        "action_suggestion": suggest_action(category, tags),
        "category": category,
        "tags": tags,
        **scores,
        "analysis_provider": "local_rules",
    }


def suggest_action(category: str, tags: list[str]) -> str:
    if category == "论文":
        return "按研究问题、方法、数据集、结果、局限和可复现性写一页论文阅读笔记。"
    if category == "机器人/具身智能":
        return "整理技术关键词，并设计一个 ROS、仿真或 VLA 相关的小复现实验。"
    if category == "AI Agent":
        return "拆解任务链路、工具调用和评价指标，沉淀为 Agent 产品或项目卡片。"
    if category == "AI产品":
        return "写一张产品分析卡：用户痛点、核心功能、商业模式、竞品和 PM 启发。"
    if category == "开源项目":
        return "打开仓库看 README、安装路径和 issue，记录一个 2 小时可完成的上手任务。"
    if category == "融资动态":
        return "记录公司定位、目标用户、融资阶段和它反映的 AI 产业趋势。"
    if "论文" in tags:
        return "保存到论文雷达，并补充是否适合写进科研计划。"
    return "收藏并写 3 条要点：它解决什么问题、需要哪些知识、能做什么小项目。"


ANALYSIS_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "one_sentence_summary": {"type": "string"},
        "importance": {"type": "string"},
        "audience": {"type": "string"},
        "action_suggestion": {"type": "string"},
        "category": {"type": "string", "enum": VALID_CATEGORIES},
        "tags": {"type": "array", "items": {"type": "string"}, "maxItems": 8},
        "relevance_score": {"type": "integer", "minimum": 0, "maximum": 100},
        "credibility_score": {"type": "integer", "minimum": 0, "maximum": 100},
        "novelty_score": {"type": "integer", "minimum": 0, "maximum": 100},
        "trend_score": {"type": "integer", "minimum": 0, "maximum": 100},
        "actionability_score": {"type": "integer", "minimum": 0, "maximum": 100},
        "spam_score": {"type": "integer", "minimum": 0, "maximum": 30},
    },
    "required": [
        "one_sentence_summary",
        "importance",
        "audience",
        "action_suggestion",
        "category",
        "tags",
        "relevance_score",
        "credibility_score",
        "novelty_score",
        "trend_score",
        "actionability_score",
        "spam_score",
    ],
}


def openai_analysis(article: dict, api_key: str, model: str) -> dict:
    prompt = {
        "student_goal": "电子信息本科生，未来申请香港 AI/机器人方向研究生，也可能走 AI 产品经理。",
        "score_formula": "final_score = relevance 35% + credibility 20% + novelty 15% + trend 15% + actionability 15% - spam_score",
        "score_notes": "spam_score is a penalty point value from 0 to 30. Other scores are 0 to 100.",
        "allowed_categories": VALID_CATEGORIES,
        "article": {
            "title": article["title"],
            "url": article["url"],
            "source": article["source"],
            "published_at": article["published_at"],
            "raw_summary": article["summary"],
            "rule_category": article["category"],
            "rule_tags": article["tags"],
        },
    }
    body = {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are an AI intelligence analyst for AI/robotics students. "
                    "Return concise Chinese JSON only. Do not invent facts beyond the provided article metadata."
                ),
            },
            {"role": "user", "content": json.dumps(prompt, ensure_ascii=False)},
        ],
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": "ai_radar_article_analysis",
                "schema": ANALYSIS_SCHEMA,
                "strict": True,
            },
        },
    }
    request = urllib.request.Request(
        OPENAI_CHAT_COMPLETIONS_URL,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "User-Agent": USER_AGENT,
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=40) as response:
        payload = json.loads(response.read().decode("utf-8"))
    content = payload["choices"][0]["message"]["content"]
    return json.loads(content)


def normalize_analysis(article: dict, analysis: dict, provider: str) -> dict:
    category = normalize_category(analysis.get("category") or article["category"])
    tags = analysis.get("tags") if isinstance(analysis.get("tags"), list) else article["tags"]
    tags = [clean_text(str(tag)) for tag in tags if clean_text(str(tag))][:8]
    if category not in tags:
        tags.insert(0, category)
    tags = list(dict.fromkeys(tags))[:8]

    scores = {
        "relevance_score": clamp_score(analysis.get("relevance_score", 60)),
        "credibility_score": clamp_score(analysis.get("credibility_score", SOURCE_CREDIBILITY.get(article["source"], 72))),
        "novelty_score": clamp_score(analysis.get("novelty_score", 60)),
        "trend_score": clamp_score(analysis.get("trend_score", 60)),
        "actionability_score": clamp_score(analysis.get("actionability_score", 60)),
        "spam_score": clamp_score(analysis.get("spam_score", 0), 0, 30),
    }
    scores["final_score"] = calculate_final_score(scores)

    return {
        "one_sentence_summary": clean_text(analysis.get("one_sentence_summary"))[:180] or article["summary"][:120],
        "importance": clean_text(analysis.get("importance"))[:260] or f"它和{category}相关，值得持续追踪。",
        "audience": clean_text(analysis.get("audience"))[:160] or "AI/机器人方向学生",
        "action_suggestion": clean_text(analysis.get("action_suggestion"))[:240] or suggest_action(category, tags),
        "category": category,
        "tags": tags,
        **scores,
        "analysis_provider": provider,
    }


def enrich_article(article: dict, api_key: str | None = None, model: str = DEFAULT_OPENAI_MODEL) -> dict:
    local = local_analysis(article["title"], article["summary"], article["tags"], Source(article["source"], article["url"], "rss", article["category"], tuple(article["tags"])), article["category"])
    if not api_key:
        return {**article, **local}
    try:
        llm = openai_analysis({**article, **local}, api_key, model)
        return {**article, **normalize_analysis({**article, **local}, llm, "openai")}
    except Exception as exc:
        print(f"[warn] LLM analysis fallback for {article['source']}: {exc}", file=sys.stderr)
        return {**article, **local}


def parse_rss(source: Source) -> list[dict]:
    raw = fetch_text(source.url)
    root = ET.fromstring(raw)
    channel_items = root.findall(".//item")
    entries = channel_items if channel_items else root.findall("{http://www.w3.org/2005/Atom}entry")
    articles = []
    for entry in entries[:25]:
        if entry.tag.endswith("item"):
            title = clean_text(entry.findtext("title"))
            url = clean_text(entry.findtext("link"))
            summary = clean_text(entry.findtext("description"))
            published = entry.findtext("pubDate") or entry.findtext("{http://purl.org/dc/elements/1.1/}date")
        else:
            title = clean_text(entry.findtext("{http://www.w3.org/2005/Atom}title"))
            summary = clean_text(entry.findtext("{http://www.w3.org/2005/Atom}summary"))
            published = entry.findtext("{http://www.w3.org/2005/Atom}updated") or entry.findtext("{http://www.w3.org/2005/Atom}published")
            url = ""
            for link in entry.findall("{http://www.w3.org/2005/Atom}link"):
                if link.attrib.get("rel") in (None, "alternate"):
                    url = link.attrib.get("href", "")
                    break
        if title and url:
            articles.append(make_article(title, url, summary, published, source))
    return articles


def parse_arxiv(source: Source) -> list[dict]:
    raw = fetch_text(source.url)
    root = ET.fromstring(raw)
    ns = {"atom": "http://www.w3.org/2005/Atom"}
    articles = []
    for entry in root.findall("atom:entry", ns):
        title = clean_text(entry.findtext("atom:title", namespaces=ns))
        summary = clean_text(entry.findtext("atom:summary", namespaces=ns))
        published = entry.findtext("atom:published", namespaces=ns)
        url = ""
        for link in entry.findall("atom:link", ns):
            if link.attrib.get("type") == "text/html" or link.attrib.get("rel") == "alternate":
                url = link.attrib.get("href", "")
                break
        if not url:
            entry_id = entry.findtext("atom:id", namespaces=ns)
            url = clean_text(entry_id)
        if title and url:
            articles.append(make_article(title, url, summary, published, source))
    return articles


def parse_page(source: Source) -> list[dict]:
    raw = fetch_text(source.url)
    patterns = ("/news/",) if "anthropic.com" in source.url else ("/papers/",)
    parser = LinkCollector(source.url, patterns)
    parser.feed(raw)
    seen = set()
    articles = []
    for url, title in parser.links:
        if url in seen:
            continue
        seen.add(url)
        if "huggingface.co/papers" in source.url and not re.search(r"/papers/\d", url):
            continue
        summary = f"{source.name} public page item: {title}"
        articles.append(make_article(title, url, summary, None, source))
        if len(articles) >= 20:
            break
    return articles


def parse_aihot(source: Source) -> list[dict]:
    raw = fetch_text(source.url, headers={"User-Agent": AIHOT_USER_AGENT})
    payload = json.loads(raw)
    articles = []
    for item in payload.get("items", [])[:25]:
        title = clean_text(item.get("title"))
        url = clean_text(item.get("permalink") or item.get("url"))
        if not title or not url:
            continue
        summary = clean_text(item.get("summary"))
        category = AIHOT_CATEGORY_MAP.get(item.get("category"), source.category)
        tags = list(source.tags)
        if category not in tags:
            tags.append(category)
        source_name = clean_text(item.get("source")) or source.name
        article = {
            "title": title,
            "url": url,
            "source": f"AI HOT · {source_name}",
            "published_at": parse_date(item.get("publishedAt")),
            "summary": summary[:700],
            "category": normalize_category(category),
            "tags": list(dict.fromkeys(tags))[:8],
        }
        enriched = enrich_article(article)
        if isinstance(item.get("score"), int):
            aihot_score = clamp_score(item["score"])
            enriched["trend_score"] = clamp_score(max(enriched["trend_score"], aihot_score))
            enriched["final_score"] = max(calculate_final_score(enriched), aihot_score)
            enriched["score"] = enriched["final_score"]
        articles.append(enriched)
    return articles


def make_article(title: str, url: str, summary: str, published: str | None, source: Source) -> dict:
    category, tags = infer_tags_and_category(title, summary, source)
    article = {
        "title": clean_text(title),
        "url": url.strip(),
        "source": source.name,
        "published_at": parse_date(published),
        "summary": clean_text(summary)[:700],
        "category": category,
        "tags": tags,
    }
    return enrich_article(article)


def connect_db(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS articles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            url TEXT NOT NULL UNIQUE,
            source TEXT NOT NULL,
            published_at TEXT,
            summary TEXT,
            category TEXT,
            tags TEXT,
            score INTEGER DEFAULT 0,
            one_sentence_summary TEXT,
            importance TEXT,
            audience TEXT,
            action_suggestion TEXT,
            relevance_score INTEGER DEFAULT 0,
            credibility_score INTEGER DEFAULT 0,
            novelty_score INTEGER DEFAULT 0,
            trend_score INTEGER DEFAULT 0,
            actionability_score INTEGER DEFAULT 0,
            spam_score INTEGER DEFAULT 0,
            final_score INTEGER DEFAULT 0,
            analysis_provider TEXT DEFAULT 'local_rules',
            is_favorite INTEGER DEFAULT 0,
            created_at TEXT NOT NULL
        )
        """
    )
    ensure_columns(conn)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_articles_published_at ON articles(published_at)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_articles_source ON articles(source)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_articles_final_score ON articles(final_score)")
    return conn


def ensure_columns(conn: sqlite3.Connection) -> None:
    existing = {row[1] for row in conn.execute("PRAGMA table_info(articles)").fetchall()}
    columns = {
        "one_sentence_summary": "TEXT",
        "importance": "TEXT",
        "audience": "TEXT",
        "action_suggestion": "TEXT",
        "relevance_score": "INTEGER DEFAULT 0",
        "credibility_score": "INTEGER DEFAULT 0",
        "novelty_score": "INTEGER DEFAULT 0",
        "trend_score": "INTEGER DEFAULT 0",
        "actionability_score": "INTEGER DEFAULT 0",
        "spam_score": "INTEGER DEFAULT 0",
        "final_score": "INTEGER DEFAULT 0",
        "analysis_provider": "TEXT DEFAULT 'local_rules'",
    }
    for name, definition in columns.items():
        if name not in existing:
            conn.execute(f"ALTER TABLE articles ADD COLUMN {name} {definition}")


def load_existing_titles(conn: sqlite3.Connection) -> list[str]:
    rows = conn.execute("SELECT title FROM articles").fetchall()
    return [normalize_title(row[0]) for row in rows if row[0]]


def is_similar_title(title: str, known_titles: list[str]) -> bool:
    normalized = normalize_title(title)
    if not normalized:
        return True
    for known in known_titles:
        if not known:
            continue
        if normalized == known:
            return True
        shorter = min(len(normalized), len(known))
        if shorter >= 18 and SequenceMatcher(None, normalized, known).ratio() >= TITLE_SIMILARITY_THRESHOLD:
            return True
    return False


def save_articles(conn: sqlite3.Connection, incoming: list[dict]) -> tuple[int, int]:
    known_titles = load_existing_titles(conn)
    inserted = 0
    skipped = 0
    now = dt.datetime.now(UTC).isoformat()
    for article in sorted(incoming, key=lambda item: item["final_score"], reverse=True):
        if is_similar_title(article["title"], known_titles):
            skipped += 1
            continue
        try:
            conn.execute(
                """
                INSERT INTO articles (
                    title, url, source, published_at, summary, category, tags, score,
                    one_sentence_summary, importance, audience, action_suggestion,
                    relevance_score, credibility_score, novelty_score, trend_score,
                    actionability_score, spam_score, final_score, analysis_provider,
                    is_favorite, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
                """,
                (
                    article["title"],
                    article["url"],
                    article["source"],
                    article["published_at"],
                    article["summary"],
                    article["category"],
                    json.dumps(article["tags"], ensure_ascii=False),
                    article["final_score"],
                    article["one_sentence_summary"],
                    article["importance"],
                    article["audience"],
                    article["action_suggestion"],
                    article["relevance_score"],
                    article["credibility_score"],
                    article["novelty_score"],
                    article["trend_score"],
                    article["actionability_score"],
                    article["spam_score"],
                    article["final_score"],
                    article["analysis_provider"],
                    now,
                ),
            )
            known_titles.append(normalize_title(article["title"]))
            inserted += 1
        except sqlite3.IntegrityError:
            skipped += 1
    conn.commit()
    return inserted, skipped


def update_article_analysis(conn: sqlite3.Connection, article_id: int, analysis: dict) -> None:
    conn.execute(
        """
        UPDATE articles
        SET
            summary = ?,
            category = ?,
            tags = ?,
            score = ?,
            one_sentence_summary = ?,
            importance = ?,
            audience = ?,
            action_suggestion = ?,
            relevance_score = ?,
            credibility_score = ?,
            novelty_score = ?,
            trend_score = ?,
            actionability_score = ?,
            spam_score = ?,
            final_score = ?,
            analysis_provider = ?
        WHERE id = ?
        """,
        (
            analysis["summary"],
            analysis["category"],
            json.dumps(analysis["tags"], ensure_ascii=False),
            analysis["final_score"],
            analysis["one_sentence_summary"],
            analysis["importance"],
            analysis["audience"],
            analysis["action_suggestion"],
            analysis["relevance_score"],
            analysis["credibility_score"],
            analysis["novelty_score"],
            analysis["trend_score"],
            analysis["actionability_score"],
            analysis["spam_score"],
            analysis["final_score"],
            analysis["analysis_provider"],
            article_id,
        ),
    )


def enrich_missing_analysis(conn: sqlite3.Connection, api_key: str | None, model: str, llm_limit: int, reanalyze_all: bool = False) -> int:
    where_clause = "1 = 1" if reanalyze_all else "one_sentence_summary IS NULL OR one_sentence_summary = '' OR final_score IS NULL OR final_score = 0"
    rows = conn.execute(
        f"""
        SELECT id, title, url, source, published_at, summary, category, tags
        FROM articles
        WHERE {where_clause}
        ORDER BY published_at DESC, id DESC
        """
    ).fetchall()
    updated = 0
    llm_used = 0
    for row in rows:
        tags = json.loads(row[7] or "[]")
        article = {
            "title": row[1],
            "url": row[2],
            "source": row[3],
            "published_at": row[4],
            "summary": row[5] or "",
            "category": normalize_category(row[6]),
            "tags": tags,
        }
        use_key = api_key if api_key and (llm_limit <= 0 or llm_used < llm_limit) else None
        enriched = enrich_article(article, use_key, model)
        if use_key:
            llm_used += 1
        update_article_analysis(conn, row[0], enriched)
        updated += 1
    conn.commit()
    if updated:
        print(f"[analysis] updated={updated} llm_used={llm_used}")
    return updated


def export_json(conn: sqlite3.Connection, path: Path, limit: int, export_days: int) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    cutoff = dt.datetime.now(UTC) - dt.timedelta(days=max(1, export_days))
    cutoff_iso = cutoff.isoformat()
    rows = conn.execute(
        """
        SELECT
            id, title, url, source, published_at, summary, category, tags, score,
            one_sentence_summary, importance, audience, action_suggestion,
            relevance_score, credibility_score, novelty_score, trend_score,
            actionability_score, spam_score, final_score, analysis_provider,
            is_favorite, created_at
        FROM articles
        WHERE
            published_at >= ?
            OR published_at IS NULL
            OR published_at = ''
            OR created_at >= ?
        ORDER BY final_score DESC, published_at DESC, id DESC
        """,
        (cutoff_iso, cutoff_iso),
    ).fetchall()
    payload = []
    for row in rows:
        article_time = parse_datetime(row[4]) or parse_datetime(row[22])
        if article_time is None or article_time < cutoff:
            continue
        tags = json.loads(row[7] or "[]")
        payload.append(
            {
                "id": row[0],
                "title": row[1],
                "url": row[2],
                "source": row[3],
                "published_at": row[4],
                "summary": row[5],
                "category": row[6],
                "tags": tags,
                "score": row[8],
                "one_sentence_summary": row[9] or row[5],
                "importance": row[10] or "",
                "audience": row[11] or "",
                "action_suggestion": row[12] or "",
                "relevance_score": row[13] or 0,
                "credibility_score": row[14] or 0,
                "novelty_score": row[15] or 0,
                "trend_score": row[16] or 0,
                "actionability_score": row[17] or 0,
                "spam_score": row[18] or 0,
                "final_score": row[19] or row[8],
                "analysis_provider": row[20] or "local_rules",
                "is_favorite": bool(row[21]),
                "created_at": row[22],
            }
        )
        if len(payload) >= limit:
            break
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return len(payload)


def collect(limit_per_source: int) -> list[dict]:
    collected = []
    for source in SOURCES:
        try:
            if source.kind == "rss":
                items = parse_rss(source)
            elif source.kind == "arxiv":
                items = parse_arxiv(source)
            elif source.kind == "page":
                items = parse_page(source)
            elif source.kind == "aihot":
                items = parse_aihot(source)
            else:
                items = []
            collected.extend(items[:limit_per_source])
            print(f"[ok] {source.name}: {len(items[:limit_per_source])} items")
            time.sleep(0.4)
        except Exception as exc:
            print(f"[warn] {source.name}: {exc}", file=sys.stderr)
    return collected


def enrich_with_llm(incoming: list[dict], api_key: str | None, model: str, llm_limit: int) -> tuple[list[dict], int]:
    if not api_key:
        return incoming, 0
    enriched = []
    llm_used = 0
    ordered = sorted(enumerate(incoming), key=lambda item: item[1]["final_score"], reverse=True)
    llm_indexes = {
        index for index, _article in ordered[: len(incoming) if llm_limit <= 0 else llm_limit]
    }
    for index, article in enumerate(incoming):
        if index in llm_indexes:
            enriched.append(enrich_article(article, api_key, model))
            llm_used += 1
        else:
            enriched.append(article)
    return enriched, llm_used


def main() -> int:
    parser = argparse.ArgumentParser(description="Collect AI news and papers.")
    parser.add_argument("--db", type=Path, default=DB_PATH, help="SQLite database path")
    parser.add_argument("--json", type=Path, default=JSON_PATH, help="Exported news.json path")
    parser.add_argument("--limit-per-source", type=int, default=12, help="Max items to ingest per source")
    parser.add_argument("--export-limit", type=int, default=60, help="Max items in public JSON")
    parser.add_argument("--export-days", type=int, default=3, help="Only export articles from the last N days to public JSON")
    parser.add_argument("--llm-limit", type=int, default=40, help="Max articles to analyze with LLM when OPENAI_API_KEY is set; use 0 for all")
    parser.add_argument("--reanalyze-all", action="store_true", help="Recompute analysis fields for existing database rows")
    args = parser.parse_args()

    api_key = os.environ.get("OPENAI_API_KEY")
    model = os.environ.get("AI_RADAR_MODEL") or os.environ.get("OPENAI_MODEL") or DEFAULT_OPENAI_MODEL
    conn = connect_db(args.db)
    incoming = collect(args.limit_per_source)
    incoming, llm_used = enrich_with_llm(incoming, api_key, model, args.llm_limit)
    inserted, skipped = save_articles(conn, incoming)
    enriched_existing = enrich_missing_analysis(conn, api_key, model, args.llm_limit, args.reanalyze_all)
    exported = export_json(conn, args.json, args.export_limit, args.export_days)
    provider = f"openai:{model}" if api_key else "local_rules"
    print(f"[done] provider={provider} collected={len(incoming)} inserted={inserted} skipped={skipped} llm_used={llm_used} enriched_existing={enriched_existing} exported={exported}")
    print(f"[db] {args.db}")
    print(f"[json] {args.json}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
