"""
Robinhood account/portfolio service — read-only.

Wraps robin_stocks (an unofficial, reverse-engineered Robinhood client) to
expose account summary + holdings for personal viewing only. Order placement
is intentionally not implemented anywhere in this module — this account is
view-only from the app, never traded through it.

Auth: Robinhood has pushed passkeys as its primary sign-in method and no
longer offers TOTP-authenticator enrollment for this kind of API login, so
this signs in with username/password and falls back to Robinhood's SMS
one-time-code challenge when prompted — same as the mobile app does from an
unrecognized session. There is no way to source that code without a human:
a text lands on the account owner's phone and has to be typed in.

Flow:
  1. A read endpoint (get_account_summary/get_holdings) calls _ensure_login()
     when not yet logged in. That makes exactly one automatic attempt with
     just username/password. robin_stocks either (a) silently succeeds by
     reusing its still-valid pickled session from a previous login — the
     common case after a Railway restart, as long as that session hasn't
     expired — or (b) hits Robinhood's SMS challenge. Triggering that
     challenge is what sends the text; robin_stocks would then normally
     block on `input()` to collect the code, which we intercept (see
     _no_interactive_input) so the request returns immediately with status
     "mfa_required" instead of hanging.
  2. The frontend shows a code-entry field; submitting it calls verify_code(),
     which runs a fresh robin_stocks login() with that code passed as
     mfa_code — the library's documented non-interactive path for supplying
     an already-known code.
  3. On success the session is cached (store_session=True) both in-process
     and to disk, so later requests — including after a restart, as long as
     the disk pickle hasn't expired — skip this dance entirely.

Deliberately does NOT auto-retry a failed/pending login on every poll: once
one attempt has been made this process lifetime, further read calls just
report the same status until the user explicitly retries (start_login) or
verifies a code. Without that guard, a 60s frontend poll would re-trigger a
fresh SMS send roughly once a minute.

Single gunicorn worker, many threads (see Procfile) — the module-level state
below is process-global by design and safe to guard with a plain Lock; this
would need rethinking under multiple worker processes.
"""

from __future__ import annotations

import base64
import builtins
import os
import threading

import robin_stocks.robinhood as rh

from log.logging_config import get_logger
from utils.cache import GenericTTLCache

logger = get_logger(__name__)

_state_lock = threading.Lock()
_logged_in = False
_mfa_pending = False
_attempted = False
_last_error: str | None = None
_session_restore_attempted = False

_cache = GenericTTLCache()
# Unofficial API — deliberately polled less aggressively than Alpaca to avoid
# drawing attention from Robinhood's abuse detection.
_CACHE_TTL_SECONDS = 45


