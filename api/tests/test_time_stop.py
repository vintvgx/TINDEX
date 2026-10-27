"""
Time stop (TODO bfdeabc2): a pre-TP1 trade whose peak premium never came
time_stop_progress of the way to TP1 within time_stop_minutes is closed.
Off unless the strategy sets time_stop_minutes.
"""
import os
import sys
import threading
from datetime import timedelta
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from services.strategy import orb_engine as oe  # noqa: E402
from services.strategy.exit_manager import ExitManager  # noqa: E402
from services.strategy.profiles import get_profile  # noqa: E402

ENTRY = 1.00   # TREND_RIDER: TP1 = max(1.15, 1.00 + 0.30) = 1.30 → halfway = 1.15


def _em(minutes=60, progress=None, held_min=0):
    over = {"time_stop_minutes": minutes}
    if progress is not None:
        over["time_stop_progress"] = progress
    em = ExitManager(ENTRY, 4, {"orh": 764.0, "orl": 758.0}, "CALL", "15:58",
                     get_profile("TREND_RIDER", over), is_zero_dte=False)
    em.entry_time -= timedelta(minutes=held_min)
    return em


def _tick(em, price):
    return em.evaluate(current_option_price=price, current_underlying_price=765.0)


def test_override_keys_are_allowed():
    p = get_profile("TREND_RIDER", {"time_stop_minutes": 60, "time_stop_progress": 0.4})
    assert p["time_stop_minutes"] == 60 and p["time_stop_progress"] == 0.4


def test_off_by_default():
    em = ExitManager(ENTRY, 4, {"orh": 764.0, "orl": 758.0}, "CALL", "15:58",
                     get_profile("TREND_RIDER"), is_zero_dte=False)
    em.entry_time -= timedelta(minutes=120)
    assert _tick(em, 1.02)["type"] == "HOLD"
    assert em.to_dict()["time_stop_minutes"] is None


def test_holds_before_the_window():
    em = _em(held_min=59)
    assert _tick(em, 1.02)["type"] == "HOLD"
    assert em.to_dict()["time_stop_deadline"] is not None
    assert em.tp1 == pytest.approx(1.30) and em.to_dict()["time_stop_target"] == pytest.approx(1.15)


def test_fires_at_window_with_no_progress():
    em = _em(held_min=30)
    assert _tick(em, 1.10)["type"] == "HOLD"        # peak 1.10 < 1.15 target
    em.entry_time -= timedelta(minutes=31)
    a = _tick(em, 1.03)
    assert (a["type"], a["reason"], a["qty"], a["current_premium"]) == ("CLOSE_ALL", "TIME_STOP", 4, 1.03)


def test_peak_progress_disarms_even_after_pullback():
    em = _em(held_min=10)
    _tick(em, 1.16)                          # peak reached 1.15
    assert em.time_stop_progress_met
    em.entry_time -= timedelta(minutes=60)
    assert _tick(em, 1.02)["type"] == "HOLD"
    assert em.to_dict()["time_stop_deadline"] is None


def test_not_after_tp1():
    em = _em(held_min=61)
    em.tp1_hit = True
    assert _tick(em, 1.05)["reason"] != "TIME_STOP"


def test_custom_progress():
    # A first qualifying quote AT/AFTER the deadline is late, not earned:
    # 61 min held on a 60-min stop, target 1.075, tick 1.08 → TIME_STOP.
    em = _em(progress=0.25, held_min=61)    # target 1.075
    a = _tick(em, 1.08)
    assert (a["type"], a["reason"]) == ("CLOSE_ALL", "TIME_STOP")
    assert not em.time_stop_progress_met


def test_custom_progress_in_time_disarms():
    # Same custom progress, but the qualifying quote arrives BEFORE the
    # deadline: 59 min held, tick 1.08 ≥ 1.075 target → disarm, HOLD.
    em = _em(progress=0.25, held_min=59)    # target 1.075
    assert _tick(em, 1.08)["type"] == "HOLD" and em.time_stop_progress_met


def test_hard_stop_still_wins():
    em = _em(held_min=61)
    a = _tick(em, 0.10)
    assert a["reason"] in ("HARD_STOP", "HARD_STOP_FLOOR", "SL_CONFIRMING")


def test_time_stop_uses_protective_close():
    # TIME_STOP must NOT take the price-seeking path: a priced exit can't
    # sell contracts reserved by resting ladder sells, leaving the position
    # open past the stop. The protective path cancels the ladder first.
    assert "TIME_STOP" not in oe.PRICE_SEEKING_REASONS


def test_engine_persists_progress_once(monkeypatch):
    """The disarm survives a restart: the tick that earns it writes
    time_stop_progress_met into the trade's exit_overrides, once."""
    eng = oe.ORBEngine.__new__(oe.ORBEngine)
    eng.config = {"ticker": "SPY", "active": True}
    eng.ticker, eng.profile_key, eng.profile = "SPY", "TREND_RIDER", get_profile("TREND_RIDER")
    eng.strategy_id, eng.strategy_name, eng.paper = "s1", "SPY TR", True
    eng.bypass_breakout_window = True
    eng._tick_lock = threading.Lock()
    eng.debug, eng.logger, eng.notifier, eng._hub = MagicMock(), MagicMock(), MagicMock(), MagicMock()
    eng._reset_session_state()
    eng.trade_taken, eng.active_trade_id, eng.exit_manager = True, "t1", _em(held_min=5)
    eng._process_tick(765.0, None, 1.16)
    eng._process_tick(765.0, None, 1.20)
    patches = [c.kwargs.get("exit_overrides_patch") for c in eng.logger.update_exit_levels.call_args_list]
    assert patches.count({"time_stop_progress_met": True}) == 1