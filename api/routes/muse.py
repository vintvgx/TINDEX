"""
Muse routes — a small, key-protected API that lets Muse (the user's personal
AI assistant, running outside this app) read trading context and set
watch-type items. Everything lives under /muse and is deliberately separate
from the app's own routes: those take a Supabase userId per request and have
no auth suitable for a third-party caller.

Scope is intentionally "read + watch" only — Muse can read the trade log,
account, positions, chains, stats, reviews, and can create levels,
watchlist contracts, contract price alerts, and notes. It can NOT place or
close orders, edit strategy configs, or start/stop services.

Auth: every route except /muse/openapi.json requires the shared secret in
MUSE_API_KEY, sent as `X-Muse-Key: <key>` (preferred), `Authorization:
Bearer <key>`, or `?key=<key>` for GET-only clients. If MUSE_API_KEY is
unset the whole blueprint returns 503 — it's off by default.

Rows Muse creates (levels, watchlist, alerts) are owned by MUSE_USER_ID —
the Supabase auth user id of the app's owner — since Muse has no Supabase
session of its own.

The machine-readable contract for all of this is GET /muse/openapi.json,
built from _OPENAPI below — keep it in sync when adding/changing a route.
"""

import hmac
import os
import re
import concurrent.futures
from datetime import date, datetime, timedelta, timezone

import pytz
from flask import Blueprint, jsonify, request

from log.logging_config import get_logger
from services.supabase.supabase_service import get_supabase_service
from services.utils.market_hours import is_market_hours

logger = get_logger(__name__)

bp = Blueprint("muse", __name__, url_prefix="/muse")

ET = pytz.timezone("America/New_York")
_TICKER_RE = re.compile(r"^[A-Z0-9]{1,5}$")
_OCC_RE = re.compile(r"^([A-Z]{1,6})(\d{6})([CP])(\d{8})$")
_MUSE_NOTE_PREFIX = "[Muse] "


# ── Auth + envelope ────────────────────────────────────────────────────────────

def _provided_key() -> str:
    key = request.headers.get("X-Muse-Key", "").strip()
    if key:
        return key
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth.removeprefix("Bearer ").strip()
    return (request.args.get("key") or "").strip()


@bp.before_request
def _require_muse_key():
    if request.endpoint == "muse.openapi_spec":
        return None
    expected = os.getenv("MUSE_API_KEY", "")
    if not expected:
        return _err("Muse API is disabled — MUSE_API_KEY is not set on the server", 503)
    provided = _provided_key()
    # Constant-time compare so the key can't be guessed byte-by-byte from timing.
    if not provided or not hmac.compare_digest(provided.encode(), expected.encode()):
        logger.warning("[muse] rejected request to %s — bad or missing key", request.path)
        return _err("Invalid or missing Muse API key", 401)
    return None


def _meta() -> dict:
    return {
        "as_of": datetime.now(ET).isoformat(timespec="seconds"),
        "market_open": is_market_hours(),
    }


def _ok(data, status: int = 200):
    return jsonify({"success": True, "data": data, "error": None, **_meta()}), status


def _err(message: str, status: int = 400):
    return jsonify({"success": False, "data": None, "error": message, **_meta()}), status


def _muse_user_id() -> str:
    user_id = os.getenv("MUSE_USER_ID", "")
    if not user_id:
        raise RuntimeError("MUSE_USER_ID is not set on the server")
    return user_id


_notifier = None


def _notify_change(title: str, body: str, data: dict | None = None) -> None:
    """Push "Muse did X" to the user's devices. Never fails the request —
    the write already happened; a missed push is only logged."""
    global _notifier
    try:
        if _notifier is None:
            # One shared instance: each StrategyNotifier starts its own drain thread.
            from services.strategy.notifier import StrategyNotifier
            _notifier = StrategyNotifier(get_supabase_service().client)
        _notifier.notify_muse_change(title, body, data)
    except Exception as e:
        logger.warning("[muse] change notification failed: %s", e)


def _level_label(row: dict) -> str:
    low, high = float(row["level_low"]), float(row["level_high"])
    price = f"${low:g}" if low == high else f"${low:g}–${high:g}"
    side = {"bullish": "above", "bearish": "below"}.get(row.get("direction"), "either way through")
    return f"{row['ticker']} {side} {price}"


def _ticker_arg(raw: str | None) -> str | None:
    ticker = (raw or "").strip().upper().lstrip("$")
    return ticker if _TICKER_RE.match(ticker) else None


def _parse_date(raw: str | None) -> date | None:
    if not raw:
        return None
    if raw.lower() == "today":
        return datetime.now(ET).date()
    try:
        return date.fromisoformat(raw)
    except ValueError:
        return None


def _run_async(coro):
    import asyncio
    loop = asyncio.new_event_loop()
    try:
        asyncio.set_event_loop(loop)
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def _occ_symbol(ticker: str, expiration: str, option_type: str, strike: float) -> str:
    """ticker + YYMMDD + C|P + strike*1000 zero-padded to 8 — the OCC format Alpaca uses."""
    exp = date.fromisoformat(expiration)
    cp = "C" if option_type.upper().startswith("C") else "P"
    return f"{ticker}{exp:%y%m%d}{cp}{int(round(strike * 1000)):08d}"


def _parse_occ(symbol: str) -> dict | None:
    m = _OCC_RE.match(symbol)
    if not m:
        return None
    ticker, yymmdd, cp, strike_raw = m.groups()
    exp = datetime.strptime(yymmdd, "%y%m%d").date()
    return {
        "ticker": ticker,
        "expiration": exp.isoformat(),
        "option_type": "CALL" if cp == "C" else "PUT",
        "strike": int(strike_raw) / 1000,
    }


def _alpaca_client(paper: bool):
    from alpaca.trading.client import TradingClient
    key = os.getenv("ALPACA_PAPER_API_KEY" if paper else "ALPACA_LIVE_API_KEY")
    secret = os.getenv("ALPACA_PAPER_SECRET_KEY" if paper else "ALPACA_LIVE_SECRET_KEY")
    return TradingClient(key, secret, paper=paper)


def _mid(bid, ask) -> float | None:
    bid, ask = bid or 0, ask or 0
    if bid > 0 and ask > 0:
        return round((bid + ask) / 2, 4)
    return None


def _slim_contract(c: dict, spot: float | None = None) -> dict:
    """Option contract trimmed to what Muse needs to pick a strike."""
    bid, ask = c.get("bid") or 0, c.get("ask") or 0
    mid = _mid(bid, ask)
    out = {
        "symbol": c.get("symbol"),
        "type": c.get("option_type"),
        "strike": c.get("strike"),
        "expiration": c.get("expiration"),
        "bid": bid,
        "ask": ask,
        "mid": mid,
        "last": c.get("last_price"),
        "spread_pct": round((ask - bid) / ask * 100, 1) if ask > 0 else None,
        "volume": c.get("volume"),
        "open_interest": c.get("open_interest"),
        "iv": c.get("implied_volatility"),
        "delta": c.get("delta"),
        "gamma": c.get("gamma"),
        "theta": c.get("theta"),
        "vega": c.get("vega"),
        # Cost of one contract at mid — what Muse should compare against
        # options_buying_power when sizing a suggestion.
        "cost_per_contract": round(mid * 100, 2) if mid else None,
    }
    if spot and c.get("strike"):
        strike = c["strike"]
        itm = strike < spot if c.get("option_type") == "CALL" else strike > spot
        out["moneyness"] = "ITM" if itm else "OTM"
        out["pct_from_spot"] = round((strike - spot) / spot * 100, 2)
    return out


