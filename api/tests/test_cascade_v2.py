"""
Cascade v2 (trade-logging-cascade-v2 brief §3): after TP1, a 50% give-back of
the peak gain opens a candidate; 2 consecutive 1m bars against the trade by
the close of the next full 5m bar trims 50% of non-runner contracts. Never
below breakeven, never the last runner. Reproduces the brief's §3.3 checks.
"""
import os
import sys
from datetime import datetime, timedelta

import pytest
import pytz

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from services.strategy.exit_manager import ExitManager  # noqa: E402
from services.strategy.profiles import get_profile  # noqa: E402

ET = pytz.timezone("America/New_York")
ORB = {"orh": 764.0, "orl": 758.0}


class Clock:
    def __init__(self, t):
        self.t = t

    def __call__(self):
        return self.t


def _em(entry=1.00, qty=4, direction="PUT", t=ET.localize(datetime(2026, 11, 3, 10, 20)), **over):
    em = ExitManager(entry, qty, ORB, direction, "15:58",
                     get_profile("TREND_RIDER", over or None), is_zero_dte=False)
    em._now = Clock(t)
    return em


def _tick(em, price):
    a = em.evaluate(current_option_price=price, current_underlying_price=760.0)
    if a["type"] != "HOLD":
        em.update_qty(a["qty"])
    return a


def _hit_tp1(em, price):
    _tick(em, price)
    a = _tick(em, price)                    # tp1_confirm_ticks = 2
    assert a["reason"] == "TP1"
    return a


def _bar(em, minute_ts, against=True, doji=False):
    """One 1m underlying bar starting at minute_ts. For a PUT, green = against."""
    o = 760.0
    c = o if doji else (o + 0.2 if against else o - 0.2)
    if em.direction == "CALL" and not doji:
        c = o - 0.2 if against else o + 0.2
    em.on_underlying_bar(o, c, ts=minute_ts, high=max(o, c) + 0.05, low=min(o, c) - 0.05)


def _at(h, m, s=0):
    return ET.localize(datetime(2026, 11, 3, h, m, s))


# ── Trigger level ────────────────────────────────────────────────────────────

def test_trigger_is_halfway_back_from_peak():
    em = _em()
    # 2026-11-10: TP1 is pure +15% now — the $0.30 floor that made it 1.30
    # is gone (TPs follow the strategy's percentages exactly).
    assert em.tp1 == pytest.approx(1.15)
    _hit_tp1(em, 1.30)
    assert em.cascade_trigger_level() == pytest.approx(1.15)     # still +15%, $0.15 above BE


def test_trigger_tracks_peak_not_tp1_level():
    em = _em()
    _hit_tp1(em, 1.30)
    _tick(em, 1.50)
    assert em.cascade_trigger_level() == pytest.approx(1.25)


def test_spy_oct30_1016_trigger():
    em = _em(entry=1.58, tp1_mult=1.30, min_tp1_dollars=0.0)
    assert em.tp1 == pytest.approx(2.054)
    _hit_tp1(em, em.tp1)
    assert em.cascade_trigger_level() == pytest.approx(1.817)


def test_spy_oct30_1105_tp2_wins_untouched_no_cascade():
    em = _em(entry=1.19, tp1_mult=1.30, min_tp1_dollars=0.0,
             tp2_mult=1.672, min_tp2_dollars=0.0, tp2_close_pct=1.0)
    assert em.tp1 == pytest.approx(1.547)
    _hit_tp1(em, em.tp1)
    assert em.cascade_trigger_level() == pytest.approx(1.3685)
    for p in (1.60, 1.75, 1.90):                 # climbs, never back to 1.369
        assert _tick(em, p)["type"] == "HOLD"
        assert em._cascade_candidate is None
    a = _tick(em, 1.99)
    assert (a["reason"], a["qty"]) == ("TP2_FULL_CLOSE", 2)
    assert em.qty_remaining == 0


def test_post_tp2_trigger_uses_same_rule_with_peak_at_tp2():
    em = _em(entry=1.19, qty=6, tp1_mult=1.30, min_tp1_dollars=0.0,
             tp2_mult=1.75, min_tp2_dollars=0.0, tp2_close_pct=0.35)
    _hit_tp1(em, 1.547)
    a = _tick(em, 2.09)
    assert a["reason"] == "TP2" and em.qty_remaining >= 2
    assert em.cascade_trigger_level() == pytest.approx(1.64)


# ── Confirmation + window ────────────────────────────────────────────────────

def test_deadline_is_close_of_next_full_5m_bar():
    assert ExitManager.cascade_deadline(_at(10, 22, 30)) == _at(10, 30)
    assert ExitManager.cascade_deadline(_at(10, 24, 59)) == _at(10, 30)
    assert ExitManager.cascade_deadline(_at(10, 25, 0)) == _at(10, 30)
    assert ExitManager.cascade_deadline(_at(10, 25, 1)) == _at(10, 35)


def test_green_green_trims_in_profit():
    em = _em(t=_at(10, 22, 30))
    _hit_tp1(em, 1.30)
    assert em.qty_remaining == 2
    _tick(em, 1.15)                                    # trigger
    assert em._cascade_candidate is not None
    _bar(em, _at(10, 22))                              # began before trigger — ignored
    assert em._cascade_candidate["against"] == 0
    _bar(em, _at(10, 23))
    _bar(em, _at(10, 24))
    a = _tick(em, 1.14)
    assert (a["type"], a["reason"], a["qty"]) == ("CLOSE_PARTIAL", "CASCADE_EXIT", 1)
    assert 1.12 <= a["current_premium"] <= 1.18 and a["current_premium"] > em.entry_premium
    assert em.qty_remaining == 1                       # runner preserved


