# Backend Collector

Lightweight Python collector for AI news and papers.

```bash
python backend/collect_news.py
```

It writes:

- `backend/data/news.sqlite`
- `public/data/news.json`

The collector prefers RSS/Atom and arXiv API sources. Anthropic News and Hugging Face Papers currently use shallow public page extraction because stable RSS feeds were not available during setup.

## Optional LLM analysis

Set an API key to enable AI-generated structured summaries and scoring:

```bash
set OPENAI_API_KEY=...
set AI_RADAR_MODEL=gpt-4o-mini
python backend/collect_news.py
```

If `OPENAI_API_KEY` is missing or an API call fails, the collector falls back to local rules and still writes the same JSON fields.

Scoring:

```text
final_score = relevance_score * 0.35
  + credibility_score * 0.20
  + novelty_score * 0.15
  + trend_score * 0.15
  + actionability_score * 0.15
  - spam_score
```
