"""
MUSE_REVERSAL (spec §10, 2026-11-02) — pure-helper + profile tests.
No broker, no DB, no live data. The engine wiring (arming, hold,
reclaim close) is guarded by profile_key == "MUSE_REVERSAL" and is
covered here by the tracker semantics the engine relies on; the
live path itself stays paused (no strategy row) until Kareem arms it.
"""
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from services.strategy.muse_reversal import (  # noqa: E402
    VwapSideTracker, muse_entry_ready, muse_technicals_pass)
from services.strategy.profiles import get_profile  # noqa: E402


def test_profile_exists_and_is_separate_from_reversal():
    muse = get_profile("MUSE_REVERSAL")
    rev = get_profile("REVERSAL")
    assert muse["vwap_hold_bars"] == 3
    assert muse["vwap_reclaim_bars"] == 3
    assert muse["breakout_time_limit_min"] == 240
    assert muse["runner_mode"] == "be_hold"
    # Separate profile object — editing MUSE must not mutate REVERSAL.
    assert muse is not rev
    assert "vwap_hold_bars" not in rev


def test_vwap_hold_needs_three_consecutive_closes_below():
    tr = VwapSideTracker("PUT", 3)
    assert not tr.feed(759.5, 760.0)
    assert not tr.feed(759.0, 760.0)
    assert tr.feed(758.5, 760.0)  # third consecutive close below VWAP


def test_vwap_hold_resets_on_close_above():
    tr = VwapSideTracker("PUT", 3)
    tr.feed(759.5, 760.0)
    tr.feed(759.0, 760.0)
    assert not tr.feed(760.5, 760.0)  # close above VWAP resets to zero
    assert tr.count == 0
    assert not tr.feed(759.0, 760.0)
    assert not tr.feed(759.0, 760.0)
    assert tr.feed(759.0, 760.0)


def test_wick_above_vwap_does_not_reset_hold():
    # The tracker only sees closes — a wick is not a close, so a
    # close below VWAP after a wick above still counts.
    tr = VwapSideTracker("PUT", 3)
    tr.feed(759.5, 760.0)
    tr.feed(759.2, 760.0)
    assert tr.feed(759.0, 760.0)


def test_reclaim_tracker_fires_on_three_closes_back_across():
    # For a PUT reversal, the reclaim tracker uses direction CALL,
    # so its "reversal side" is ABOVE VWAP (back on the trend side).
    tr = VwapSideTracker("CALL", 3)
    assert not tr.feed(760.5, 760.0)
    assert not tr.feed(760.2, 760.0)
    assert tr.feed(760.8, 760.0)
    # And a close back below VWAP resets it.
    tr2 = VwapSideTracker("CALL", 3)
    tr2.feed(760.5, 760.0)
    tr2.feed(760.5, 760.0)
    assert not tr2.feed(759.5, 760.0)
    assert tr2.count == 0


def test_technicals_pass_intraday_only():
    # Today (2026-11-02 SPY): intraday RSI, MACD, trend all 2.
    passed, total = muse_technicals_pass(
        {"rsi": 2, "macd": 2, "trend": 2})
    assert passed and total == 6
    # Zone + volume alone must not pass (needs two core 2s).
    passed, _ = muse_technicals_pass({"zone": 2, "volume": 1, "vwap_slope": 1, "rsi": 1})
    assert not passed
    # 2 + 2 + 1 passes (total 5, two core 2s).
    passed, total = muse_technicals_pass({"rsi": 2, "macd": 2, "trend": 1})
    assert passed and total == 5


def test_entry_ready_requires_all_three():
    scores = {"rsi": 2, "macd": 2, "trend": 2}
    assert muse_entry_ready(True, True, scores)[0]
    assert not muse_entry_ready(False, True, scores)[0]   # no scorer fire
    assert not muse_entry_ready(True, False, scores)[0]   # hold incomplete
    assert not muse_entry_ready(True, True, {"rsi": 0, "macd": 0, "trend": 0})[0]


# ── Engine-level tests for CodeRabbit PR #118 fixes ────────────────────────
import threading
from types import SimpleNamespace
from unittest.mock import MagicMock

from services.strategy import orb_engine as oe  # noqa: E402
from services.strategy.exit_manager import ExitManager  # noqa: E402


def _muse_engine():
    eng = oe.ORBEngine.__new__(oe.ORBEngine)
    eng.config = {"ticker": "SPY", "active": True}
    eng.ticker, eng.profile_key, eng.profile = (
        "SPY", "MUSE_REVERSAL",
        get_profile("MUSE_REVERSAL", {"breakout_time_limit_min": 1440}))
    eng.strategy_id, eng.strategy_name, eng.paper = "s1", "MUSE REVERSAL", True
    eng.bypass_breakout_window = True
    eng._tick_lock = threading.Lock()
    eng.debug, eng.logger, eng.notifier, eng._hub = MagicMock(), MagicMock(), MagicMock(), MagicMock()
    eng._reset_session_state()
    return eng


def test_reclaim_pending_closes_all_without_unbound_em():
    """CodeRabbit PR #118 (Major): the reclaim branch used `em`, which
    was only assigned inside the REVERSAL branch — so a pending reclaim
    on a MUSE_REVERSAL trade raised UnboundLocalError and never closed.
    With the fix, a HOLD tick with a pending reclaim becomes CLOSE_ALL
    with reason MUSE_VWAP_RECLAIM, and the flag is cleared."""
    eng = _muse_engine()
    eng.trade_taken, eng.active_trade_id = True, "t1"
    eng.exit_manager = ExitManager(
        1.00, 3, {"orh": 764.0, "orl": 758.0}, "PUT", "15:58",
        get_profile("MUSE_REVERSAL"), is_zero_dte=True)
    eng._muse_reclaim_pending = True
    actions = []
    eng._handle_exit_action = lambda a, cp, cop=None: actions.append(a)
    eng._process_tick(760.0, None, 1.02)  # 1.02 is HOLD: no TP/SL hit
    assert not eng._muse_reclaim_pending
    assert len(actions) == 1
    assert (actions[0]["type"], actions[0]["reason"], actions[0]["qty"]) == (
        "CLOSE_ALL", "MUSE_VWAP_RECLAIM", 3)


def test_hold_cross_back_never_enters_even_with_score_5():
    """CodeRabbit PR #118 (Minor): once the hold tracker was complete,
    feed() returned True without looking at the bar, and the cross-back
    check only ran when score < 5 — so a close back across VWAP with
    score >= 5 entered against the reversal direction. With the fix,
    the VWAP-side check runs first, resets the hold, and never enters."""
    eng = _muse_engine()
    eng._muse_armed, eng._muse_direction = True, "PUT"
    tracker = VwapSideTracker("PUT", 3)
    for c in (759.5, 759.0, 758.5):
        tracker.feed(c, 760.0)
    assert tracker.complete
    eng._muse_hold_tracker = tracker
    eng._live_session_vwap = lambda: 760.0
    eng._muse_intraday_score = lambda d, p: (6, "test")
    entered = []
    eng._enter_trade = lambda d, p, gate_result=None: entered.append((d, p, gate_result))
    eng._muse_on_bar(SimpleNamespace(close=761.0, open=761.0, high=762.0, low=760.5, ts=None))
    assert entered == []
    assert not tracker.complete and tracker.count == 0
    assert eng._muse_armed  # still armed: a fresh hold can form later
