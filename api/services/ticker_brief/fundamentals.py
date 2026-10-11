"""
Invest tab fundamentals (handoff spec 6, 2026-10-11) — one payload for the
ticker sheet's Invest tab: valuation, profitability, growth, risk, 52-week
range, analyst consensus, about, and the revenue actual + estimates chart.

All of it is Yahoo via yfinance — no new data provider:
  metrics    Ticker.info (null-safe; the tab hides any card with no data)
  consensus  Ticker.recommendations, current-month row (strongBuy+buy /
             hold / sell+strongSell) + info's mean/high/low target
  revenue    actuals: Ticker.financials "Total Revenue", last 4 fiscal years
             estimates: Ticker.revenue_estimate (Yahoo earningsTrend through
             yfinance's own authenticated session) — the 0y / +1y annual rows
             FY labels come from each fiscal year's END date (NVDA's FY ends
             in January, IREN's in June), never calendar years. A ticker with
             no analyst coverage gets actuals only — estimates are never
             invented.

Caching: per-process (fetch.cached) in front of Supabase `ticker_fundamentals`
— metrics refresh every 6h, revenue weekly.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone

from services.ticker_brief.fetch import cached, yf_info, yf_ticker
from services.ticker_brief.sections import _num, _round

logger = logging.getLogger(__name__)

TTL_METRICS = 6 * 3600
TTL_REVENUE = 7 * 86400
TABLE = "ticker_fundamentals"


# ── Pure helpers (unit-testable without yfinance) ────────────────────────────

def fy_label(fy_end_year: int, estimate: bool = False) -> str:
    return f"FY{fy_end_year % 100:02d}{'E' if estimate else ''}"


def dividend_yield_pct(info: dict) -> float | None:
    """Percent. yfinance ≥0.2.54 already reports dividendYield in percent
    (0.44 = 0.44%); dividendRate / price is unit-unambiguous, so prefer it."""
    rate, price = _num(info.get("dividendRate")), _num(info.get("currentPrice") or info.get("regularMarketPrice"))
    if rate and price:
        return round(rate / price * 100, 2)
    return _round(info.get("dividendYield"))


def metrics_from_info(info: dict) -> dict:
    pct = lambda k: _round(_num(info.get(k)) * 100, 1) if _num(info.get(k)) is not None else None  # noqa: E731
    ts_date = lambda k: (  # noqa: E731
        datetime.fromtimestamp(int(info[k]), tz=timezone.utc).date().isoformat()
        if _num(info.get(k)) else None
    )
    rec = info.get("recommendationKey")
    return {
        "name": info.get("longName") or info.get("shortName"),
        "sector": info.get("sector"),
        "industry": info.get("industry"),
        "about": info.get("longBusinessSummary"),
        "price": _round(info.get("currentPrice") or info.get("regularMarketPrice")),
        # Valuation
        "market_cap": _num(info.get("marketCap")),
        "pe_trailing": _round(info.get("trailingPE"), 1),
        "pe_forward": _round(info.get("forwardPE"), 1),
        "peg": _round(info.get("pegRatio") or info.get("trailingPegRatio")),
        "price_to_book": _round(info.get("priceToBook"), 1),
        "price_to_sales": _round(info.get("priceToSalesTrailing12Months"), 1),
        "ev_to_ebitda": _round(info.get("enterpriseToEbitda"), 1),
        "dividend_yield_pct": dividend_yield_pct(info),
        "ex_dividend_date": ts_date("exDividendDate"),
        # Profitability
        "profit_margin_pct": pct("profitMargins"),
        "operating_margin_pct": pct("operatingMargins"),
        "roe_pct": pct("returnOnEquity"),
        "free_cashflow": _num(info.get("freeCashflow")),
        # Growth
        "revenue_growth_pct": pct("revenueGrowth"),
        "earnings_growth_pct": pct("earningsGrowth"),
        # Risk
        "beta": _round(info.get("beta")),
        "debt_to_equity": _round(info.get("debtToEquity"), 1),
        # Range
        "year_low": _round(info.get("fiftyTwoWeekLow")),
        "year_high": _round(info.get("fiftyTwoWeekHigh")),
        # Analysts
        "recommendation": rec if isinstance(rec, str) and rec != "none" else None,
        "target_mean": _round(info.get("targetMeanPrice")),
        "target_high": _round(info.get("targetHighPrice")),
        "target_low": _round(info.get("targetLowPrice")),
        "analyst_count": int(info["numberOfAnalystOpinions"]) if _num(info.get("numberOfAnalystOpinions")) else None,
        "earnings_date": ts_date("earningsTimestamp") or ts_date("earningsTimestampStart"),
    }


def revenue_series(actuals: list[tuple[datetime, float]], estimates: dict) -> dict:
    """actuals: [(fiscal_year_end, revenue)], any order; estimates:
    {"0y"|"+1y": {"avg","low","high","analysts"}} → chart payload."""
    acts = sorted((d, v) for d, v in actuals if v is not None and v > 0)[-4:]
    bars = [{"label": fy_label(d.year), "fy_end": d.date().isoformat(), "value": v, "estimate": False}
            for d, v in acts]
    if acts:
        last_fy = acts[-1][0].year
        for offset, key in ((1, "0y"), (2, "+1y")):
            e = estimates.get(key)
            if not e or not _num(e.get("avg")):
                continue
            bars.append({
                "label": fy_label(last_fy + offset, estimate=True),
                "value": float(e["avg"]),
                "low": _num(e.get("low")),
                "high": _num(e.get("high")),
                "analysts": int(e["analysts"]) if _num(e.get("analysts")) else None,
                "estimate": True,
            })
    est = [b for b in bars if b["estimate"]]
    return {
        "bars": bars,
        "has_estimates": bool(est),
        "analysts": max((b.get("analysts") or 0 for b in est), default=None) or None,
    }


def consensus_counts(rec_rows: list[dict]) -> dict | None:
    """Ticker.recommendations rows → current month's buy/hold/sell."""
    row = next((r for r in rec_rows if str(r.get("period")) == "0m"), rec_rows[0] if rec_rows else None)
    if not row:
        return None
    g = lambda k: int(_num(row.get(k)) or 0)  # noqa: E731
    counts = {"buy": g("strongBuy") + g("buy"), "hold": g("hold"), "sell": g("sell") + g("strongSell")}
    return counts if sum(counts.values()) else None


