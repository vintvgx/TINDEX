"""
Account-level daily loss caps (2026-11-19, 0.8.05).

One day P&L shared by EVERY strategy engine in the same paper/live
account. The per-engine `daily_loss_limit` (profiles.py) stays as a
per-strategy backstop; these caps are the primary control, because the
Nov 18 chop day proved per-strategy limits don't protect the account:
RIDER halted after -$845 but MUSE's fresh $400 limit let a third
trade in, and the day ended -$950.

Modes, from the account's realized day P&L:
  NORMAL        day P&L > -$250 — standard entry rules.
  CONFIRMATION  day P&L <= -$250 — re-entries need much more confluence
                (composite >= +10 + 10 consecutive 1-min closes beyond
                the level; MUSE: 10 VWAP-hold bars + technicals >= 7).
                Holds for the rest of the day once triggered — a winning
                re-entry does not loosen it.
  HALTED        day P&L <= -$400 — no new entries from any strategy.
                Resets at the next session open.

Paper and live are separate books: state is keyed by `paper`, so a
paper halt never blocks a live entry (or vice versa) — the same
isolation rule as `_find_ticker_conflict` (2026-07-30 incident).

In-process only, like the per-engine session state it replaces as the
primary control: a process restart resets the day P&L to $0. Seeding
from the trades table on restart is a follow-up, not this PR.
"""

import threading
from datetime import datetime

import pytz

ET = pytz.timezone("America/New_York")

# Caps in dollars of realized day P&L (Kareem, 2026-11-19).
ACCOUNT_SOFT_CAP_PNL = -250.0
ACCOUNT_HARD_CAP_PNL = -400.0

# Confirmation-mode entry bars (Kareem's design, 2026-11-19; the +10 /
# 10-close / MUSE >=7 numbers are Bandit's proposed mapping of it).
CONFIRM_COMPOSITE_MIN = 10
CONFIRM_HOLD_BARS = 10
MUSE_CONFIRM_TECHNICALS_MIN = 7
MUSE_CONFIRM_HOLD_BARS = 10

NORMAL = "NORMAL"
CONFIRMATION = "CONFIRMATION"
HALTED = "HALTED"

_lock = threading.Lock()
# paper (bool) -> {"date": date, "realized_pnl": float}
_STATE: dict[bool, dict] = {}


def _today() -> object:
    return datetime.now(ET).date()


def _state_for(paper: bool, today) -> dict:
    """The day's record for this account, resetting on a date change."""
    rec = _STATE.get(paper)
    if rec is None or rec["date"] != today:
        rec = {"date": today, "realized_pnl": 0.0}
        _STATE[paper] = rec
    return rec


def mode_for_pnl(pnl: float) -> str:
    """Mode for a given realized day P&L. Boundary is inclusive: exactly
    -$250 is confirmation mode, exactly -$400 is halted."""
    if pnl <= ACCOUNT_HARD_CAP_PNL:
        return HALTED
    if pnl <= ACCOUNT_SOFT_CAP_PNL:
        return CONFIRMATION
    return NORMAL


def mode(paper: bool, today=None) -> str:
    """Current account mode for the paper/live book."""
    with _lock:
        return mode_for_pnl(_state_for(paper, today or _today())["realized_pnl"])


def realized_pnl(paper: bool, today=None) -> float:
    """Realized day P&L for the paper/live book."""
    with _lock:
        return _state_for(paper, today or _today())["realized_pnl"]


def record_pnl(paper: bool, pnl: float, today=None) -> str:
    """Add one leg's realized P&L to the account's day total. Returns the
    mode after the update, so the caller can log a mode transition."""
    with _lock:
        rec = _state_for(paper, today or _today())
        rec["realized_pnl"] += pnl
        return mode_for_pnl(rec["realized_pnl"])


def reset_for_tests() -> None:
    """Clear all account state. Tests only."""
    with _lock:
        _STATE.clear()
