"""
Pre-market "Market Digest" generator.

Runs ~8:30 AM ET Mon-Fri (see the pg_cron migration), before the open, and
produces one structured JSON digest for the mobile app's full-screen story
modal. Unlike ReviewGenerator (markdown, parsed at display time), this
returns typed JSON so the client can render distinct slides — stat tiles,
charts, headline cards — without re-parsing prose.

Two data paths, kept deliberately separate:

  - Every NUMBER (futures, VIX, yields, DXY, oil, gold, crypto, watchlist
    quotes, market-wide movers) comes from yfinance / the existing Yahoo
    watchlist service — deterministic, no hallucination risk on the figures
    a trader actually acts on.
  - Headlines, catalysts, and the earnings/economic calendar come from
    Claude with the server-side web_search tool, restricted to a curated
    allowlist of finance outlets — real live search with a citation on every
    claim, not the model's training-data memory.

A Claude narrative failure (bad JSON, search hiccup) degrades the digest
rather than killing it — the numeric slides are still useful on their own,
so generate() never raises; it just leaves the narrative fields empty and
logs the failure.
"""

import os
import re
import json
import logging
from datetime import date, datetime, timedelta

import pytz
import yfinance as yf
import anthropic

logger = logging.getLogger(__name__)
ET = pytz.timezone("America/New_York")

_CLAUDE_MODEL   = "claude-sonnet-4-6"
_ADVICE_MODEL   = "claude-haiku-4-5"
_MAX_TOKENS     = 4096
_MAX_WEB_SEARCHES = 8

# Reputable finance/news outlets only — so a catalyst claim can't get
# attributed to a thin aggregator or SEO-farm site. Tune this list if the
# digest is missing real stories or citing something low-quality.
_ALLOWED_DOMAINS = [
    "finance.yahoo.com",
    "cnbc.com",
    "reuters.com",
    "bloomberg.com",
    "marketwatch.com",
    "tradingeconomics.com",
    "investing.com",
]

# label -> yfinance symbol. ^TNX (10Y) is quoted at yield×10 per Yahoo's
# legacy CBOE index convention (a print of 47.90 means a 4.790% yield) —
# corrected for in _fetch_macro_quotes below.
_MACRO_SYMBOLS = [
    ("S&P 500 Fut", "ES=F", "index"),
    ("Nasdaq Fut",  "NQ=F", "index"),
    ("Dow Fut",     "YM=F", "index"),
    ("VIX",         "^VIX", "index"),
    ("US 10Y",      "^TNX", "yield"),
    ("DXY",         "DX-Y.NYB", "index"),
    ("WTI Crude",   "CL=F", "currency"),
    ("Gold",        "GC=F", "currency"),
    ("BTC",         "BTC-USD", "currency"),
    ("ETH",         "ETH-USD", "currency"),
]

_DEFAULT_WATCHLIST = ["SPY", "QQQ", "NVDA", "AAPL", "TSLA", "AMD"]

# market_pulse_config entries that are display-only pseudo-tickers, not real
# yfinance symbols — see FeedMarketPulseStrip.tsx's DEFAULT_CONFIG.
_NON_TICKER_CONFIG_KEYS = {"VIX", "FLOW"}

