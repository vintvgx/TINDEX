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
        eng, "CALL", 765.00, CONTRACT, 4, dict(eng.profile),
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


# ── CodeRabbit PR #124 fixes ─────────────────────────────────────────────────

def test_r1_gate_evaluated_at_current_close_not_trigger_price():
    seen = {}

    def _eval(direction, price, required, mode="daily", quiet=False):
        seen["price"] = price
        return STRONG

    eng = _engine()
    eng._check_technicals_gate = _eval
    _pause(eng)
    eng._recheck_pending_confirmation(766.0)   # close differs from trigger 765.00
    assert seen["price"] == 766.0


def test_r2_guard_flip_mid_eval_blocks_entry():
    calls = {"n": 0}
    eng = _engine()

    def _eval(direction, price, required, mode="daily", quiet=False):
        calls["n"] += 1
        if calls["n"] == 1:
            eng.config["active"] = False   # paused mid-evaluation
        return STRONG

    eng._check_technicals_gate = _eval
    _pause(eng)
    eng._recheck_pending_confirmation(765.0)   # STRONG eval, guard fails → no count
    eng._execute_entry.assert_not_called()
    eng.config["active"] = True
    eng._recheck_pending_confirmation(765.0)   # STRONG again — count 1, not 2
    eng._execute_entry.assert_not_called()
    assert eng._pending_confirmation is not None


def test_r3_replaced_confirmation_result_is_discarded():
    calls = {"n": 0}
    eng = _engine()

    def _eval(direction, price, required, mode="daily", quiet=False):
        calls["n"] += 1
        if calls["n"] == 1:
            # Skip p1 + a new signal creates p2 while the eval is running.
            eng._pending_confirmation = dict(eng._pending_confirmation, id="p2")
        return STRONG

    eng._check_technicals_gate = _eval
    _pause(eng)
    eng._recheck_pending_confirmation(765.0)   # result for p1 — discarded
    assert eng._pending_confirmation["id"] == "p2"
    eng._execute_entry.assert_not_called()
    eng._recheck_pending_confirmation(765.0)   # STRONG for p2 — count 1, not 2
    eng._execute_entry.assert_not_called()
    assert eng._pending_confirmation["id"] == "p2"


def test_r4_none_gate_resets_streak_pending_path():
    eng = _engine(gate_results=[STRONG, (False, False, None), STRONG])
    _pause(eng)
    eng._recheck_pending_confirmation(765.0)   # STRONG: 1
    eng._recheck_pending_confirmation(765.0)   # None: reset
    eng._recheck_pending_confirmation(765.0)   # STRONG: 1 again
    eng._execute_entry.assert_not_called()


def test_r4_none_gate_resets_streak_watch_path():
    eng = _engine(gate_results=[STRONG, (False, False, None), STRONG])
    _pause(eng)
    _backdate_expired(eng)
    eng.expire_pending_if_stale()
    w = eng._gate_watch
    eng._enter_trade = MagicMock()
    eng._recheck_gate_watch(w["id"], 765.0)   # STRONG: 1
    eng._recheck_gate_watch(w["id"], 765.0)   # None: reset
    eng._recheck_gate_watch(w["id"], 765.0)   # STRONG: 1 again
    eng._enter_trade.assert_not_called()


def test_r4_expiry_handoff_preserves_streak():
    eng = _engine(gate_results=[STRONG, STRONG])
    _pause(eng)
    eng._recheck_pending_confirmation(765.0)   # STRONG: streak 1
    assert eng._auto_enter_streak == {"direction": "CALL", "count": 1}
    _backdate_expired(eng)
    eng.expire_pending_if_stale()
    assert eng._auto_enter_streak == {"direction": "CALL", "count": 1}  # survives the handoff
    w = eng._gate_watch
    eng._enter_trade = MagicMock()
    eng._recheck_gate_watch(w["id"], 765.0)   # STRONG: streak 2 → enter
    eng._enter_trade.assert_called_once()