class RobinhoodAuthError(Exception):
    """Carries a status the frontend can render distinctly from a generic error."""

    def __init__(self, status: str, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


class _MFAPromptNeeded(Exception):
    """Raised in place of robin_stocks blocking on input() for the SMS code."""


def _no_interactive_input(*_args, **_kwargs):
    raise _MFAPromptNeeded()


def _credentials() -> tuple[str, str]:
    username = os.getenv("ROBINHOOD_USERNAME")
    password = os.getenv("ROBINHOOD_PASSWORD")
    if not username or not password:
        raise RobinhoodAuthError("unauthenticated", "Robinhood credentials not configured")
    return username, password


def _pickle_path() -> str:
    """
    Same default path robin_stocks's own login() writes to (see the installed
    robin_stocks/robinhood/authentication.py: pickle_path="" -> ~/.tokens/
    robinhood.pickle) — kept in sync here rather than passing an explicit
    pickle_path into rh.login() so robin_stocks's own cached-session reuse
    logic (loading it, validating the access token, falling back to a normal
    login while keeping the same device_token) works completely unmodified.
    """
    return os.path.join(os.path.expanduser("~"), ".tokens", "robinhood.pickle")


def _restore_session_from_supabase() -> None:
    """
    Runs once per process, before the very first login attempt.

    Root cause of "signed in every time": robin_stocks pickles its session
    (access/refresh token + a device_token Robinhood's server recognizes) to
    the container's local disk. Railway's filesystem is wiped on every
    restart (redeploy, platform restart, crash — see
    monitoring_routes.py's start_contracts_monitor_core docstring for the
    same documented pattern), so a fresh device_token gets generated on the
    next login attempt and Robinhood re-triggers the SMS challenge every
    time, not just once.

    This writes back whatever pickle bytes were last saved to Supabase (see
    _persist_session_to_supabase) to the same path robin_stocks reads from,
    *before* rh.login() runs — so robin_stocks's own existing cached-session
    branch picks it up transparently, same device_token as before the
    restart, no robin_stocks changes needed.
    """
    global _session_restore_attempted
    if _session_restore_attempted:
        return
    _session_restore_attempted = True

    try:
        pickle_path = _pickle_path()
        if os.path.exists(pickle_path):
            # Already have a pickle on disk this process lifetime (e.g. a
            # login already happened) — never clobber it with a possibly
            # stale Supabase copy.
            return

        from services.supabase.supabase_service import get_supabase_service
        pickle_b64 = get_supabase_service().get_robinhood_session()
        if not pickle_b64:
            return

        os.makedirs(os.path.dirname(pickle_path), exist_ok=True)
        with open(pickle_path, "wb") as f:
            f.write(base64.b64decode(pickle_b64))
        logger.info("[robinhood] restored session pickle from Supabase")
    except Exception as e:
        # Non-fatal — worst case we just fall back to a fresh login/MFA
        # flow, same behavior as before this persistence existed.
        logger.warning("[robinhood] failed to restore session from Supabase: %s", e)


def _persist_session_to_supabase() -> None:
    """Called right after a successful login — mirrors the fresh on-disk
    pickle into Supabase so the next process restart can restore it."""
    try:
        pickle_path = _pickle_path()
        if not os.path.exists(pickle_path):
            return
        with open(pickle_path, "rb") as f:
            raw = f.read()

        from services.supabase.supabase_service import get_supabase_service
        get_supabase_service().save_robinhood_session(base64.b64encode(raw).decode("ascii"))
        logger.info("[robinhood] persisted session pickle to Supabase")
    except Exception as e:
        logger.warning("[robinhood] failed to persist session to Supabase: %s", e)


def _attempt_login(username: str, password: str, mfa_code: str | None) -> None:
    """Must be called with _state_lock held."""
    global _logged_in, _mfa_pending, _last_error, _attempted

    _restore_session_from_supabase()

    original_input = builtins.input
    builtins.input = _no_interactive_input
    try:
        rh.login(username, password, mfa_code=mfa_code, store_session=True)
        _logged_in = True
        _mfa_pending = False
        _last_error = None
        _persist_session_to_supabase()
        logger.info("[robinhood] logged in")
    except _MFAPromptNeeded:
        # Robinhood has already sent the SMS by this point — that happens on
        # the first request inside this same login() call, before it would
        # normally prompt for the code.
        _mfa_pending = True
        _last_error = None
        raise RobinhoodAuthError(
            "mfa_required",
            "Robinhood texted you a verification code — enter it to finish signing in.",
        )
    except Exception as e:
        _mfa_pending = False
        _last_error = str(e)
        logger.warning("[robinhood] login attempt failed: %s", e)
        raise RobinhoodAuthError("error", str(e))
    finally:
        builtins.input = original_input
        _attempted = True


def _ensure_login() -> None:
    if _logged_in:
        return
    username, password = _credentials()
    with _state_lock:
        if _logged_in:
            return
        if _mfa_pending:
            raise RobinhoodAuthError(
                "mfa_required",
                "Robinhood texted you a verification code — enter it to finish signing in.",
            )
        if _attempted:
            raise RobinhoodAuthError("error", _last_error or "Robinhood sign-in failed")
        _attempt_login(username, password, mfa_code=None)


def start_login() -> None:
    """
    Explicit (re)trigger for the app's "Sign In" / "Resend Code" action —
    never called from passive polling. Resets the one-shot _attempted guard
    so a fresh SMS send is deliberate, not automatic.
    """
    global _attempted, _mfa_pending
    username, password = _credentials()
    with _state_lock:
        _attempted = False
        _mfa_pending = False
        _attempt_login(username, password, mfa_code=None)


def verify_code(code: str) -> None:
    """Completes sign-in with the SMS code the user just typed in."""
    username, password = _credentials()
    with _state_lock:
        _attempt_login(username, password, mfa_code=code)


def _safe_float(val, default: float = 0.0) -> float:
    try:
        return float(val) if val not in (None, "") else default
    except (TypeError, ValueError):
        return default


def _extract_margin_summary(account: dict) -> dict | None:
    """
    Robinhood's load_account_profile() response includes a margin_balances
    sub-dict for every account, margin-enabled or not — for a plain cash
    account it comes back either None or populated with zeroed/null figures
    (Robinhood just doesn't extend margin to it). Returns None in that case
    rather than a fabricated "$0 margin" figure, so the UI can honestly say
    "cash account — no margin" instead of implying a real, checked balance.
    """
    raw = account.get("margin_balances")
    if not isinstance(raw, dict) or not raw:
        return None

    day_trade_bp = _safe_float(raw.get("day_trade_buying_power"))
    overnight_bp = _safe_float(raw.get("overnight_buying_power"))
    margin_limit = _safe_float(raw.get("margin_limit"))
    unallocated_margin_cash = _safe_float(raw.get("unallocated_margin_cash"))

    if not any([day_trade_bp, overnight_bp, margin_limit, unallocated_margin_cash]):
        return None

    return {
        "day_trade_buying_power": round(day_trade_bp, 2),
        "overnight_buying_power": round(overnight_bp, 2),
        "margin_limit": round(margin_limit, 2),
        "unallocated_margin_cash": round(unallocated_margin_cash, 2),
    }


def get_account_summary() -> dict:
    """Equity, cash, buying power, margin (if any), and today's $/% change."""
    cached = _cache.get("account")
    if cached is not None:
        return cached

    _ensure_login()
    account = rh.load_account_profile()
    portfolio = rh.load_portfolio_profile()

    equity = _safe_float(portfolio.get("equity"))
    # adjusted_equity_previous_close backs out same-day deposits/withdrawals
    # from the baseline, so a deposit doesn't get counted as trading P&L —
    # same reasoning as strategy_routes.py's Alpaca pnl_all_time handling.
    prev_close_equity = (
        _safe_float(portfolio.get("adjusted_equity_previous_close"))
        or _safe_float(portfolio.get("equity_previous_close"))
    )
    pnl_today = equity - prev_close_equity if prev_close_equity else 0.0
    pnl_today_pct = (pnl_today / prev_close_equity * 100) if prev_close_equity else 0.0

    cash = _safe_float(account.get("cash"))
    uncleared_deposits = _safe_float(account.get("uncleared_deposits"))
    unsettled_funds = _safe_float(account.get("unsettled_funds"))
    margin = _extract_margin_summary(account)

    result = {
        "available": True,
        "equity": round(equity, 2),
        "cash": round(cash, 2),
        "buying_power": round(_safe_float(account.get("buying_power")), 2),
        "market_value": round(_safe_float(portfolio.get("market_value")), 2),
        "pnl_today": round(pnl_today, 2),
        "pnl_today_pct": round(pnl_today_pct, 3),
        # Cash-vs-margin breakdown. is_margin_account is honest about
        # whether Robinhood actually returned usable margin figures for
        # this account — a cash account will have margin: null and
        # is_margin_account: false rather than a fake $0 margin block.
        "is_margin_account": margin is not None,
        "margin": margin,
        "uncleared_deposits": round(uncleared_deposits, 2),
        "unsettled_funds": round(unsettled_funds, 2),
    }
    _cache.set("account", result, _CACHE_TTL_SECONDS)
    return result


def get_holdings() -> list:
    """Per-symbol stock holdings — ticker, qty, cost basis, live price, P&L, sector."""
    cached = _cache.get("holdings")
    if cached is not None:
        return cached

    _ensure_login()
    raw = rh.build_holdings() or {}

    # Sector, for the allocation pie chart — build_holdings() already calls
    # get_fundamentals() per-ticker internally (for pe_ratio) but doesn't
    # surface 'sector' in its own return dict, so it's fetched here as one
    # extra batched call. Real data from Robinhood's fundamentals endpoint,
    # not inferred/fabricated — a ticker with no sector data back from
    # Robinhood just gets sector: None, surfaced honestly to the UI.
    tickers = list(raw.keys())
    sectors: dict[str, str | None] = {}
    if tickers:
        try:
            fundamentals = rh.get_fundamentals(tickers) or []
            for ticker, fdata in zip(tickers, fundamentals):
                sectors[ticker] = (fdata or {}).get("sector") or None
        except Exception as e:
            logger.warning("[robinhood] sector fetch failed: %s", e)

    holdings = []
    for ticker, data in raw.items():
        quantity = _safe_float(data.get("quantity"))
        avg_cost = _safe_float(data.get("average_buy_price"))
        price = _safe_float(data.get("price"))
        equity = _safe_float(data.get("equity"))
        cost_basis = quantity * avg_cost
        unrealized_pl = equity - cost_basis
        unrealized_pl_pct = (unrealized_pl / cost_basis * 100) if cost_basis else 0.0

        holdings.append({
            "ticker": ticker,
            "name": data.get("name"),
            "quantity": quantity,
            "average_cost": round(avg_cost, 2),
            "price": round(price, 2),
            "market_value": round(equity, 2),
            "unrealized_pl": round(unrealized_pl, 2),
            "unrealized_pl_pct": round(unrealized_pl_pct, 3),
            "sector": sectors.get(ticker),
        })

    holdings.sort(key=lambda h: h["market_value"], reverse=True)
    _cache.set("holdings", holdings, _CACHE_TTL_SECONDS)
    return holdings


# Robinhood's historicals span/interval combos it actually accepts together
# (see the installed robin_stocks/robinhood/account.py's get_historical_portfolio
# validation) — 'day' uses extended trading-hours bounds so the sparkline
# reflects the same session the pnl_today figure above is computed over.
_EQUITY_HISTORY_SPANS = {
    "day":   {"interval": "5minute", "span": "day",   "bounds": "trading"},
    "week":  {"interval": "hour",    "span": "week",  "bounds": "regular"},
    "month": {"interval": "day",     "span": "month",  "bounds": "regular"},
}


def get_equity_history(span: str = "day") -> dict:
    """
    Real equity marks over time straight from Robinhood's own portfolio-
    historicals endpoint (rh.get_historical_portfolio) — not reconstructed
    from holdings, since Robinhood's series already accounts for cash and
    intraday fills the way the account summary's pnl_today figure does.
    Backs the Day P/L sparkline.
    """
    span = span if span in _EQUITY_HISTORY_SPANS else "day"
    cache_key = f"equity_history_{span}"
    cached = _cache.get(cache_key)
    if cached is not None:
        return cached

    _ensure_login()
    cfg = _EQUITY_HISTORY_SPANS[span]
    raw = rh.get_historical_portfolio(**cfg) or {}
    raw_points = raw.get("equity_historicals") or []

    points = []
    for p in raw_points:
        if not p:
            continue
        equity = _safe_float(p.get("close_equity") or p.get("adjusted_close_equity"))
        points.append({"timestamp": p.get("begins_at"), "equity": round(equity, 2)})

    result = {"available": bool(points), "span": span, "points": points}
    _cache.set(cache_key, result, _CACHE_TTL_SECONDS)
    return result


def get_option_positions() -> list:
    """
    Open Robinhood option positions — kept separate from get_holdings()
    (stock only). rh.get_open_option_positions() returns each position's
    quantity/cost fields but not the contract's own strike/expiration/type,
    so each is resolved individually via get_option_instrument_data_by_id.
    A resolution failure on one position (e.g. a transient Robinhood 5xx)
    is swallowed and that position skipped rather than failing the whole
    list — same defensive posture as get_holdings() around a single bad row.
    """
    cached = _cache.get("option_positions")
    if cached is not None:
        return cached

    _ensure_login()
    raw = rh.get_open_option_positions() or []

    positions = []
    for p in raw:
        if not p:
            continue
        try:
            quantity = _safe_float(p.get("quantity"))
            if quantity == 0:
                continue  # closed position still listed with zero quantity

            option_id = p.get("option_id")
            if not option_id:
                option_url = p.get("option") or ""
                option_id = option_url.rstrip("/").split("/")[-1] or None

            instrument = rh.get_option_instrument_data_by_id(option_id) if option_id else None
            avg_price = _safe_float(p.get("average_price"))
            # Robinhood quotes average_price per-share; standard equity
            # option contracts represent 100 shares each.
            cost_basis = quantity * avg_price * 100

            positions.append({
                "ticker": p.get("chain_symbol"),
                "option_type": (instrument or {}).get("type"),
                "strike": _safe_float((instrument or {}).get("strike_price")) or None,
                "expiration_date": (instrument or {}).get("expiration_date"),
                "quantity": quantity,
                "position_type": p.get("type"),  # 'long' or 'short'
                "average_price": round(avg_price, 2),
                "cost_basis": round(cost_basis, 2),
            })
        except Exception as e:
            logger.warning("[robinhood] failed to resolve option position: %s", e)

    _cache.set("option_positions", positions, _CACHE_TTL_SECONDS)
    return positions