# ── Fetch ────────────────────────────────────────────────────────────────────

def _fetch_revenue(symbol: str) -> dict:
    tk = yf_ticker(symbol)
    actuals: list[tuple[datetime, float]] = []
    try:
        fin = tk.financials
        if fin is not None and not fin.empty and "Total Revenue" in fin.index:
            for col, v in fin.loc["Total Revenue"].items():
                if _num(v) is not None and hasattr(col, "year"):
                    actuals.append((col.to_pydatetime() if hasattr(col, "to_pydatetime") else col, float(v)))
    except Exception as e:
        logger.info("[fundamentals] %s financials failed: %s", symbol, e)

    estimates: dict = {}
    try:
        df = tk.revenue_estimate
        if df is not None and not df.empty:
            for key in ("0y", "+1y"):
                if key in df.index:
                    r = df.loc[key]
                    estimates[key] = {
                        "avg": _num(r.get("avg")), "low": _num(r.get("low")),
                        "high": _num(r.get("high")), "analysts": _num(r.get("numberOfAnalysts")),
                    }
    except Exception as e:
        logger.info("[fundamentals] %s revenue estimates failed: %s", symbol, e)

    return revenue_series(actuals, estimates)


def _fetch_consensus(symbol: str) -> dict | None:
    try:
        df = yf_ticker(symbol).recommendations
        if df is None or df.empty:
            return None
        return consensus_counts(df.to_dict("records"))
    except Exception as e:
        logger.info("[fundamentals] %s recommendations failed: %s", symbol, e)
        return None


# ── Supabase layer ───────────────────────────────────────────────────────────

def _db():
    try:
        from services.supabase.supabase_service import get_supabase_service
        return get_supabase_service().client
    except Exception:
        return None


def _db_read(symbol: str) -> dict | None:
    client = _db()
    if not client:
        return None
    try:
        res = client.table(TABLE).select("*").eq("ticker", symbol).limit(1).execute()
        return res.data[0] if res.data else None
    except Exception as e:
        logger.info("[fundamentals] cache read failed %s: %s", symbol, e)
        return None


def _db_write(symbol: str, patch: dict) -> None:
    client = _db()
    if not client:
        return
    try:
        client.table(TABLE).upsert({"ticker": symbol, **patch}, on_conflict="ticker").execute()
    except Exception as e:
        logger.info("[fundamentals] cache write failed %s: %s", symbol, e)


def _age_s(iso: str | None) -> float:
    if not iso:
        return float("inf")
    try:
        dt = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except ValueError:
        return float("inf")
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - dt).total_seconds()


def _load(symbol: str) -> dict:
    row = _db_read(symbol) or {}
    now_iso = datetime.now(timezone.utc).isoformat()
    patch: dict = {}

    metrics = row.get("metrics")
    if not metrics or _age_s(row.get("metrics_fetched_at")) > TTL_METRICS:
        try:
            info = yf_info(symbol, TTL_METRICS)
            metrics = metrics_from_info(info)
            metrics["consensus"] = _fetch_consensus(symbol)
            patch.update(metrics=metrics, metrics_fetched_at=now_iso)
        except Exception:
            if not metrics:
                raise
            logger.info("[fundamentals] %s refresh failed — serving stored metrics", symbol)

    revenue = row.get("revenue")
    if not revenue or _age_s(row.get("revenue_fetched_at")) > TTL_REVENUE:
        fresh = _fetch_revenue(symbol)
        # Keep the stored series if Yahoo came back empty this time.
        if fresh["bars"] or not revenue:
            revenue = fresh
            patch.update(revenue=revenue, revenue_fetched_at=now_iso)

    if patch:
        _db_write(symbol, patch)
    return {**metrics, "revenue": revenue}


def build_fundamentals(symbol: str):
    value, fetched_at = cached(f"fundamentals:{symbol}", TTL_METRICS, lambda: _load(symbol))
    return value, TTL_METRICS, fetched_at or time.time()