def test_green_then_red_resets_and_holds():
    em = _em(t=_at(10, 22, 30))
    _hit_tp1(em, 1.30)
    _tick(em, 1.15)
    _bar(em, _at(10, 23), against=True)
    _bar(em, _at(10, 24), against=False)
    assert em._cascade_candidate["against"] == 0
    assert _tick(em, 1.14)["type"] == "HOLD"


def test_doji_leaves_count_unchanged():
    em = _em(t=_at(10, 22, 30))
    _hit_tp1(em, 1.30)
    _tick(em, 1.15)
    _bar(em, _at(10, 23))
    _bar(em, _at(10, 24), doji=True)
    _bar(em, _at(10, 25))
    assert _tick(em, 1.14)["reason"] == "CASCADE_EXIT"


def test_no_two_in_a_row_by_5m_close_blocks_and_resets_peak():
    em = _em(t=_at(10, 22, 30))
    _hit_tp1(em, 1.30)
    _tick(em, 1.15)
    for m in range(23, 30):                            # alternating; last bar closes 10:30
        _bar(em, _at(10, m), against=(m % 2 == 1))
    assert em._cascade_candidate is None               # blocked at the deadline
    assert _tick(em, 1.14)["type"] == "HOLD"
    assert em.cascade_trigger_level() < 1.15           # new peak tracked from 1.15


def test_confirmation_after_deadline_does_not_count():
    em = _em(t=_at(10, 22, 30))
    _hit_tp1(em, 1.30)
    _tick(em, 1.15)
    _bar(em, _at(10, 29))                              # closes exactly at deadline: counts
    _bar(em, _at(10, 30))                              # closes 10:31: past window → blocked
    assert em._cascade_candidate is None
    assert _tick(em, 1.14)["type"] == "HOLD"


def test_call_direction_uses_red_bars():
    em = _em(direction="CALL", t=_at(10, 22, 30))
    _hit_tp1(em, 1.30)
    _tick(em, 1.15)
    _bar(em, _at(10, 23))
    _bar(em, _at(10, 24))
    assert _tick(em, 1.14)["reason"] == "CASCADE_EXIT"


def test_three_bar_bounce_without_retrace_never_fires():
    """Oct 30 10:16 failure mode: 1m noise while premium held near its peak."""
    em = _em(t=_at(10, 22, 30))
    _hit_tp1(em, 1.30)
    for m in range(23, 30):
        _bar(em, _at(10, m))
        assert _tick(em, 1.25)["type"] == "HOLD"
    assert em._cascade_candidate is None


# ── Floor + runner + TP2-once ────────────────────────────────────────────────

def test_breakeven_during_window_blocks_and_be_stop_owns_it():
    em = _em(t=_at(10, 22, 30))
    _hit_tp1(em, 1.30)
    _tick(em, 1.15)
    _bar(em, _at(10, 23))
    a = _tick(em, 1.00)
    assert em._cascade_candidate is None
    assert a["reason"] != "CASCADE_EXIT"


def test_confirmed_but_premium_at_breakeven_never_trims():
    em = _em(t=_at(10, 22, 30))
    _hit_tp1(em, 1.30)
    _tick(em, 1.15)
    _bar(em, _at(10, 23))
    _bar(em, _at(10, 24))
    a = _tick(em, 0.99)
    assert a["reason"] != "CASCADE_EXIT"
    assert em._cascade_candidate is None and not em._cascade_fire_pending


def test_two_contract_trade_never_cascades_the_runner():
    em = _em(qty=2, t=_at(10, 22, 30))
    _hit_tp1(em, 1.30)
    assert em.qty_remaining == 1
    _tick(em, 1.15)
    _bar(em, _at(10, 23))
    _bar(em, _at(10, 24))
    assert _tick(em, 1.14)["type"] == "HOLD"


def test_repeat_cascades_never_close_final_runner():
    em = _em(qty=10, t=_at(10, 22, 30))
    _hit_tp1(em, 1.30)
    fired = 0
    for cycle in range(6):
        base = _at(10, 22, 30) + timedelta(minutes=10 * cycle)
        em._now = Clock(base)
        _tick(em, 1.40)                                # new peak
        _tick(em, 1.20)                                # ≤ trigger (1.20)
        _bar(em, base.replace(second=0) + timedelta(minutes=1))
        _bar(em, base.replace(second=0) + timedelta(minutes=2))
        if _tick(em, 1.19)["reason"] == "CASCADE_EXIT":
            fired += 1
    assert fired >= 1 and em.qty_remaining == 1


def test_tp2_fires_once():
    em = _em(qty=6, tp2_close_pct=0.35)
    _hit_tp1(em, 1.30)
    assert _tick(em, em.tp2)["reason"] == "TP2"
    for _ in range(3):
        assert _tick(em, em.tp2 + 0.1)["reason"] != "TP2"


def test_disabling_cascade_mid_window_blocks_candidate():
    em = _em(t=_at(10, 22, 30))
    _hit_tp1(em, 1.30)
    _tick(em, 1.15)
    em.apply_overrides(cascade_enabled=False)
    _bar(em, _at(10, 23))
    _bar(em, _at(10, 24))
    assert _tick(em, 1.14)["type"] == "HOLD"
    assert em._cascade_candidate is None


def test_retrace_pct_override_and_clamp():
    em = _em(cascade_retrace_pct=0.40)
    _hit_tp1(em, 1.30)
    assert em.cascade_trigger_level() == pytest.approx(1.18)
    em2 = _em(cascade_retrace_pct=1.5)
    _hit_tp1(em2, 1.30)
    assert em2.cascade_trigger_level() > em2.entry_premium
