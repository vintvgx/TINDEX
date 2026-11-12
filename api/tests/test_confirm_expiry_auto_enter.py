"""
Confirm-first auto-enter (2026-11-12): a MODERATE entry that pauses for
confirmation is re-checked on each 1-min close — a STRONG gate auto-enters
without waiting on the user — and an unanswered expiry re-arms the gate watch
instead of discarding the setup. Silence is not a decline; an explicit Skip,
a confirm_entry opt-in pause, and a ticker-conflict pause still die on expiry.
"""
import os
import sys
import threading
from datetime import datetime, timedelta
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from services.strategy import gate_watch as gw  # noqa: E402
from services.strategy.orb_engine import ORBEngine  # noqa: E402
from services.strategy.profiles import get_profile  # noqa: E402

ET = gw.ET
ORH, ORL = 764.02, 758.00
CONTRACT = {"symbol": "SPY261112C00760000", "strike": 760, "ask": 1.19}


def _gate(passed=False, needs_confirm=False, matched=4, tier="MODERATE"):
    return {"mode": "composite", "passed": passed, "needs_confirm": needs_confirm,
            "matched": matched, "total": 14, "composite": {"tier": tier},
            "results": [{"key": k, "ok": passed, "skipped": False}
                        for k in ("rsi_intraday", "macd", "trend_intraday", "vwap", "orb")],
            "summary": f"{matched:+d}/14 {tier}"}


STRONG = (True, False, _gate(passed=True, needs_confirm=False, matched=8, tier="STRONG"))
MODERATE = (True, True, _gate(passed=True, needs_confirm=True, matched=4, tier="MODERATE"))
FAILED = (False, False, _gate(passed=False, needs_confirm=False, matched=1, tier="NO_TRADE"))


def _engine(gate_results=None):
    eng = ORBEngine.__new__(ORBEngine)
    eng.config = {"ticker": "SPY", "active": True, "id": "s1", "strategy_name": "SPY TR",
                  "technicals_gate": {"enabled": True, "required": ["trend", "rsi", "vwap", "orb"],
                                      "mode": "composite", "watch": True}}
    eng.ticker, eng.profile_key, eng.profile = "SPY", "TREND_RIDER", get_profile("TREND_RIDER")
    eng.strategy_id, eng.strategy_name, eng.paper = "s1", "SPY TR", True
    eng.bypass_breakout_window, eng.confirm_entry = True, False
    eng.capital_limit = None
    eng._tick_lock = threading.Lock()
    eng.debug, eng.logger, eng.notifier, eng._hub = MagicMock(), MagicMock(), MagicMock(), MagicMock()
    eng.option_client, eng.stream_manager = None, None
    eng.limit_orders = MagicMock()
    eng._reset_session_state()
    eng.orh, eng.orl = ORH, ORL
    eng._find_ticker_conflict = lambda d: None
    eng._check_technicals_gate = MagicMock(side_effect=gate_results or [FAILED])
    eng._execute_entry = MagicMock()
    eng._compute_confidence = lambda d, p: (75.0, {})
    # The DB echoes the payload back with an id — mirror that.
    eng.logger.create_pending_confirmation.side_effect = lambda payload: dict(payload, id="p1")
    return eng


def _pause(eng, require_confirm=True, watch_deadline=None, conflict=None):
    ORBEngine._pause_for_confirmation(
        eng, "CALL", 759.37, CONTRACT, 4, dict(eng.profile),
        conflict_context=conflict, require_confirm=require_confirm,
        gate_snapshot=_gate(passed=True, needs_confirm=True, matched=4, tier="MODERATE"),
        watch_deadline=watch_deadline)
    return eng._pending_confirmation


def _backdate_expired(eng):
    pc = eng._pending_confirmation
    pc["expires_at"] = (datetime.now(ET) - timedelta(minutes=1)).isoformat()


# ── the pause itself ─────────────────────────────────────────────────────────

def test_moderate_pause_is_auto_enter_eligible():
    eng = _engine()
    deadline = (datetime.now(ET) + timedelta(hours=1), "2h without confirmation")
    pc = _pause(eng, require_confirm=True, watch_deadline=deadline)
    assert pc["_auto_enter"] is True
    assert pc["_watch_deadline"] == deadline
    assert pc["_gate_snapshot"]["matched"] == 4


def test_opt_in_pause_is_not_auto_enter_eligible():
    eng = _engine()
    pc = _pause(eng, require_confirm=False)
    assert "_auto_enter" not in pc


def test_conflict_pause_is_not_auto_enter_eligible():
    eng = _engine()
    pc = _pause(eng, require_confirm=False,
                conflict={"strategy": "OTHER", "direction": "CALL", "paper_mode": False})
    assert "_auto_enter" not in pc


# ── in-window STRONG → auto-enter (rule 2a/2c) ───────────────────────────────