def test_r4_inflight_skip_resets_streak_pending_path():
    eng = _engine(gate_results=[STRONG])
    _pause(eng)
    eng._recheck_pending_confirmation(765.0)   # streak 1
    eng._pending_recheck_inflight = True
    eng._on_bar_pending_confirmation(765.0)   # skipped close — streak 0
    assert eng._auto_enter_streak == {"direction": None, "count": 0}


def test_r4_inflight_skip_resets_streak_watch_path():
    eng = _engine(gate_results=[STRONG])
    _pause(eng)
    _backdate_expired(eng)
    eng.expire_pending_if_stale()
    w = eng._gate_watch
    eng._recheck_gate_watch(w["id"], 765.0)   # STRONG: streak 1
    eng._gate_watch_inflight = True
    eng._on_bar_gate_watch(765.0)             # skipped close — streak 0
    assert eng._auto_enter_streak == {"direction": None, "count": 0}


def test_r5_daily_mode_pass_does_not_count():
    daily = (True, False, {"mode": "daily", "passed": True, "needs_confirm": False,
                           "matched": 4, "total": 4, "summary": "4/4"})
    eng = _engine()
    eng.config["technicals_gate"]["mode"] = "daily"
    eng._check_technicals_gate = MagicMock(side_effect=[daily, daily])
    _pause(eng)
    eng._recheck_pending_confirmation(765.0)
    eng._recheck_pending_confirmation(765.0)
    eng._execute_entry.assert_not_called()


def test_r5_composite_moderate_tier_with_no_confirm_flag_does_not_count():
    inconsistent = (True, False, _gate(passed=True, needs_confirm=False, matched=4, tier="MODERATE"))
    eng = _engine(gate_results=[inconsistent, inconsistent])
    _pause(eng)
    eng._recheck_pending_confirmation(765.0)
    eng._recheck_pending_confirmation(765.0)
    eng._execute_entry.assert_not_called()


def test_r5_daily_mode_pass_does_not_enter_rearmed_watch():
    daily = (True, False, {"mode": "daily", "passed": True, "needs_confirm": False,
                           "matched": 4, "total": 4, "summary": "4/4"})
    eng = _engine()
    eng.config["technicals_gate"]["mode"] = "daily"
    eng._check_technicals_gate = MagicMock(side_effect=[daily, daily])
    _pause(eng)
    _backdate_expired(eng)
    eng.expire_pending_if_stale()
    w = eng._gate_watch
    eng._enter_trade = MagicMock()
    eng._recheck_gate_watch(w["id"], 765.0)
    eng._recheck_gate_watch(w["id"], 765.0)
    eng._enter_trade.assert_not_called()
    assert eng._gate_watch is not None   # still watching, not entered


def test_r6_auto_enter_records_the_strong_gate_not_the_moderate_snapshot():
    strong2 = (True, False, _gate(passed=True, needs_confirm=False, matched=9, tier="STRONG"))
    eng = _engine(gate_results=[STRONG, strong2])
    _pause(eng)
    eng._recheck_pending_confirmation(765.0)   # STRONG 8/14: confirming
    eng._recheck_pending_confirmation(765.0)   # STRONG 9/14: enter
    eng._execute_entry.assert_called_once()
    snapshot = eng._execute_entry.call_args.kwargs["gate_snapshot"]
    assert snapshot["composite"]["tier"] == "STRONG" and snapshot["matched"] == 9


def test_r6_approve_still_records_the_original_moderate_snapshot():
    eng = _engine()
    _pause(eng)
    assert eng.approve_pending_entry("p1") == {"status": "ok"}
    snapshot = eng._execute_entry.call_args.kwargs["gate_snapshot"]
    assert snapshot["composite"]["tier"] == "MODERATE" and snapshot["matched"] == 4


