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


def _attempt_login(username: str, password: str, mfa_code: str | None) -> None:
    """Must be called with _state_lock held."""
    global _logged_in, _mfa_pending, _last_error, _attempted

    original_input = builtins.input
    builtins.input = _no_interactive_input
    try:
        rh.login(username, password, mfa_code=mfa_code, store_session=True)
        _logged_in = True
        _mfa_pending = False
        _last_error = None
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


def get_account_summary() -> dict:
    """Equity, cash, buying power, and today's $/% change."""
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

    result = {
        "available": True,
        "equity": round(equity, 2),
        "cash": round(_safe_float(account.get("cash")), 2),
        "buying_power": round(_safe_float(account.get("buying_power")), 2),
        "market_value": round(_safe_float(portfolio.get("market_value")), 2),
        "pnl_today": round(pnl_today, 2),
        "pnl_today_pct": round(pnl_today_pct, 3),
    }
    _cache.set("account", result, _CACHE_TTL_SECONDS)
    return result


def get_holdings() -> list:
    """Per-symbol stock holdings — ticker, qty, cost basis, live price, P&L."""
    cached = _cache.get("holdings")
    if cached is not None:
        return cached

    _ensure_login()
    raw = rh.build_holdings() or {}

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
        })

    holdings.sort(key=lambda h: h["market_value"], reverse=True)
    _cache.set("holdings", holdings, _CACHE_TTL_SECONDS)
    return holdings