# ── Data builders (shared by the single routes and /muse/summary) ─────────────

def _build_account() -> dict:
    """Live Alpaca account only — balances plus period P&L."""
    from alpaca.trading.requests import GetPortfolioHistoryRequest

    client = _alpaca_client(paper=False)
    acct = client.get_account()
    equity = float(acct.equity)
    last_equity = float(acct.last_equity)
    pnl_today = equity - last_equity

    out = {
        "account": "live",
        "equity": round(equity, 2),
        "cash": round(float(acct.cash), 2),
        "buying_power": round(float(acct.buying_power), 2),
        "options_buying_power": round(float(acct.options_buying_power or 0), 2),
        "available_balance": round(float(acct.non_marginable_buying_power or 0), 2),
        "long_market_value": round(float(acct.long_market_value or 0), 2),
        "day_trade_count": acct.daytrade_count or 0,
        "pnl_today": round(pnl_today, 2),
        "pnl_today_pct": round(pnl_today / last_equity * 100, 2) if last_equity > 0 else 0,
        "pnl_week": None,
        "pnl_month": None,
        "pnl_ytd": None,
        "pnl_all_time": None,
    }

    # Same approach as /strategy/accounts/history: Alpaca's profit_loss series
    # already excludes deposits/withdrawals, so deltas of it are real trading P&L.
    try:
        hist = client.get_portfolio_history(GetPortfolioHistoryRequest(period="all", timeframe="1D"))
        stamps = list(hist.timestamp or [])
        pls = [float(p) if p is not None else None for p in (hist.profit_loss or [])]
        latest = next((p for p in reversed(pls) if p is not None), None)
        if stamps and latest is not None:
            def _since(ts: float):
                idx = 0
                for i, t in enumerate(stamps):
                    if t <= ts:
                        idx = i
                    else:
                        break
                return round(latest - pls[idx], 2) if pls[idx] is not None else None

            now_ts = stamps[-1]
            jan1 = datetime(datetime.now(ET).year, 1, 1, tzinfo=timezone.utc).timestamp()
            out["pnl_week"] = _since(now_ts - 7 * 86400)
            out["pnl_month"] = _since(now_ts - 30 * 86400)
            out["pnl_ytd"] = _since(jan1)
            out["pnl_all_time"] = round(latest - pls[0], 2) if pls[0] is not None else None
    except Exception as e:
        logger.warning("[muse] portfolio history failed: %s", e)

    return out


def _build_positions() -> list[dict]:
    """Open LIVE positions from Alpaca, enriched with the app's stop/TP state where an engine manages it."""
    from routes.strategy_routes import _all_engines, _engine_position_response

    managed: dict[str, dict] = {}
    for sid, eng in _all_engines():
        if eng.paper or not eng.trade_taken or not eng.contract_symbol:
            continue
        try:
            pos = _engine_position_response(eng).get_json()
        except Exception:
            continue
        managed[eng.contract_symbol] = {
            "strategy_id": sid,
            "strategy_name": getattr(eng, "strategy_name", "") or None,
            "profile": pos.get("profile"),
            "hard_stop": pos.get("hard_stop"),
            "tp1": pos.get("tp1"),
            "tp2": pos.get("tp2"),
            "tp1_hit": pos.get("tp1_hit"),
            "sl_enabled": pos.get("sl_enabled"),
            "tp_enabled": pos.get("tp_enabled"),
        }

    out = []
    for p in _alpaca_client(paper=False).get_all_positions():
        symbol = str(p.symbol)
        parsed = _parse_occ(symbol)
        out.append({
            "symbol": symbol,
            "asset": "option" if parsed else "stock",
            **({"ticker": parsed["ticker"], "type": parsed["option_type"],
                "strike": parsed["strike"], "expiration": parsed["expiration"]} if parsed else {"ticker": symbol}),
            "qty": float(p.qty or 0),
            "side": str(p.side).split(".")[-1].lower(),
            "avg_entry_price": round(float(p.avg_entry_price or 0), 4),
            "current_price": round(float(p.current_price or 0), 4),
            "market_value": round(float(p.market_value or 0), 2),
            "unrealized_pnl": round(float(p.unrealized_pl or 0), 2),
            "unrealized_pnl_pct": round(float(p.unrealized_plpc or 0) * 100, 2),
            "managed_by_app": managed.get(symbol),
        })
    return out


_TRADE_FIELDS = (
    "id", "trade_date", "ticker", "profile", "trade_type", "direction", "contract_symbol",
    "strike", "expiry", "qty_entered", "qty_exited", "entry_premium", "exit_premium",
    "entry_time", "exit_time", "exit_reason", "pnl", "pnl_pct", "strategy_id",
    "hard_stop_price", "tp1_price", "tp2_price", "underlying_price_entry", "underlying_price_exit",
)


def _slim_trade(t: dict) -> dict:
    out = {k: t.get(k) for k in _TRADE_FIELDS}
    out["account"] = "paper" if t.get("paper_mode", True) else "live"
    out["status"] = "open" if t.get("exit_time") is None else "closed"
    if out["status"] == "open":
        out["live_price"] = t.get("live_price")
        out["live_pnl"] = t.get("live_pnl")
        out["live_pnl_pct"] = t.get("live_pnl_pct")
    return out


def _query_trades(start: date | None, end: date | None, ticker: str | None,
                  status: str | None, account: str, limit: int) -> list[dict]:
    from routes.strategy_routes import logger_svc
    from services.strategy.trade_logger import enrich_open_trades_with_live_pnl

    q = logger_svc.client.table("orb_trades").select("*").order("entry_time", desc=True).limit(limit)
    if start:
        q = q.gte("trade_date", start.isoformat())
    if end:
        q = q.lte("trade_date", end.isoformat())
    if ticker:
        q = q.eq("ticker", ticker)
    if status == "open":
        q = q.is_("exit_time", "null")
    elif status == "closed":
        q = q.not_.is_("exit_time", "null")
    if account in ("live", "paper"):
        q = q.eq("paper_mode", account == "paper")
    rows = q.execute().data or []
    rows = enrich_open_trades_with_live_pnl(rows)
    return [_slim_trade(t) for t in rows]


def _trade_totals(trades: list[dict]) -> dict:
    closed = [t for t in trades if t["status"] == "closed"]
    realized = sum(t.get("pnl") or 0 for t in closed)
    unrealized = sum(t.get("live_pnl") or 0 for t in trades if t["status"] == "open")
    return {
        "count": len(trades),
        "open": len(trades) - len(closed),
        "closed": len(closed),
        "wins": sum(1 for t in closed if (t.get("pnl") or 0) > 0),
        "losses": sum(1 for t in closed if (t.get("pnl") or 0) < 0),
        "realized_pnl": round(realized, 2),
        "unrealized_pnl": round(unrealized, 2),
    }


def _list_levels(status: str | None = "watching") -> list[dict]:
    sb = get_supabase_service().client
    q = sb.table("watched_price_levels").select("*").eq("user_id", _muse_user_id())
    if status and status != "all":
        q = q.eq("status", status)
    return q.order("created_at", desc=True).execute().data or []