def test_strong_during_window_auto_enters_after_two_closes():
    eng = _engine(gate_results=[STRONG, STRONG])
    _pause(eng)
    eng._recheck_pending_confirmation(765.0)
    eng._execute_entry.assert_not_called()          # 1st STRONG close: confirming
    eng._recheck_pending_confirmation(765.0)
    eng._execute_entry.assert_called_once()         # 2nd STRONG close: enter
    assert eng.logger.update_pending_confirmation.call_args[0][1]["status"] == "AUTO_ENTERED"
    assert eng._pending_confirmation is None


def test_single_strong_close_does_not_enter():
    eng = _engine(gate_results=[STRONG])
    _pause(eng)
    eng._recheck_pending_confirmation(765.0)
    eng._execute_entry.assert_not_called()
    assert eng._pending_confirmation is not None


def test_strong_then_moderate_resets_the_streak():
    eng = _engine(gate_results=[STRONG, MODERATE, STRONG])
    _pause(eng)
    eng._recheck_pending_confirmation(765.0)        # streak 1
    eng._recheck_pending_confirmation(765.0)        # MODERATE: streak 0
    eng._recheck_pending_confirmation(765.0)        # STRONG again: streak 1
    eng._execute_entry.assert_not_called()


def test_strong_but_price_back_inside_range_does_not_enter():
    eng = _engine(gate_results=[STRONG, STRONG])
    _pause(eng)
    eng._recheck_pending_confirmation(763.0)        # below ORH — not beyond the level
    eng._recheck_pending_confirmation(763.0)
    eng._execute_entry.assert_not_called()


def test_approve_still_works_after_refactor():
    eng = _engine()
    _pause(eng)
    assert eng.approve_pending_entry("p1") == {"status": "ok"}
    eng._execute_entry.assert_called_once()
    assert eng.logger.update_pending_confirmation.call_args[0][1]["status"] == "APPROVED"


# ── expiry → re-arm (rule 1) ─────────────────────────────────────────────────

def test_unanswered_expiry_rearms_the_watch():
    eng = _engine()
    deadline = (datetime.now(ET) + timedelta(hours=1), "2h without confirmation")
    _pause(eng, watch_deadline=deadline)
    _backdate_expired(eng)
    assert eng.expire_pending_if_stale() is True
    assert eng.logger.update_pending_confirmation.call_args[0][1]["status"] == "EXPIRED_REARMED"
    w = eng._gate_watch
    assert w is not None and w["direction"] == "CALL" and w["auto_enter"] is True
    assert w["expires_at"] == deadline[0]          # original deadline preserved
    assert w["expiry_reason"] == deadline[1]
    eng.notifier.notify_gate_watch_started.assert_not_called()   # silent re-arm


def test_opt_in_expiry_dies_without_rearm():
    eng = _engine()
    _pause(eng, require_confirm=False)
    _backdate_expired(eng)
    assert eng.expire_pending_if_stale() is True
    assert eng.logger.update_pending_confirmation.call_args[0][1]["status"] == "EXPIRED"
    assert eng._gate_watch is None


def test_skip_does_not_rearm():
    eng = _engine()
    _pause(eng)
    assert eng.skip_pending_entry("p1") == {"status": "ok"}
    assert eng.logger.update_pending_confirmation.call_args[0][1]["status"] == "SKIPPED"
    assert eng._gate_watch is None


# ── re-armed watch: MODERATE keeps watching, STRONG enters (rules 2b/3) ─────

def test_rearmed_watch_moderate_keeps_watching_no_second_pause():
    eng = _engine(gate_results=[MODERATE])
    _pause(eng)
    _backdate_expired(eng)
    eng.expire_pending_if_stale()
    w = eng._gate_watch
    eng._enter_trade = MagicMock()
    eng._recheck_gate_watch(w["id"], 765.0)
    eng._enter_trade.assert_not_called()            # no second confirmation
    assert eng._gate_watch is not None             # watch still alive


def test_rearmed_watch_strong_enters_after_two_closes():
    eng = _engine(gate_results=[STRONG, STRONG])
    _pause(eng)
    _backdate_expired(eng)
    eng.expire_pending_if_stale()
    w = eng._gate_watch
    eng._enter_trade = MagicMock()
    eng._recheck_gate_watch(w["id"], 765.0)
    eng._enter_trade.assert_not_called()            # 1st STRONG close: confirming
    eng._recheck_gate_watch(w["id"], 765.0)
    eng._enter_trade.assert_called_once()
    assert eng._enter_trade.call_args.kwargs["gate_result"] is False  # STRONG: no confirm
    assert eng._gate_watch is None                  # watch consumed by the entry


def test_rearmed_watch_failed_gate_resets_streak():
    eng = _engine(gate_results=[STRONG, FAILED, STRONG, STRONG])
    _pause(eng)
    _backdate_expired(eng)
    eng.expire_pending_if_stale()
    w = eng._gate_watch
    eng._enter_trade = MagicMock()
    eng._recheck_gate_watch(w["id"], 765.0)         # STRONG: streak 1
    eng._recheck_gate_watch(w["id"], 765.0)         # FAILED: streak 0
    eng._recheck_gate_watch(w["id"], 765.0)         # STRONG: streak 1
    eng._enter_trade.assert_not_called()
