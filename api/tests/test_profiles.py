"""
Stop-timer defaults (2026-11-10): every profile that has a stop-loss must
carry the 5-minute stop timer (SL_10 keeps its 10-minute identity), so a
hard stop can never silently come back by adding a profile without grace
fields. NO_STOP_LOSS is exempt — it has no stop to time (max_loss_pct 1.0).

The timer itself: an SL hit starts a clock (SL_GRACE) instead of selling;
it fires only after 5 minutes without a sustained recovery, and a −50%
outer floor still sells immediately.
"""
import os
import sys
from datetime import timedelta

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from services.strategy.exit_manager import ExitManager  # noqa: E402
from services.strategy.profiles import (  # noqa: E402
    CUSTOM_DEFAULTS, PROFILES, grace_fields_for_minutes)


def test_every_stop_profile_has_a_stop_timer():
    for key, p in PROFILES.items():
        if key == "NO_STOP_LOSS":
            continue
        if p.get("max_loss_pct", 0) >= 1.0:
            continue
        assert p.get("sl_grace_enabled") is True, f"{key}: sl_grace_enabled"
        assert p.get("sl_grace_seconds") in (300, 600), (
            f"{key}: sl_grace_seconds={p.get('sl_grace_seconds')} "
            "(5 min default, 10 min only for SL_10)")
        assert p.get("sl_grace_recovery_seconds") == 60, (
            f"{key}: sl_grace_recovery_seconds")
        assert p.get("sl_outer_floor_pct") == 0.50, (
            f"{key}: sl_outer_floor_pct (worst-case floor bypasses the timer)")


def test_custom_defaults_carry_the_timer():
    assert CUSTOM_DEFAULTS["sl_grace_enabled"] is True
    assert CUSTOM_DEFAULTS["sl_grace_seconds"] == 300
    assert CUSTOM_DEFAULTS["sl_grace_recovery_seconds"] == 60
    assert CUSTOM_DEFAULTS["sl_outer_floor_pct"] == 0.50


def test_grace_fields_for_minutes_mapping():
    assert grace_fields_for_minutes(None) == {"sl_grace_enabled": False}
    assert grace_fields_for_minutes(5) == {
        "sl_grace_enabled": True, "sl_grace_seconds": 300,
        "sl_grace_recovery_seconds": 60, "sl_outer_floor_pct": 0.50,
    }
    assert grace_fields_for_minutes(10)["sl_grace_seconds"] == 600
    assert grace_fields_for_minutes(15)["sl_grace_seconds"] == 900
    with pytest.raises(ValueError):
        grace_fields_for_minutes(7)


# ── The timer itself (ExitManager, TREND_RIDER profile) ─────────────────────

def _em(entry=1.00):
    from services.strategy.profiles import get_profile
    p = get_profile("TREND_RIDER")
    return ExitManager(entry, 4, {"orh": 99.0, "orl": 98.0}, "CALL", "15:58",
                       p, is_zero_dte=False)


def test_sl_hit_waits_out_the_timer_then_fires():
    em = _em()  # TREND_RIDER: hard_stop 0.70, sl_confirm_ticks 2
    assert em.evaluate(0.65)["reason"] == "SL_CONFIRMING"
    assert em.evaluate(0.65)["reason"] == "SL_GRACE"  # clock started, no sell
    assert em.evaluate(0.65)["reason"] == "SL_GRACE"  # still waiting
    em._sl_grace_start -= timedelta(seconds=301)
    a = em.evaluate(0.65)
    assert (a["type"], a["reason"]) == ("CLOSE_ALL", "HARD_STOP")


def test_recovery_inside_the_timer_cancels_the_stop():
    em = _em()
    em.evaluate(0.65)
    em.evaluate(0.65)
    assert em._sl_grace_active is True
    # Back above the stop — needs 60 s held to count as a real recovery.
    assert em.evaluate(0.80)["type"] == "HOLD"
    assert em._sl_grace_active is True
    em._sl_recovery_start -= timedelta(seconds=61)
    assert em.evaluate(0.80)["type"] == "HOLD"
    assert em._sl_grace_active is False
    # And the stop re-arms cleanly if price falls back through it.
    assert em.evaluate(0.65)["reason"] == "SL_CONFIRMING"


def test_outer_floor_bypasses_the_timer():
    em = _em()  # floor at 50% of entry = 0.50
    a = em.evaluate(0.49)
    assert (a["type"], a["reason"]) == ("CLOSE_ALL", "HARD_STOP_FLOOR")