def _list_watchlist(status: str | None = "tracking") -> list[dict]:
    result = get_supabase_service().get_tracked_contracts(
        _muse_user_id(), None if status == "all" else status)
    if not result.get("success"):
        raise RuntimeError(result.get("error") or "Failed to load watchlist")
    return result.get("data") or []


def _list_contract_alerts(status: str | None = "watching") -> list[dict]:
    sb = get_supabase_service().client
    q = sb.table("contract_price_alerts").select("*").eq("user_id", _muse_user_id())
    if status and status != "all":
        q = q.eq("status", status)
    return q.order("created_at", desc=True).execute().data or []


def _pending_confirmations() -> list[dict]:
    from routes.strategy_routes import logger_svc
    return logger_svc.list_open_pending_confirmations()


# ── Summary ─────────────────────────────────────────────────────────────────────

@bp.route("/summary", methods=["GET"])
def summary():
    """Everything Muse needs at the start of a conversation, in one call."""
    today = datetime.now(ET).date()
    jobs = {
        "account": _build_account,
        "positions": _build_positions,
        "trades_today": lambda: _query_trades(today, today, None, None, "all", 100),
        "levels": _list_levels,
        "watchlist": _list_watchlist,
        "contract_alerts": _list_contract_alerts,
        "pending_confirmations": _pending_confirmations,
    }
    out: dict = {}
    errors: dict = {}
    # Independent I/O (Alpaca + Supabase) — run concurrently so the summary
    # costs about as long as its slowest piece, not the sum of all of them.
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(jobs)) as pool:
        futures = {pool.submit(fn): name for name, fn in jobs.items()}
        for fut in concurrent.futures.as_completed(futures):
            name = futures[fut]
            try:
                out[name] = fut.result()
            except Exception as e:
                logger.warning("[muse/summary] %s failed: %s", name, e)
                out[name] = None
                errors[name] = str(e)
    if out.get("trades_today") is not None:
        out["trades_today_totals"] = _trade_totals(out["trades_today"])
    out["partial_errors"] = errors or None
    return _ok(out)


# ── Identity (debugging "Muse wrote it but the app doesn't show it") ─────────

@bp.route("/whoami", methods=["GET"])
def whoami():
    """
    Which Supabase user Muse's rows are owned by. The app only lists rows
    whose user_id is the LOGGED-IN user, so MUSE_USER_ID must be the app
    owner's own id — not a separate "Muse" account — or everything Muse
    creates is invisible in the app.
    """
    try:
        user_id = _muse_user_id()
    except RuntimeError as e:
        return _err(str(e), 500)
    out: dict = {"muse_user_id": user_id, "email": None, "has_push_token": None}
    try:
        res = get_supabase_service().client.auth.admin.get_user_by_id(user_id)
        user = getattr(res, "user", None)
        out["email"] = getattr(user, "email", None)
        out["user_exists"] = user is not None
    except Exception as e:
        out["user_exists"] = False
        out["user_lookup_error"] = str(e)
    try:
        prof = (get_supabase_service().client.table("user_profiles")
                .select("expo_push_token").eq("id", user_id).limit(1).execute().data or [])
        out["has_push_token"] = bool(prof and prof[0].get("expo_push_token"))
    except Exception as e:
        logger.warning("[muse/whoami] profile lookup failed: %s", e)
    try:
        out["watching_levels"] = len(_list_levels("watching"))
    except Exception as e:
        logger.warning("[muse/whoami] level count failed: %s", e)
    return _ok(out)


# ── Account / positions ─────────────────────────────────────────────────────────

@bp.route("/account", methods=["GET"])
def account():
    try:
        return _ok(_build_account())
    except Exception as e:
        logger.error("[muse/account] %s", e, exc_info=True)
        return _err(f"Could not fetch live account: {e}", 502)


@bp.route("/positions", methods=["GET"])
def positions():
    try:
        rows = _build_positions()
        return _ok({
            "positions": rows,
            "count": len(rows),
            "total_market_value": round(sum(p["market_value"] for p in rows), 2),
            "total_unrealized_pnl": round(sum(p["unrealized_pnl"] for p in rows), 2),
        })
    except Exception as e:
        logger.error("[muse/positions] %s", e, exc_info=True)
        return _err(f"Could not fetch live positions: {e}", 502)


# ── Trade log / stats ───────────────────────────────────────────────────────────

@bp.route("/trades", methods=["GET"])
def trades():
    """
    ?date=all|today|YYYY-MM-DD (default all) — or start_date/end_date for a range.
    ?ticker= ?status=open|closed ?account=live|paper|all (default all) ?limit= (default 50, max 500)
    """
    date_arg = (request.args.get("date") or "all").strip().lower()
    start = end = None
    if date_arg != "all":
        start = end = _parse_date(date_arg)
        if not start:
            return _err("date must be 'all', 'today', or YYYY-MM-DD")
    if request.args.get("start_date") or request.args.get("end_date"):
        start = _parse_date(request.args.get("start_date")) or start
        end = _parse_date(request.args.get("end_date")) or end

    ticker = None
    if request.args.get("ticker"):
        ticker = _ticker_arg(request.args.get("ticker"))
        if not ticker:
            return _err("Invalid ticker")

    status = request.args.get("status")
    if status and status not in ("open", "closed"):
        return _err("status must be 'open' or 'closed'")
    account_arg = request.args.get("account", "all")
    if account_arg not in ("live", "paper", "all"):
        return _err("account must be 'live', 'paper', or 'all'")
    limit = min(max(request.args.get("limit", 50, type=int), 1), 500)

    try:
        rows = _query_trades(start, end, ticker, status, account_arg, limit)
        return _ok({"trades": rows, "totals": _trade_totals(rows), "limit": limit})
    except Exception as e:
        logger.error("[muse/trades] %s", e, exc_info=True)
        return _err(f"Failed to load trades: {e}", 500)


_PERIOD_DAYS = {"today": 0, "week": 7, "month": 30}


@bp.route("/stats", methods=["GET"])
def stats():
    """?period=today|week|month|ytd|all (default all) ?account=live|paper|all (default live)"""
    from routes.strategy_routes import logger_svc

    period = request.args.get("period", "all")
    account_arg = request.args.get("account", "live")
    if period not in ("today", "week", "month", "ytd", "all"):
        return _err("period must be today|week|month|ytd|all")
    if account_arg not in ("live", "paper", "all"):
        return _err("account must be 'live', 'paper', or 'all'")

    today = datetime.now(ET).date()
    since = None
    if period in _PERIOD_DAYS:
        since = today - timedelta(days=_PERIOD_DAYS[period])
    elif period == "ytd":
        since = date(today.year, 1, 1)

    try:
        q = (logger_svc.client.table("orb_trades")
             .select("pnl, pnl_pct, entry_time, profile, ticker, trade_date, paper_mode")
             .not_.is_("exit_time", "null"))
        if since:
            q = q.gte("trade_date", since.isoformat())
        if account_arg != "all":
            q = q.eq("paper_mode", account_arg == "paper")
        rows = q.execute().data or []
    except Exception as e:
        logger.error("[muse/stats] %s", e, exc_info=True)
        return _err(f"Failed to load stats: {e}", 500)

    def _summarise(group: list[dict]) -> dict:
        base = logger_svc._compute_stats_from_rows(group)
        gross_win = sum(r.get("pnl") or 0 for r in group if (r.get("pnl") or 0) > 0)
        gross_loss = abs(sum(r.get("pnl") or 0 for r in group if (r.get("pnl") or 0) < 0))
        base["profit_factor"] = round(gross_win / gross_loss, 2) if gross_loss > 0 else None
        base["avg_pnl_pct"] = (round(sum(r.get("pnl_pct") or 0 for r in group) / len(group), 2)
                               if group else 0)
        return base

    def _group(key_fn) -> dict[str, list]:
        groups: dict[str, list] = {}
        for r in rows:
            k = key_fn(r)
            if k is not None:
                groups.setdefault(k, []).append(r)
        return groups

    def _entry_hour(r):
        raw = r.get("entry_time")
        if not raw:
            return None
        try:
            dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = pytz.utc.localize(dt)
            return f"{dt.astimezone(ET).hour:02d}:00"
        except ValueError:
            return None

    return _ok({
        "period": period,
        "since": since.isoformat() if since else None,
        "account": account_arg,
        "overall": _summarise(rows),
        "by_profile": {k: _summarise(v) for k, v in _group(lambda r: r.get("profile")).items()},
        "by_ticker": {k: _summarise(v) for k, v in _group(lambda r: r.get("ticker")).items()},
        "by_entry_hour_et": {k: _summarise(v) for k, v in sorted(_group(_entry_hour).items())},
    })