def test_r7_conflict_blocks_unattended_entry_pending_stays_open():
    eng = _engine(gate_results=[STRONG, STRONG, STRONG])
    _pause(eng)
    eng._find_ticker_conflict = lambda d: object()   # another engine holds SPY CALL
    eng._recheck_pending_confirmation(765.0)   # STRONG: 1
    eng._recheck_pending_confirmation(765.0)   # STRONG: 2 — blocked by conflict
    eng._execute_entry.assert_not_called()
    assert eng._pending_confirmation is not None
    eng._find_ticker_conflict = lambda d: None       # conflict cleared
    eng._recheck_pending_confirmation(765.0)   # STRONG: enters
    eng._execute_entry.assert_called_once()


def test_r8_dead_deadline_resolves_expired_not_rearmed():
    eng = _engine()
    dead = (datetime.now(ET) - timedelta(minutes=1), "2h without confirmation")
    _pause(eng, watch_deadline=dead)
    _backdate_expired(eng)
    assert eng.expire_pending_if_stale() is True
    assert eng.logger.update_pending_confirmation.call_args[0][1]["status"] == "EXPIRED"
    assert eng._gate_watch is None


def test_r9_watch_off_rearm_survives_rechecks_and_enters():
    eng = _engine(gate_results=[STRONG, STRONG])
    eng.config["technicals_gate"]["watch"] = False
    deadline = (datetime.now(ET) + timedelta(hours=1), "2h without confirmation")
    _pause(eng, watch_deadline=deadline)
    _backdate_expired(eng)
    eng.expire_pending_if_stale()
    w = eng._gate_watch
    assert w is not None and w["auto_enter"] is True
    eng._enter_trade = MagicMock()
    eng._recheck_gate_watch(w["id"], 765.0)   # STRONG: 1 — watch must survive
    assert eng._gate_watch is not None
    eng._recheck_gate_watch(w["id"], 765.0)   # STRONG: 2 — enter
    eng._enter_trade.assert_called_once()
    assert eng._gate_watch is None


def test_r9_watch_off_rearm_survives_restart_restore():
    eng = _engine()
    eng.config["technicals_gate"]["watch"] = False
    deadline = (datetime.now(ET) + timedelta(hours=1), "2h without confirmation")
    _pause(eng, watch_deadline=deadline)
    _backdate_expired(eng)
    eng.expire_pending_if_stale()
    w = eng._gate_watch
    assert w is not None
    # The restore row must come from what _rearm_gate_watch actually
    # persisted — not a fabricated auto_enter=True, which would pass even
    # if the persist never happened and a real restart could not restore
    # the watch when technicals_gate.watch is off.
    create_row = eng.logger.create_gate_watch.call_args[0][0]
    updates = [c[0][1] for c in eng.logger.update_gate_watch.call_args_list]
    assert {"auto_enter": True} in updates
    persisted = next(u for u in updates if u.get("auto_enter") is True)
    now = datetime.now(ET)
    row = dict(create_row)
    row.update(created_at=now.isoformat(), kind="breakout",
               auto_enter=persisted["auto_enter"])
    eng.logger.list_gate_watches.return_value = [row]
    eng._gate_watch = None   # simulate the restart clearing in-memory state
    eng.restore_gate_watch()
    assert eng._gate_watch is not None
    assert eng._gate_watch["auto_enter"] is True
    assert eng._gate_watch["id"] == w["id"]


# ── CodeRabbit second review (5879731114) ────────────────────────────────────

class _CaptureExecutor:
    """Executor that captures submissions instead of running them."""

    def __init__(self):
        self.submitted = []

    def submit(self, fn, *args):
        self.submitted.append((fn, args))


def test_stale_pending_worker_discarded_after_newer_close():
    eng = _engine(gate_results=[STRONG, STRONG, STRONG])
    _pause(eng)
    ex = _CaptureExecutor()
    orig = gw._WATCH_EXECUTOR
    gw._WATCH_EXECUTOR = ex
    try:
        eng._on_bar_pending_confirmation(765.0)   # submits worker(gen=1)
        assert len(ex.submitted) == 1
        eng._on_bar_pending_confirmation(765.0)   # newer bar: inflight → reset, gen=2
        assert eng._auto_enter_streak == {"direction": None, "count": 0}
        fn, args = ex.submitted[0]
        fn(*args)                                  # stale worker — discarded
        eng._execute_entry.assert_not_called()
        assert eng._auto_enter_streak == {"direction": None, "count": 0}
        eng._on_bar_pending_confirmation(765.0)   # fresh worker(gen=3) — STRONG 1
        fn, args = ex.submitted[-1]
        fn(*args)
        eng._execute_entry.assert_not_called()
        assert eng._auto_enter_streak == {"direction": "CALL", "count": 1}
        eng._on_bar_pending_confirmation(765.0)   # fresh worker(gen=4) — STRONG 2 → enter
        fn, args = ex.submitted[-1]
        fn(*args)
        eng._execute_entry.assert_called_once()
    finally:
        gw._WATCH_EXECUTOR = orig