_SYSTEM_PROMPT = """
You are a pre-market analyst producing the news/catalyst portion of a daily
market digest for a US equities day trader. You are given today's date, a
resolved list of macro price levels (already fetched live moments ago — DO
NOT re-derive, restate with different values, or contradict these numbers),
the trader's watchlist tickers, and today's top market-wide movers with
their price change, also already fetched live.

Your job is ONLY to explain the "why" behind the tape using live web search
— headlines, catalysts, earnings, and the economic calendar — NOT to
re-report numbers you already have. Every claim must come from a search
result you actually retrieved just now, not memory.

Return ONLY a single JSON object — no markdown code fences, no commentary
before or after — matching exactly this shape:

{
  "market_setup_note": "one tight sentence on overnight direction and the main driver, ET-anchored",
  "market_setup_source": {"label": "...", "url": "..."},
  "headlines": [
    {"text": "...", "source": "...", "url": "..."}
  ],
  "watchlist_catalysts": {
    "<TICKER>": {"catalyst": "...", "level": "..." }
  },
  "mover_reasons": {
    "<TICKER>": "reason (earnings, guidance, upgrade, etc.)"
  },
  "earnings_today": [
    {"ticker": "...", "when": "before_open", "note": "..."}
  ],
  "economic_calendar": [
    {"time_et": "8:15 AM", "label": "...", "consensus": "...", "prior": "..."}
  ],
  "what_to_watch": [
    "..."
  ]
}

Rules:
- "headlines": 4-6 items, top macro/market stories since yesterday's close, one line each.
- "watchlist_catalysts": exactly one entry per watchlist ticker given below.
  If you find no catalyst, set "catalyst" to "No news" and "level" to null
  — never invent one.
- "mover_reasons": exactly one entry per mover ticker given below.
- "earnings_today": "when" is either "before_open" or "after_close".
- All times in ET. State facts, catalysts, and levels only — never tell the
  trader to buy or sell.
- Keep every string tight and scannable — this renders on a phone screen,
  one slide per section.
""".strip()

_ADVICE_SYSTEM_PROMPT = """
You are a trading coach writing a 1-2 sentence note for a pre-market digest,
based on the trader's own recent performance-review summaries (not market
news). Be specific and reference an actual pattern in the numbers given —
not generic encouragement. State facts and observed patterns; never tell
the trader to buy, sell, or take a specific position. Return plain text
only, no markdown, no preamble.
""".strip()