# ── Market data ─────────────────────────────────────────────────────────────────

@bp.route("/quote/<ticker>", methods=["GET"])
def quote(ticker: str):
    """Live-ish price + day change, daily technicals, and support/resistance."""
    t = _ticker_arg(ticker)
    if not t:
        return _err("Invalid ticker")

    from services.technical_service import get_technicals, get_support_resistance

    def _price():
        import yfinance as yf
        fi = yf.Ticker(t).fast_info
        last = float(fi.last_price)
        prev = float(fi.previous_close) if fi.previous_close else None
        return {
            "price": round(last, 4),
            "previous_close": round(prev, 4) if prev else None,
            "change": round(last - prev, 4) if prev else None,
            "change_pct": round((last - prev) / prev * 100, 2) if prev else None,
            "day_high": round(float(fi.day_high), 4) if fi.day_high else None,
            "day_low": round(float(fi.day_low), 4) if fi.day_low else None,
            "volume": int(fi.last_volume) if fi.last_volume else None,
        }

    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        f_price = pool.submit(_price)
        f_tech = pool.submit(get_technicals, t)
        f_sr = pool.submit(get_support_resistance, t)
        try:
            price = f_price.result()
        except Exception as e:
            logger.warning("[muse/quote] price fetch failed for %s: %s", t, e)
            price = None
        tech = f_tech.result()
        sr = f_sr.result()

    if price is None and tech.get("error"):
        return _err(f"No data for {t}: {tech.get('error')}", 404)

    technicals = None if tech.get("error") else {
        k: tech.get(k) for k in ("ema20", "ema50", "ema200", "rsi", "macd_above_signal",
                                 "atr", "trend", "zone", "dist_from_ema20_pct")
    }
    levels = None if sr.get("error") else {
        "support": sr.get("support"),
        "resistance": sr.get("resistance"),
        "pivots": sr.get("pivots"),
    }
    return _ok({"ticker": t, "quote": price, "technicals": technicals, "levels": levels})


@bp.route("/options/<ticker>/expirations", methods=["GET"])
def option_expirations(ticker: str):
    """?days= how far out to look (default 60, max 400)."""
    t = _ticker_arg(ticker)
    if not t:
        return _err("Invalid ticker")
    days = min(max(request.args.get("days", 60, type=int), 1), 400)
    today = datetime.now(ET).date()
    try:
        from services.alpaca.alpaca_option_service import get_alpaca_option_service
        result = _run_async(get_alpaca_option_service().get_options(
            ticker=t, limit=1,
            expiration_date_gte=today.isoformat(),
            expiration_date_lte=(today + timedelta(days=days)).isoformat(),
        ))
        exps = result.get("expirations_fetched") or []
        return _ok({
            "ticker": t,
            "underlying_price": result.get("current_price"),
            "expirations": [
                {"date": e, "dte": (date.fromisoformat(e) - today).days,
                 "weekday": date.fromisoformat(e).strftime("%a")}
                for e in exps
            ],
        })
    except Exception as e:
        logger.error("[muse/options/expirations] %s: %s", t, e, exc_info=True)
        return _err(f"Failed to load expirations: {e}", 502)


@bp.route("/options/<ticker>", methods=["GET"])
def option_chain(ticker: str):
    """
    Trimmed chain for ONE expiration.
    ?expiration=YYYY-MM-DD (default: nearest) ?type=call|put|both (default both)
    ?strikes=N strikes per side around spot (default 10, max 40) ?min_oi= ?min_volume=
    """
    t = _ticker_arg(ticker)
    if not t:
        return _err("Invalid ticker")

    opt_type = (request.args.get("type") or "both").lower()
    if opt_type not in ("call", "put", "both"):
        return _err("type must be call|put|both")
    strikes = min(max(request.args.get("strikes", 10, type=int), 1), 40)
    min_oi = request.args.get("min_oi", 0, type=int)
    min_volume = request.args.get("min_volume", 0, type=int)

    today = datetime.now(ET).date()
    expiration = request.args.get("expiration")
    if expiration and not _parse_date(expiration):
        return _err("expiration must be YYYY-MM-DD")

    try:
        from services.alpaca.alpaca_option_service import get_alpaca_option_service
        svc = get_alpaca_option_service()
        if not expiration:
            # Nearest expiration within the next 2 weeks (covers weekly/0DTE tickers).
            probe = _run_async(svc.get_options(
                ticker=t, limit=1, expiration_date_gte=today.isoformat(),
                expiration_date_lte=(today + timedelta(days=14)).isoformat()))
            exps = probe.get("expirations_fetched") or []
            if not exps:
                return _err(f"No expirations found for {t} in the next 14 days — pass ?expiration=", 404)
            expiration = exps[0]

        # limit is per side, nearest-to-spot — 2*strikes gives N above + N below.
        result = _run_async(svc.get_options(
            ticker=t, limit=strikes * 2,
            expiration_date_gte=expiration, expiration_date_lte=expiration))
    except Exception as e:
        logger.error("[muse/options] %s: %s", t, e, exc_info=True)
        return _err(f"Failed to load option chain: {e}", 502)

    spot = result.get("current_price") or None

    def _side(rows: list[dict]) -> list[dict]:
        return [
            _slim_contract(c, spot) for c in rows
            if (c.get("open_interest") or 0) >= min_oi and (c.get("volume") or 0) >= min_volume
        ]

    data = {
        "ticker": t,
        "underlying_price": spot,
        "expiration": expiration,
        "dte": (date.fromisoformat(expiration) - today).days,
    }
    if opt_type in ("call", "both"):
        data["calls"] = _side(result.get("calls") or [])
    if opt_type in ("put", "both"):
        data["puts"] = _side(result.get("puts") or [])
    return _ok(data)