def test_stale_watch_worker_discarded_after_newer_close():
    eng = _engine(gate_results=[STRONG, STRONG, STRONG])
    _pause(eng)
    _backdate_expired(eng)
    eng.expire_pending_if_stale()
    w = eng._gate_watch
    eng._enter_trade = MagicMock()
    ex = _CaptureExecutor()
    orig = gw._WATCH_EXECUTOR
    gw._WATCH_EXECUTOR = ex
    try:
        eng._on_bar_gate_watch(765.0)             # submits worker(gen=1)
        assert len(ex.submitted) == 1
        eng._on_bar_gate_watch(765.0)             # newer bar: inflight → reset, gen=2
        assert eng._auto_enter_streak == {"direction": None, "count": 0}
        fn, args = ex.submitted[0]
        fn(*args)                                  # stale worker — discarded, no check counted
        eng._enter_trade.assert_not_called()
        assert w["checks"] == 0
        eng._on_bar_gate_watch(765.0)             # fresh worker(gen=3) — STRONG 1
        fn, args = ex.submitted[-1]
        fn(*args)
        eng._enter_trade.assert_not_called()
        eng._on_bar_gate_watch(765.0)             # fresh worker(gen=4) — STRONG 2 → enter
        fn, args = ex.submitted[-1]
        fn(*args)
        eng._enter_trade.assert_called_once()
        assert w["checks"] == 2
    finally:
        gw._WATCH_EXECUTOR = orig


def test_inactive_skip_resets_streak_pending_path():
    eng = _engine(gate_results=[STRONG])
    _pause(eng)
    eng._recheck_pending_confirmation(765.0)   # streak 1
    eng.config["active"] = False
    eng._on_bar_pending_confirmation(765.0)   # skipped while paused — reset
    assert eng._auto_enter_streak == {"direction": None, "count": 0}


def test_inactive_skip_resets_streak_watch_path():
    eng = _engine(gate_results=[STRONG])
    _pause(eng)
    _backdate_expired(eng)
    eng.expire_pending_if_stale()
    w = eng._gate_watch
    eng._recheck_gate_watch(w["id"], 765.0)   # streak 1
    eng.config["active"] = False
    eng._on_bar_gate_watch(765.0)             # skipped while paused — reset
    assert eng._auto_enter_streak == {"direction": None, "count": 0}


def test_blocked_auto_enter_restores_original_snapshot():
    eng = _engine(gate_results=[STRONG, STRONG])
    _pause(eng)
    eng._find_ticker_conflict = lambda d: object()   # block the auto-enter
    eng._recheck_pending_confirmation(765.0)   # STRONG 1
    eng._recheck_pending_confirmation(765.0)   # STRONG 2 — blocked, snapshot restored
    eng._execute_entry.assert_not_called()
    assert eng._pending_confirmation is not None
    snapshot = eng._pending_confirmation["_gate_snapshot"]
    assert snapshot["composite"]["tier"] == "MODERATE" and snapshot["matched"] == 4
    # A later manual approval still records the gate the card showed.
    eng._find_ticker_conflict = lambda d: None
    assert eng.approve_pending_entry("p1") == {"status": "ok"}
    snapshot = eng._execute_entry.call_args.kwargs["gate_snapshot"]
    assert snapshot["composite"]["tier"] == "MODERATE" and snapshot["matched"] == 4
