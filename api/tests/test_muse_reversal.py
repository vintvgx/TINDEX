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