def _fetch_contract(symbol: str) -> dict | None:
    """Single-contract snapshot. Direct snapshot request first (fast); full-chain lookup as fallback."""
    from services.alpaca.alpaca_option_service import get_alpaca_option_service
    svc = get_alpaca_option_service()
    parsed = _parse_occ(symbol)
    try:
        from alpaca.data.requests import OptionSnapshotRequest
        snaps = svc.options_client.get_option_snapshot(OptionSnapshotRequest(symbol_or_symbols=[symbol]))
        snap = snaps.get(symbol) if snaps else None
        if snap is not None:
            return svc._extract_contract(symbol, snap, parsed["ticker"] if parsed else "")
    except Exception as e:
        logger.info("[muse] direct snapshot failed for %s, falling back to chain: %s", symbol, e)
    return _run_async(svc.get_contract_snapshot(symbol))


def _resolve_contract_symbol(body_or_args) -> tuple[str | None, str | None]:
    """Accept either an OCC `symbol` or ticker+expiration+type+strike. Returns (symbol, error)."""
    symbol = (body_or_args.get("symbol") or "").strip().upper()
    if symbol:
        return (symbol, None) if _OCC_RE.match(symbol) else (None, "symbol must be an OCC option symbol like NBIS251003C00250000")
    ticker = _ticker_arg(body_or_args.get("ticker"))
    expiration = body_or_args.get("expiration")
    opt_type = (body_or_args.get("type") or "").lower()
    strike = body_or_args.get("strike")
    if not (ticker and expiration and opt_type in ("call", "put") and strike is not None):
        return None, "Pass either symbol, or ticker + expiration (YYYY-MM-DD) + type (call|put) + strike"
    if not _parse_date(expiration):
        return None, "expiration must be YYYY-MM-DD"
    try:
        return _occ_symbol(ticker, expiration, opt_type, float(strike)), None
    except (TypeError, ValueError):
        return None, "strike must be a number"


@bp.route("/contract", methods=["GET"])
def contract():
    """?symbol=OCC  — or ?ticker=&expiration=&type=&strike="""
    symbol, error = _resolve_contract_symbol(request.args)
    if error:
        return _err(error)
    try:
        c = _fetch_contract(symbol)
    except Exception as e:
        logger.error("[muse/contract] %s: %s", symbol, e, exc_info=True)
        return _err(f"Failed to load contract: {e}", 502)
    if not c:
        return _err(f"No quote found for {symbol} — check the strike/expiration exist", 404)
    parsed = _parse_occ(symbol) or {}
    data = _slim_contract(c)
    if parsed.get("expiration"):
        data["dte"] = (date.fromisoformat(parsed["expiration"]) - datetime.now(ET).date()).days
    return _ok(data)


# ── Price levels (underlying) ───────────────────────────────────────────────────

_LEVEL_DIRECTIONS = {"above": "bullish", "below": "bearish", "either": "either",
                     "bullish": "bullish", "bearish": "bearish"}


@bp.route("/levels", methods=["GET"])
def list_levels():
    """?status=watching|confirmed|cancelled|all (default watching) ?ticker="""
    try:
        rows = _list_levels(request.args.get("status", "watching"))
        ticker = _ticker_arg(request.args.get("ticker"))
        if ticker:
            rows = [r for r in rows if r.get("ticker") == ticker]
        return _ok({"levels": rows, "count": len(rows)})
    except Exception as e:
        logger.error("[muse/levels GET] %s", e, exc_info=True)
        return _err(f"Failed to load levels: {e}", 500)


@bp.route("/levels", methods=["POST"])
def create_level():
    """
    Body: { ticker, price, direction: above|below|either, price_high?, target?, note? }
    `above` fires when a 1-minute bar CLOSES above price; `below` when one closes below it.
    """
    data = request.get_json(silent=True) or {}
    ticker = _ticker_arg(data.get("ticker"))
    if not ticker:
        return _err("ticker is required (1-5 letters)")
    direction = _LEVEL_DIRECTIONS.get((data.get("direction") or "").lower())
    if not direction:
        return _err("direction must be 'above', 'below', or 'either'")
    try:
        low = float(data["price"])
        high = float(data["price_high"]) if data.get("price_high") is not None else low
        target = float(data["target"]) if data.get("target") is not None else None
    except (KeyError, TypeError, ValueError):
        return _err("price (and price_high/target if given) must be numbers")
    if low <= 0 or high <= 0:
        return _err("price must be positive")
    if high < low:
        low, high = high, low

    # watched_price_levels has no target column — keep it human-readable in notes.
    note_parts = [_MUSE_NOTE_PREFIX.strip()]
    if target is not None:
        note_parts.append(f"Target ${target:g}.")
    if (data.get("note") or "").strip():
        note_parts.append(data["note"].strip())

    try:
        user_id = _muse_user_id()
        service = get_supabase_service()
        row = {
            "user_id": user_id,
            "ticker": ticker,
            "level_low": low,
            "level_high": high,
            "direction": direction,
            "source": "self",
            "notes": " ".join(note_parts),
            "named_contracts": [],
            "status": "watching",
        }
        result = service.client.table("watched_price_levels").insert(row).execute()
        created = result.data[0] if result.data else None
        if not created:
            return _err("Failed to create level", 500)

        # Same as POST /price-levels: bars only flow for orb_enabled tickers.
        try:
            service.follow_stock(user_id, ticker)
        except Exception as e:
            logger.warning("[muse/levels] follow_stock failed for %s: %s", ticker, e)

        from services.strategy.key_level_watcher import get_key_level_watcher
        get_key_level_watcher().watch_level(created)
        _notify_change("Level watch set", f"Watching {_level_label(created)}",
                       {"screen": "options", "ticker": ticker, "level_id": created["id"]})
        return _ok(created, 201)
    except Exception as e:
        logger.error("[muse/levels POST] %s", e, exc_info=True)
        return _err(f"Failed to create level: {e}", 500)


@bp.route("/levels/<level_id>", methods=["DELETE"])
def delete_level(level_id: str):
    try:
        from services.strategy.key_level_watcher import get_key_level_watcher
        get_key_level_watcher().cancel_level(level_id)
        result = (get_supabase_service().client.table("watched_price_levels")
                  .update({"status": "cancelled"})
                  .eq("id", level_id).eq("user_id", _muse_user_id()).execute())
        if not result.data:
            return _err("Level not found", 404)
        _notify_change("Level watch removed", f"Stopped watching {_level_label(result.data[0])}",
                       {"screen": "options", "ticker": result.data[0]["ticker"]})
        return _ok(result.data[0])
    except Exception as e:
        logger.error("[muse/levels DELETE] %s", e, exc_info=True)
        return _err(f"Failed to cancel level: {e}", 500)


# ── Contract watchlist ──────────────────────────────────────────────────────────

@bp.route("/watchlist/contracts", methods=["GET"])
def list_watchlist():
    """?status=tracking|entered|exited|cancelled|all (default tracking)"""
    try:
        rows = _list_watchlist(request.args.get("status", "tracking"))
        return _ok({"contracts": rows, "count": len(rows)})
    except Exception as e:
        logger.error("[muse/watchlist GET] %s", e, exc_info=True)
        return _err(f"Failed to load watchlist: {e}", 500)


