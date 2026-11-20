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
                the level; MUSE: 10 VWAP-hold bars + technicals >= 6).
                Latches for the rest of the day once triggered — a winning
                re-entry does not loosen it.
  HALTED        day P&L <= -$400 — no new entries from any strategy.
                Latches like CONFIRMATION — a profitable exit does not
                release it. Resets at the next session open.

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
# 10-close / MUSE >=6 numbers are Bandit's proposed mapping of it).
CONFIRM_COMPOSITE_MIN = 10
CONFIRM_HOLD_BARS = 10
# MUSE_CONFIRM_TECHNICALS_MIN must stay <= the scorer's max (6 — see
# _muse_intraday_score, three terms of at most +2 each). 7 was
# unreachable: no MUSE entry could pass after the soft cap (CodeRabbit
# PR #126). 6 means confirmation requires a perfect intraday score —
# stricter than the normal 5, but reachable.
MUSE_CONFIRM_TECHNICALS_MIN = 6
MUSE_CONFIRM_HOLD_BARS = 10

NORMAL = "NORMAL"
CONFIRMATION = "CONFIRMATION"
HALTED = "HALTED"

# Mode strictness order — the latch only ever moves up this list.
_STRICTNESS = {NORMAL: 0, CONFIRMATION: 1, HALTED: 2}

_lock = threading.Lock()
# paper (bool) -> {"date": date, "realized_pnl": float, "mode": str}
# "mode" is the strictest mode reached today (latched — see record_pnl);
# "realized_pnl" is the running day total, kept for reporting.
_STATE: dict[bool, dict] = {}


def _today() -> object:
    return datetime.now(ET).date()


def _state_for(paper: bool, today) -> dict:
    """The day's record for this account, resetting on a date change.
    The reset clears BOTH the day P&L and the latched mode."""
    rec = _STATE.get(paper)
    if rec is None or rec["date"] != today:
        rec = {"date": today, "realized_pnl": 0.0, "mode": NORMAL}
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
    """Current account mode for the paper/live book. Latched: the
    strictest mode reached today — a winning re-entry that pulls the
    day P&L back above a cap does NOT loosen it (CodeRabbit PR #126:
    mode() used to recompute from the running P&L, so -$300 then +$100
    dropped RIDER back to NORMAL and a profitable exit could release
    HALTED). Only a date change resets it."""
    with _lock:
        return _state_for(paper, today or _today())["mode"]


def realized_pnl(paper: bool, today=None) -> float:
    """Realized day P&L for the paper/live book."""
    with _lock:
        return _state_for(paper, today or _today())["realized_pnl"]


def record_pnl(paper: bool, pnl: float, today=None) -> str:
    """Add one leg's realized P&L to the account's day total. Returns the
    mode after the update, so the caller can log a mode transition.
    The mode only ever moves stricter within a day (NORMAL -> CONFIRMATION
    -> HALTED): mode_for_pnl classifies the new running total, and the
    latched mode takes the stricter of the two."""
    with _lock:
        rec = _state_for(paper, today or _today())
        rec["realized_pnl"] += pnl
        new_mode = mode_for_pnl(rec["realized_pnl"])
        if _STRICTNESS[new_mode] > _STRICTNESS[rec["mode"]]:
            rec["mode"] = new_mode
        return rec["mode"]


def reset_for_tests() -> None:
    """Clear all account state. Tests only."""
    with _lock:
        _STATE.clear()