class MarketDigestGenerator:
    def __init__(self, supabase_client):
        self._sb     = supabase_client
        self._claude = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))

    # ── Public API ────────────────────────────────────────────────────────────

    def generate(self, digest_date: date | None = None) -> dict:
        """
        Build and return the full digest JSON for one day. Never raises —
        a failure in any one section is logged and that section degrades to
        an empty/default value so the rest of the digest still ships.
        """
        digest_date = digest_date or date.today()

        my_tickers = self._fetch_my_watchlist_tickers()
        trending   = self._fetch_trending()
        macro      = self._fetch_macro_quotes()
        watchlist_quotes = self._fetch_ticker_quotes(my_tickers)
        movers     = self._fetch_market_movers()
        trading    = self._fetch_trading_performance(digest_date)

        ai = self._call_claude(digest_date, macro, watchlist_quotes, movers)

        return {
            "digest_date":   str(digest_date),
            "generated_at":  datetime.now(pytz.utc).isoformat(),
            "market_setup": {
                "note":   ai.get("market_setup_note", ""),
                "source": ai.get("market_setup_source"),
                "stats":  macro,
            },
            "headlines": ai.get("headlines", []),
            "watchlist": {
                "mine":     self._merge_catalysts(watchlist_quotes, ai.get("watchlist_catalysts", {})),
                "trending": trending,
            },
            "movers": self._merge_mover_reasons(movers, ai.get("mover_reasons", {})),
            "events": {
                "earnings": ai.get("earnings_today", []),
                "economic": ai.get("economic_calendar", []),
            },
            "what_to_watch": ai.get("what_to_watch", []),
            "trading": trading,
        }

    def save_to_supabase(self, digest_date: date, content: dict) -> bool:
        try:
            self._sb.table("market_digests").upsert({
                "digest_date":   str(digest_date),
                "content_json":  content,
                "created_at":    datetime.utcnow().isoformat(),
            }, on_conflict="digest_date").execute()
            logger.info("[MarketDigestGenerator] Saved digest for %s", digest_date)
            return True
        except Exception as e:
            logger.error("[MarketDigestGenerator] Supabase save failed: %s", e)
            return False

    # ── Deterministic data (yfinance / Yahoo watchlist service) ────────────────

    def _fetch_my_watchlist_tickers(self) -> list[str]:
        """User's own watchlist — persisted server-side in
        user_profiles.market_pulse_config (see FeedMarketPulseStrip.tsx),
        with VIX/FLOW filtered out since those are strip pseudo-entries, not
        real tickers. Falls back to a sane default if unset."""
        try:
            rows = (
                self._sb.table("user_profiles")
                .select("market_pulse_config")
                .limit(1)
                .execute()
                .data or []
            )
            config = (rows[0].get("market_pulse_config") if rows else None) or []
            tickers = [t for t in config if isinstance(t, str) and t not in _NON_TICKER_CONFIG_KEYS]
            return tickers or list(_DEFAULT_WATCHLIST)
        except Exception as e:
            logger.warning("[MarketDigestGenerator] fetch_my_watchlist_tickers failed: %s", e)
            return list(_DEFAULT_WATCHLIST)

    def _fetch_trending(self, limit: int = 8) -> list[dict]:
        """Broader-market coverage beyond the user's own watchlist — Yahoo
        Finance's trending list, already integrated (yahoo_watchlist_service),
        so a story the user isn't personally tracking still surfaces."""
        try:
            from services.yfinance.yahoo_watchlist_service import get_yahoo_watchlist_service
            result = get_yahoo_watchlist_service().get_trending(limit=limit)
            if not result.get("success"):
                return []
            return [
                {
                    "ticker":         s.get("ticker"),
                    "company":        s.get("company"),
                    "price":          s.get("price"),
                    "change_percent": s.get("change_percent"),
                    "volume":         s.get("volume"),
                }
                for s in result.get("data", [])
            ]
        except Exception as e:
            logger.warning("[MarketDigestGenerator] fetch_trending failed: %s", e)
            return []

    def _fetch_market_movers(self, limit: int = 3) -> dict:
        """Top market-wide gainers/losers, independent of any watchlist —
        reuses the same Yahoo watchlist service the Trending tab already
        uses in the mobile app."""
        try:
            from services.yfinance.yahoo_watchlist_service import get_yahoo_watchlist_service
            svc = get_yahoo_watchlist_service()
            gainers = svc.get_gainers(limit=limit)
            losers  = svc.get_losers(limit=limit)
            fmt = lambda rows: [
                {
                    "ticker":         s.get("ticker"),
                    "company":        s.get("company"),
                    "price":          s.get("price"),
                    "change_percent": s.get("change_percent"),
                }
                for s in rows
            ]
            return {
                "gainers": fmt(gainers.get("data", []) if gainers.get("success") else []),
                "losers":  fmt(losers.get("data", []) if losers.get("success") else []),
            }
        except Exception as e:
            logger.warning("[MarketDigestGenerator] fetch_market_movers failed: %s", e)
            return {"gainers": [], "losers": []}

    def _quote_from_info(self, info: dict) -> dict | None:
        """
        Pull a best-effort live price + % change out of yfinance's `.info`
        dict, preferring genuine pre-market fields (present only while
        pre-market is actually live) and falling back to the regular-session
        fields — so this works whether the digest fires at 8:30 AM
        pre-market or is regenerated on-demand later in the day from Daily
        Review.
        """
        price = info.get("preMarketPrice")
        change_pct = info.get("preMarketChangePercent")
        session = "pre_market"

        if price is None:
            price = info.get("regularMarketPrice") or info.get("currentPrice")
            change_pct = info.get("regularMarketChangePercent")
            session = "regular"

        prev_close = info.get("regularMarketPreviousClose")
        if change_pct is None and price is not None and prev_close:
            change_pct = (price - prev_close) / prev_close * 100
            session = session or "computed"

        if price is None:
            return None
        return {"price": round(price, 2), "change_percent": round(change_pct, 2) if change_pct is not None else None, "session": session}

    def _fetch_macro_quotes(self) -> list[dict]:
        stats = []
        for label, symbol, kind in _MACRO_SYMBOLS:
            try:
                info = yf.Ticker(symbol).info
                q = self._quote_from_info(info)
                if not q:
                    continue
                value = q["price"]
                if kind == "yield":
                    # ^TNX legacy CBOE convention: reported value is yield × 10.
                    value = round(value / 10, 3)
                stats.append({
                    "label":          label,
                    "symbol":         symbol,
                    "value":          value,
                    "change_percent": q["change_percent"],
                    "kind":           kind,
                })
            except Exception as e:
                logger.warning("[MarketDigestGenerator] macro quote failed for %s: %s", symbol, e)
        return stats

    def _fetch_ticker_quotes(self, tickers: list[str]) -> list[dict]:
        quotes = []
        for t in tickers:
            try:
                info = yf.Ticker(t).info
                q = self._quote_from_info(info)
                quotes.append({
                    "ticker":         t,
                    "price":          q["price"] if q else None,
                    "change_percent": q["change_percent"] if q else None,
                    "session":        q["session"] if q else None,
                })
            except Exception as e:
                logger.warning("[MarketDigestGenerator] ticker quote failed for %s: %s", t, e)
                quotes.append({"ticker": t, "price": None, "change_percent": None, "session": None})
        return quotes

    def _fetch_trading_performance(self, digest_date: date) -> dict:
        """
        Day/week/all-time trade performance for the LIVE account only (paper
        stays in Daily Review's own toggle — see the digest's design
        discussion). "Day" here means the most recently completed session's
        review (yesterday's, from the trader's point of view at 8:30 AM
        pre-market before today has traded), not today's — there are no
        trades yet when this runs.
        """
        try:
            recent = (
                self._sb.table("performance_reviews")
                .select("review_date, net_pnl, trade_count, win_rate, winners, losers, markdown")
                .eq("paper_mode", False)
                .lt("review_date", str(digest_date))
                .order("review_date", desc=True)
                .limit(10)
                .execute()
                .data or []
            )
            all_time = (
                self._sb.table("performance_reviews")
                .select("net_pnl, trade_count, winners")
                .eq("paper_mode", False)
                .lt("review_date", str(digest_date))
                .execute()
                .data or []
            )
        except Exception as e:
            logger.warning("[MarketDigestGenerator] fetch_trading_performance failed: %s", e)
            return {"last_session": None, "week": None, "all_time": None, "advice": ""}

        last_session = None
        if recent:
            r = recent[0]
            last_session = {
                "date": r["review_date"], "net_pnl": r.get("net_pnl") or 0,
                "trade_count": r.get("trade_count") or 0, "win_rate": r.get("win_rate") or 0,
            }

        week_rows = recent[:5]
        week_trades = sum(r.get("trade_count") or 0 for r in week_rows)
        week_winners = sum(r.get("winners") or 0 for r in week_rows)
        week = {
            "net_pnl":     round(sum(r.get("net_pnl") or 0 for r in week_rows), 2),
            "trade_count": week_trades,
            "win_rate":    round(week_winners / week_trades * 100, 1) if week_trades else 0.0,
            "daily":       [{"date": r["review_date"], "net_pnl": r.get("net_pnl") or 0} for r in reversed(week_rows)],
        }

        all_trades = sum(r.get("trade_count") or 0 for r in all_time)
        all_winners = sum(r.get("winners") or 0 for r in all_time)
        all_time_stats = {
            "net_pnl":     round(sum(r.get("net_pnl") or 0 for r in all_time), 2),
            "trade_count": all_trades,
            "win_rate":    round(all_winners / all_trades * 100, 1) if all_trades else 0.0,
        }

        advice = self._generate_advice(last_session, week, all_time_stats, recent)

        return {"last_session": last_session, "week": week, "all_time": all_time_stats, "advice": advice}

    # ── AI narrative (Claude + web search) ──────────────────────────────────────

    def _generate_advice(self, last_session, week, all_time, recent_reviews) -> str:
        if not recent_reviews:
            return ""
        try:
            summary_lines = [
                f"{r['review_date']}: net ${r.get('net_pnl') or 0:+.2f}, "
                f"{r.get('trade_count') or 0} trades, {r.get('win_rate') or 0:.0f}% win rate"
                for r in recent_reviews
            ]
            prompt = (
                "Recent live-account daily reviews (most recent first):\n"
                + "\n".join(summary_lines)
                + f"\n\nRolling week: net ${week['net_pnl']:+.2f} over {week['trade_count']} trades. "
                + f"All-time: net ${all_time['net_pnl']:+.2f} over {all_time['trade_count']} trades.\n\n"
                + "Write the coaching note."
            )
            resp = self._claude.messages.create(
                model=_ADVICE_MODEL,
                max_tokens=200,
                system=_ADVICE_SYSTEM_PROMPT,
                messages=[{"role": "user", "content": prompt}],
            )
            return "".join(b.text for b in resp.content if getattr(b, "type", None) == "text").strip()
        except Exception as e:
            logger.warning("[MarketDigestGenerator] generate_advice failed: %s", e)
            return ""

    def _call_claude(self, digest_date: date, macro: list[dict], watchlist_quotes: list[dict], movers: dict) -> dict:
        try:
            prompt = self._build_prompt(digest_date, macro, watchlist_quotes, movers)
            tools = [{
                "type": "web_search_20250305",
                "name": "web_search",
                "max_uses": _MAX_WEB_SEARCHES,
                "allowed_domains": _ALLOWED_DOMAINS,
            }]
            working_messages = [{"role": "user", "content": prompt}]
            final_text = ""

            # Guard against runaway server-tool loops — same pattern as
            # AnthropicService.stream_agent_chat.
            for _ in range(5):
                resp = self._claude.messages.create(
                    model=_CLAUDE_MODEL,
                    max_tokens=_MAX_TOKENS,
                    system=_SYSTEM_PROMPT,
                    messages=working_messages,
                    tools=tools,
                )
                if resp.stop_reason == "pause_turn":
                    working_messages.append({"role": "assistant", "content": resp.content})
                    continue
                final_text = "".join(b.text for b in resp.content if getattr(b, "type", None) == "text")
                break

            return self._parse_ai_json(final_text)
        except Exception as e:
            logger.error("[MarketDigestGenerator] Claude call failed: %s", e, exc_info=True)
            return {}

    @staticmethod
    def _parse_ai_json(text: str) -> dict:
        cleaned = text.strip()
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
        try:
            return json.loads(cleaned)
        except (json.JSONDecodeError, TypeError) as e:
            logger.error("[MarketDigestGenerator] Failed to parse AI JSON: %s — raw: %s", e, text[:500])
            return {}

    def _build_prompt(self, digest_date: date, macro: list[dict], watchlist_quotes: list[dict], movers: dict) -> str:
        now_et = datetime.now(ET)
        lines = [
            f"Today's date: {digest_date.strftime('%A, %B %d, %Y')}. Current time: {now_et.strftime('%-I:%M %p ET')}.",
            "",
            "### Live macro levels (already fetched — do not re-derive)",
        ]
        for s in macro:
            unit = "%" if s["kind"] == "yield" else ""
            chg = f" ({s['change_percent']:+.2f}%)" if s["change_percent"] is not None else ""
            lines.append(f"  {s['label']}: {s['value']}{unit}{chg}")

        lines.append("")
        lines.append("### Watchlist tickers (need one catalyst entry each)")
        for q in watchlist_quotes:
            chg = f" {q['change_percent']:+.2f}%" if q["change_percent"] is not None else " (no quote)"
            lines.append(f"  {q['ticker']}{chg}")

        lines.append("")
        lines.append("### Market-wide movers (need one reason entry each)")
        for m in movers.get("gainers", []):
            lines.append(f"  GAINER {m['ticker']} {m.get('change_percent')}%")
        for m in movers.get("losers", []):
            lines.append(f"  LOSER {m['ticker']} {m.get('change_percent')}%")

        lines.append("")
        lines.append("Search live for headlines, catalysts, earnings, and the economic "
                      "calendar, then return the JSON object described in your system prompt.")
        return "\n".join(lines)

    # ── Merge helpers ────────────────────────────────────────────────────────

    @staticmethod
    def _merge_catalysts(watchlist_quotes: list[dict], catalysts: dict) -> list[dict]:
        out = []
        for q in watchlist_quotes:
            c = catalysts.get(q["ticker"], {}) if isinstance(catalysts, dict) else {}
            out.append({
                **q,
                "catalyst": c.get("catalyst", "No news"),
                "level":    c.get("level"),
            })
        return out

    @staticmethod
    def _merge_mover_reasons(movers: dict, reasons: dict) -> dict:
        def merge(rows):
            out = []
            for m in rows:
                out.append({**m, "reason": (reasons or {}).get(m["ticker"], "")})
            return out
        return {"gainers": merge(movers.get("gainers", [])), "losers": merge(movers.get("losers", []))}