@bp.route("/watchlist/contracts", methods=["POST"])
def add_watchlist_contract():
    """Body: { symbol } or { ticker, expiration, type, strike } — plus optional reason."""
    data = request.get_json(silent=True) or {}
    symbol, error = _resolve_contract_symbol(data)
    if error:
        return _err(error)
    parsed = _parse_occ(symbol)

    from routes.options_routes import build_tracking_snapshot
    snapshot = build_tracking_snapshot(symbol, {
        "expirationDate": parsed["expiration"], "optionType": parsed["option_type"]})
    if not snapshot:
        return _err(f"Alpaca has no quote for {symbol} — check the strike/expiration exist", 404)

    reason = (data.get("reason") or data.get("note") or "").strip()
    try:
        result = get_supabase_service().track_option_contract(_muse_user_id(), {
            "ticker": parsed["ticker"],
            "contract_symbol": symbol,
            "option_type": parsed["option_type"],
            "strike": parsed["strike"],
            "expiration_date": parsed["expiration"],
            "tracking_snapshot": snapshot,
            "tracked_from_source": "muse",
            "tracking_reason": f"{_MUSE_NOTE_PREFIX}{reason}".strip() if reason else _MUSE_NOTE_PREFIX.strip(),
        })
        if not result.get("success"):
            return _err(result.get("error") or "Failed to add contract", 400)
        _notify_change("Contract added to watchlist", reason or symbol,
                       {"screen": "options", "ticker": parsed["ticker"], "contract_symbol": symbol})
        return _ok(result.get("data"), 201)
    except Exception as e:
        logger.error("[muse/watchlist POST] %s", e, exc_info=True)
        return _err(f"Failed to add contract: {e}", 500)


@bp.route("/watchlist/contracts/<contract_id>", methods=["DELETE"])
def delete_watchlist_contract(contract_id: str):
    try:
        result = get_supabase_service().delete_tracked_contract(_muse_user_id(), contract_id)
        if not result.get("success"):
            return _err(result.get("error") or "Contract not found", 404)
        removed = result.get("data") or {}
        _notify_change("Contract removed from watchlist",
                       removed.get("contract_symbol") or "A watched contract was removed",
                       {"screen": "options"})
        return _ok(result.get("data"))
    except Exception as e:
        logger.error("[muse/watchlist DELETE] %s", e, exc_info=True)
        return _err(f"Failed to remove contract: {e}", 500)


# ── Contract price alerts ───────────────────────────────────────────────────────

@bp.route("/contract-alerts", methods=["GET"])
def list_contract_alerts():
    """?status=watching|triggered|cancelled|all (default watching)"""
    try:
        rows = _list_contract_alerts(request.args.get("status", "watching"))
        return _ok({"alerts": rows, "count": len(rows)})
    except Exception as e:
        logger.error("[muse/contract-alerts GET] %s", e, exc_info=True)
        return _err(f"Failed to load alerts: {e}", 500)


@bp.route("/contract-alerts", methods=["POST"])
def create_contract_alert():
    """
    Body: { symbol, target_price }.
    Only works for a contract currently HELD in an app-managed position —
    alerts are checked on that position's live tick stream (see
    contract_alert_routes.py). A contract you're only watching returns 409.
    """
    from routes.strategy_routes import _all_engines

    data = request.get_json(silent=True) or {}
    symbol, error = _resolve_contract_symbol(data)
    if error:
        return _err(error)
    try:
        target = float(data["target_price"])
    except (KeyError, TypeError, ValueError):
        return _err("target_price is required and must be a number")
    if target <= 0:
        return _err("target_price must be positive")

    match = None
    for sid, eng in _all_engines():
        if eng.contract_symbol == symbol and eng.trade_taken and eng.exit_manager:
            # Prefer the live-account engine if the same contract is held in both.
            if match is None or not eng.paper:
                match = (sid, eng)
    if not match:
        return _err(
            f"{symbol} is not an open app-managed position. Contract price alerts only work "
            "on held contracts — for a watched contract, add it to /muse/watchlist/contracts "
            "or set an underlying level with /muse/levels instead.", 409)

    strategy_id, engine = match
    current = getattr(engine, "_current_option_price", None) or engine.exit_manager.entry_premium
    try:
        row = {
            "user_id": _muse_user_id(),
            "strategy_id": strategy_id,
            "ticker": engine.ticker,
            "contract_symbol": symbol,
            "target_price": target,
            "direction": "above" if target >= float(current) else "below",
            "status": "watching",
        }
        result = get_supabase_service().client.table("contract_price_alerts").insert(row).execute()
        created = result.data[0] if result.data else None
        if not created:
            return _err("Failed to create alert", 500)
        engine.exit_manager.add_price_alert(created)
        _notify_change("Contract alert set",
                       f"{symbol}: notify {created['direction']} ${target:.2f} (now ${float(current):.2f})",
                       {"screen": "position", "symbol": symbol, "ticker": engine.ticker})
        return _ok({**created, "current_price": float(current)}, 201)
    except Exception as e:
        logger.error("[muse/contract-alerts POST] %s", e, exc_info=True)
        return _err(f"Failed to create alert: {e}", 500)


@bp.route("/contract-alerts/<alert_id>", methods=["DELETE"])
def delete_contract_alert(alert_id: str):
    from routes.strategy_routes import _resolve_any_engine
    try:
        sb = get_supabase_service().client
        result = (sb.table("contract_price_alerts").update({"status": "cancelled"})
                  .eq("id", alert_id).eq("user_id", _muse_user_id()).execute())
        if not result.data:
            return _err("Alert not found", 404)
        engine = _resolve_any_engine(result.data[0]["strategy_id"])
        if engine and engine.exit_manager:
            engine.exit_manager.remove_price_alert(alert_id)
        row = result.data[0]
        _notify_change("Contract alert removed",
                       f"{row.get('contract_symbol')} ${float(row.get('target_price') or 0):.2f} alert cancelled",
                       {"screen": "position", "symbol": row.get("contract_symbol"), "ticker": row.get("ticker")})
        return _ok(result.data[0])
    except Exception as e:
        logger.error("[muse/contract-alerts DELETE] %s", e, exc_info=True)
        return _err(f"Failed to cancel alert: {e}", 500)


# ── Notes (Daily Review journal) ────────────────────────────────────────────────

@bp.route("/notes", methods=["GET"])
def list_notes():
    """?start_date= ?end_date= (default last 7 days) ?kind=note|todo ?muse_only=true"""
    today = datetime.now(ET).date()
    start = _parse_date(request.args.get("start_date")) or today - timedelta(days=7)
    end = _parse_date(request.args.get("end_date")) or today
    try:
        q = (get_supabase_service().client.table("review_notes").select("*")
             .gte("note_date", start.isoformat()).lte("note_date", end.isoformat()))
        kind = request.args.get("kind")
        if kind in ("note", "todo"):
            q = q.eq("kind", kind)
        rows = q.order("note_date", desc=True).execute().data or []
        if request.args.get("muse_only", "").lower() == "true":
            rows = [r for r in rows if (r.get("content") or "").startswith(_MUSE_NOTE_PREFIX)]
        return _ok({"notes": rows, "count": len(rows)})
    except Exception as e:
        logger.error("[muse/notes GET] %s", e, exc_info=True)
        return _err(f"Failed to load notes: {e}", 500)


@bp.route("/notes", methods=["POST"])
def create_note():
    """Body: { content, kind?: note|todo (default note), date?: YYYY-MM-DD (default today) }"""
    data = request.get_json(silent=True) or {}
    content = (data.get("content") or "").strip()
    if not content:
        return _err("content is required")
    kind = data.get("kind", "note")
    if kind not in ("note", "todo"):
        return _err("kind must be 'note' or 'todo'")
    note_date = _parse_date(data.get("date")) if data.get("date") else datetime.now(ET).date()
    if not note_date:
        return _err("date must be YYYY-MM-DD")
    try:
        res = get_supabase_service().client.table("review_notes").insert({
            "note_date": note_date.isoformat(),
            "kind": kind,
            "content": f"{_MUSE_NOTE_PREFIX}{content}",
        }).execute()
        if not res.data:
            return _err("Failed to create note", 500)
        _notify_change("Todo added" if kind == "todo" else "Note added",
                       content if len(content) <= 140 else content[:137] + "…",
                       {"screen": "daily_review", "review_date": note_date.isoformat()})
        return _ok(res.data[0], 201)
    except Exception as e:
        logger.error("[muse/notes POST] %s", e, exc_info=True)
        return _err(f"Failed to create note: {e}", 500)


# ── Strategies / reviews ────────────────────────────────────────────────────────

_STRATEGY_FIELDS = ("id", "strategy_name", "ticker", "profile", "active", "trade_days",
                    "capital_limit", "confirm_entry", "paused_by_kill_switch", "technicals_gate")


@bp.route("/strategies", methods=["GET"])
def strategies():
    """Automated ORB strategies: which are active, on which account, and whether they hold a position."""
    from routes.strategy_routes import logger_svc, _engines
    try:
        rows = []
        for cfg in logger_svc.load_configs():
            eng = _engines.get(cfg["id"])
            has_pos = bool(eng and eng.trade_taken and eng.contract_symbol)
            row = {k: cfg.get(k) for k in _STRATEGY_FIELDS if k in cfg}
            row["account"] = "paper" if cfg.get("paper_mode", True) else "live"
            row["has_position"] = has_pos
            row["contract_symbol"] = eng.contract_symbol if has_pos else None
            rows.append(row)
        return _ok({
            "strategies": rows,
            "pending_confirmations": _pending_confirmations(),
        })
    except Exception as e:
        logger.error("[muse/strategies] %s", e, exc_info=True)
        return _err(f"Failed to load strategies: {e}", 500)


@bp.route("/review/<review_date>", methods=["GET"])
def review(review_date: str):
    """
    Daily performance review + pre-market digest for a date.
    review_date: YYYY-MM-DD, 'today', or 'latest'. ?account=live|paper (default live)
    """
    account_arg = request.args.get("account", "live")
    if account_arg not in ("live", "paper"):
        return _err("account must be 'live' or 'paper'")
    paper = account_arg == "paper"
    sb = get_supabase_service().client

    try:
        if review_date.lower() == "latest":
            latest = (sb.table("performance_reviews").select("review_date")
                      .eq("paper_mode", paper).order("review_date", desc=True)
                      .limit(1).execute().data or [])
            if not latest:
                return _err("No reviews yet", 404)
            day = latest[0]["review_date"]
        else:
            parsed = _parse_date(review_date)
            if not parsed:
                return _err("review_date must be YYYY-MM-DD, 'today', or 'latest'")
            day = parsed.isoformat()

        rev = (sb.table("performance_reviews").select("*")
               .eq("review_date", day).eq("paper_mode", paper).limit(1).execute().data or [])
        digest = (sb.table("market_digests").select("*")
                  .eq("digest_date", day).limit(1).execute().data or [])
        if not rev and not digest:
            return _err(f"No review or market digest for {day}", 404)
        return _ok({
            "date": day,
            "account": account_arg,
            "review": rev[0] if rev else None,
            "market_digest": digest[0] if digest else None,
        })
    except Exception as e:
        logger.error("[muse/review] %s", e, exc_info=True)
        return _err(f"Failed to load review: {e}", 500)


# ── OpenAPI spec (public — contains no data or secrets) ────────────────────────

def _q(name, desc, typ="string", enum=None, required=False):
    schema = {"type": typ}
    if enum:
        schema["enum"] = enum
    return {"name": name, "in": "query", "required": required, "description": desc, "schema": schema}


def _p(name, desc):
    return {"name": name, "in": "path", "required": True, "description": desc, "schema": {"type": "string"}}


def _body(props: dict, required: list[str]):
    return {"required": True, "content": {"application/json": {"schema": {
        "type": "object", "properties": props, "required": required}}}}


def _op(op_id, summary, description, params=None, body=None):
    op = {"operationId": op_id, "summary": summary, "description": description,
          "responses": {"200": {"$ref": "#/components/responses/Envelope"},
                        "4XX": {"$ref": "#/components/responses/Envelope"}}}
    if params:
        op["parameters"] = params
    if body:
        op["requestBody"] = body
    return op


_CONTRACT_ID_PROPS = {
    "symbol": {"type": "string", "description": "OCC option symbol, e.g. NBIS251003C00250000. Alternative to ticker+expiration+type+strike."},
    "ticker": {"type": "string"},
    "expiration": {"type": "string", "format": "date"},
    "type": {"type": "string", "enum": ["call", "put"]},
    "strike": {"type": "number"},
}
_CONTRACT_ID_PARAMS = [
    _q("symbol", "OCC option symbol, e.g. NBIS251003C00250000"),
    _q("ticker", "Underlying (use with expiration/type/strike instead of symbol)"),
    _q("expiration", "YYYY-MM-DD"),
    _q("type", "call or put", enum=["call", "put"]),
    _q("strike", "Strike price", typ="number"),
]

_OPENAPI = {
    "openapi": "3.1.0",
    "info": {
        "title": "ALETHIA — Muse API",
        "version": "1.0.0",
        "description": (
            "Read-and-watch access to the user's options trading app. All data is the user's own. "
            "Money is USD; times are ISO-8601 in America/New_York. Every response is "
            "{success, data, error, as_of, market_open}. Muse can read positions and set watches/alerts/notes "
            "but cannot place or close trades — always leave execution to the user. "
            "Start a trading conversation with GET /muse/summary. Before suggesting a contract, check "
            "account.options_buying_power against the contract's cost_per_contract."
        ),
    },
    "security": [{"MuseKey": []}],
    "components": {
        "securitySchemes": {"MuseKey": {"type": "apiKey", "in": "header", "name": "X-Muse-Key"}},
        "responses": {"Envelope": {"description": "Standard envelope", "content": {"application/json": {"schema": {
            "type": "object",
            "properties": {
                "success": {"type": "boolean"},
                "data": {},
                "error": {"type": ["string", "null"]},
                "as_of": {"type": "string"},
                "market_open": {"type": "boolean"},
            }}}}}},
    },
    "paths": {
        "/muse/summary": {"get": _op(
            "getSummary", "One-call snapshot",
            "Live account balances + P&L, open live positions, today's trades, active levels, "
            "watchlist contracts, contract alerts, and pending trade confirmations. Call this first.")},
        "/muse/account": {"get": _op(
            "getAccount", "Live account balance and P&L",
            "LIVE account only: equity, cash, buying_power, options_buying_power, and P&L for today/week/month/YTD/all-time "
            "(deposits excluded).")},
        "/muse/positions": {"get": _op(
            "getPositions", "Open live positions",
            "Every open LIVE position with unrealized P&L. managed_by_app is non-null when the app's strategy engine "
            "is managing stops/targets for it (hard_stop, tp1, tp2 are option premiums).")},
        "/muse/trades": {"get": _op(
            "getTrades", "Trade log",
            "Trade history, newest first, with totals. Open trades include live_pnl.",
            [_q("date", "'all' (default), 'today', or YYYY-MM-DD"),
             _q("start_date", "Range start YYYY-MM-DD (overrides date)"),
             _q("end_date", "Range end YYYY-MM-DD"),
             _q("ticker", "Filter by underlying"),
             _q("status", "open or closed", enum=["open", "closed"]),
             _q("account", "live, paper, or all (default all)", enum=["live", "paper", "all"]),
             _q("limit", "Max rows (default 50, max 500)", typ="integer")])},
        "/muse/stats": {"get": _op(
            "getStats", "Performance stats",
            "Closed-trade win rate, P&L, avg winner/loser, profit factor — overall and by profile, ticker, and entry hour (ET).",
            [_q("period", "today|week|month|ytd|all (default all)", enum=["today", "week", "month", "ytd", "all"]),
             _q("account", "live (default), paper, or all", enum=["live", "paper", "all"])])},
        "/muse/quote/{ticker}": {"get": _op(
            "getQuote", "Stock quote + technicals",
            "Current price and day change, daily technicals (EMAs, RSI, ATR, trend), and historical support/resistance + pivots. "
            "Use before suggesting a level.",
            [_p("ticker", "Stock symbol, e.g. NBIS")])},
        "/muse/options/{ticker}/expirations": {"get": _op(
            "getOptionExpirations", "Available expirations",
            "Option expiration dates with days-to-expiry.",
            [_p("ticker", "Underlying symbol"), _q("days", "How far out to look (default 60, max 400)", typ="integer")])},
        "/muse/options/{ticker}": {"get": _op(
            "getOptionChain", "Option chain for one expiration",
            "Strikes nearest the current price for ONE expiration, with bid/ask/mid, IV, greeks, OI, volume, and "
            "cost_per_contract (mid x 100).",
            [_p("ticker", "Underlying symbol"),
             _q("expiration", "YYYY-MM-DD (default: nearest expiration within 14 days)"),
             _q("type", "call, put, or both (default both)", enum=["call", "put", "both"]),
             _q("strikes", "Strikes per side around spot (default 10, max 40)", typ="integer"),
             _q("min_oi", "Minimum open interest", typ="integer"),
             _q("min_volume", "Minimum day volume", typ="integer")])},
        "/muse/contract": {"get": _op(
            "getContract", "Quote one option contract",
            "Live quote + greeks for a single contract.", _CONTRACT_ID_PARAMS)},
        "/muse/levels": {
            "get": _op("listLevels", "List watched price levels",
                       "Underlying price levels the app is watching.",
                       [_q("status", "watching (default), confirmed, cancelled, or all"),
                        _q("ticker", "Filter by ticker")]),
            "post": _op(
                "createLevel", "Watch a price level",
                "Watch the UNDERLYING stock price. The user gets a push notification (with AI-scored contract "
                "suggestions) when a 1-minute bar closes above (direction=above) or below (direction=below) the price. "
                "Ask the user before creating one.",
                body=_body({
                    "ticker": {"type": "string"},
                    "price": {"type": "number", "description": "The level"},
                    "direction": {"type": "string", "enum": ["above", "below", "either"]},
                    "price_high": {"type": "number", "description": "Optional upper bound for a zone"},
                    "target": {"type": "number", "description": "Optional price target, stored in the note"},
                    "note": {"type": "string", "description": "Why this level matters"},
                }, ["ticker", "price", "direction"])),
        },
        "/muse/levels/{level_id}": {"delete": _op(
            "cancelLevel", "Stop watching a level", "Cancels a level (kept in history).",
            [_p("level_id", "Level id from listLevels")])},
        "/muse/watchlist/contracts": {
            "get": _op("listWatchlist", "List watchlist contracts",
                       "Option contracts on the user's watchlist.",
                       [_q("status", "tracking (default), entered, exited, cancelled, or all")]),
            "post": _op(
                "addWatchlistContract", "Add a contract to the watchlist",
                "Adds an option contract to the app's watchlist (records the price at the time it's added). Pass symbol, or ticker+expiration+type+strike.",
                body=_body({**_CONTRACT_ID_PROPS,
                            "reason": {"type": "string", "description": "Why it's being watched"}}, [])),
        },
        "/muse/watchlist/contracts/{contract_id}": {"delete": _op(
            "removeWatchlistContract", "Remove a watchlist contract", "Deletes it from the watchlist.",
            [_p("contract_id", "id from listWatchlist")])},
        "/muse/contract-alerts": {
            "get": _op("listContractAlerts", "List contract price alerts", "Alerts on held contracts' premiums.",
                       [_q("status", "watching (default), triggered, cancelled, or all")]),
            "post": _op(
                "createContractAlert", "Alert on a held contract's price",
                "Push notification when a HELD contract's premium crosses target_price. Only works for open app-managed "
                "positions (returns 409 otherwise).",
                body=_body({**_CONTRACT_ID_PROPS,
                            "target_price": {"type": "number", "description": "Option premium per share, e.g. 2.10"}},
                           ["target_price"])),
        },
        "/muse/contract-alerts/{alert_id}": {"delete": _op(
            "cancelContractAlert", "Cancel a contract alert", "Stops the alert.",
            [_p("alert_id", "id from listContractAlerts")])},
        "/muse/notes": {
            "get": _op("listNotes", "Read journal notes", "Daily Review notes/todos (default: last 7 days).",
                       [_q("start_date", "YYYY-MM-DD"), _q("end_date", "YYYY-MM-DD"),
                        _q("kind", "note or todo", enum=["note", "todo"]),
                        _q("muse_only", "true to only return notes Muse wrote")]),
            "post": _op(
                "createNote", "Write a journal note",
                "Adds a note to the user's Daily Review journal, prefixed [Muse]. Use it to record the reasoning behind "
                "a suggestion so it can be reviewed later.",
                body=_body({"content": {"type": "string"},
                            "kind": {"type": "string", "enum": ["note", "todo"]},
                            "date": {"type": "string", "format": "date", "description": "Default today"}},
                           ["content"])),
        },
        "/muse/whoami": {"get": _op(
            "whoAmI", "Which app user Muse acts as",
            "The Supabase user (id + email) that owns everything Muse creates. If the user can't see a level or "
            "watchlist item Muse created, check this matches the account they're logged into.")},
        "/muse/strategies": {"get": _op(
            "getStrategies", "Automated strategies",
            "The app's automated ORB strategies (ticker, profile, active, account, whether one holds a position) and any "
            "trades waiting for the user to confirm.")},
        "/muse/review/{review_date}": {"get": _op(
            "getReview", "Daily review + market digest",
            "The end-of-day performance review and the pre-market digest for a date.",
            [_p("review_date", "YYYY-MM-DD, 'today', or 'latest'"),
             _q("account", "live (default) or paper", enum=["live", "paper"])])},
    },
}


@bp.route("/openapi.json", methods=["GET"])
def openapi_spec():
    base = os.getenv("MUSE_PUBLIC_URL", "").rstrip("/")
    if not base:
        # Railway terminates TLS at its proxy — honor X-Forwarded-Proto so the
        # advertised server URL is https, not the internal http hop.
        proto = request.headers.get("X-Forwarded-Proto", request.scheme)
        base = f"{proto}://{request.host}"
    return jsonify({**_OPENAPI, "servers": [{"url": base}]})
