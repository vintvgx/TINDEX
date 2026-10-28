"""
Runner technical invalidation exit + runner profit floor (spec 2026-10-27).
Synthetic 1m bars only. RSI is stubbed out except in the momentum test so
each test isolates the signal it names.
"""
import os
import sys
import threading
from datetime import datetime, timedelta
from unittest.mock import MagicMock

import pytest
import pytz

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from services.strategy import orb_engine as oe  # noqa: E402
from services.strategy import runner_exit as rx_mod  # noqa: E402
from services.strategy.exit_manager import ExitManager  # noqa: E402
from services.strategy.profiles import get_profile  # noqa: E402
from services.strategy.runner_exit import RunnerInvalidation  # noqa: E402

ET = pytz.timezone("America/New_York")
T0 = ET.localize(datetime(2026, 10, 27, 9, 45))

# Uptrend: swing low 100.10 at i=5 (bar low 100.05), swing high 101.00 at i=9
# (bar high 101.05), both confirmed by bar 12.
SEED = [100.0, 100.2, 100.4, 100.6, 100.3, 100.1, 100.3, 100.5, 100.7, 101.0, 100.8, 100.7, 100.75]
SWING_LOW, SWING_HIGH = 100.05, 101.05


def bar(close, i=0, t0=T0):
    return {"ts": t0 + timedelta(minutes=i), "open": close, "high": close + 0.05,
            "low": close - 0.05, "close": close}


def seeded(direction="CALL", orh=99.0, orl=98.0, **kw):
    rx = RunnerInvalidation(direction, orh, orl, **kw)
    rx.seed([bar(c, i) for i, c in enumerate(SEED)])
    rx.arm()
    return rx


@pytest.fixture(autouse=True)
def no_rsi(monkeypatch, request):
    if "momentum" not in request.node.name:
        monkeypatch.setattr(rx_mod, "rsi_wilder", lambda closes, period=14: None)


# ── RunnerInvalidation (pure) ────────────────────────────────────────────────

def test_structure_break_alone_holds():
    rx = seeded()
    assert rx.on_bar(bar(99.97, 13), zones=[{"low": 99.0, "high": 99.2}]) is None
    assert rx.structure_break and not rx.level_loss
    assert rx.prior_extreme == pytest.approx(SWING_HIGH)


def test_buffer_filters_a_wick_close():
    rx = seeded()
    # 100.02 is below the 100.05 swing low but within the 0.05% buffer (99.99).
    assert rx.on_bar(bar(100.02, 13)) is None and not rx.structure_break


def test_structure_plus_level_loss_fires():
    rx = seeded()
    fired = rx.on_bar(bar(99.9, 13), zones=[{"low": 100.0, "high": 100.2}])
    assert fired["trigger"] == "confluence" and fired["level_source"] == "zone"
    assert fired["signals"]["structure_break"] and fired["signals"]["level_loss"]


def test_vwap_only_when_no_zone_on_that_side():
    rx = seeded()
    # Only a zone ABOVE price → no support zone → VWAP 100.0 is the level.
    fired = rx.on_bar(bar(99.9, 13), zones=[{"low": 101.5, "high": 101.7}], vwap=100.0)
    assert fired and fired["level_source"] == "vwap"


def test_orh_loss_alone_fires():
    rx = seeded(orh=99.5)
    fired = rx.on_bar(bar(99.4, 13))
    assert fired["trigger"] == "orb_failed" and fired["level"] == 99.5


def test_latched_across_bounce_then_lower_high_fires():
    rx = seeded()
    assert rx.on_bar(bar(99.97, 13)) is None           # structure break
    assert rx.on_bar(bar(100.6, 14)) is None           # bounce — still below 101.05, latch holds
    assert rx.structure_break
    fired = rx.on_bar(bar(100.4, 15))                  # rolls over → lower high
    assert fired and fired["signals"]["lower_high"]


def test_new_swing_high_resets_latches():
    rx = seeded()
    rx.on_bar(bar(99.97, 13))
    assert rx.structure_break
    assert rx.on_bar(bar(101.2, 14)) is None           # close above the prior swing high
    assert not any(rx.signals().values())


def test_put_mirror():
    # Mirror of SEED around 100: swing high close 99.9 (bar high 99.95) is
    # the PUT structure level; resistance zone 99.9–100.0 is the level.
    rx = RunnerInvalidation("PUT", 103.0, 101.0)
    rx.seed([bar(200 - c, i) for i, c in enumerate(SEED)])
    rx.arm()
    assert rx.on_bar(bar(99.97, 13)) is None            # inside the buffer
    fired = rx.on_bar(bar(100.1, 14), zones=[{"low": 99.9, "high": 100.0}])
    assert fired and fired["trigger"] == "confluence" and fired["signals"]["level_loss"]


def test_momentum_cooling_counts_as_second_signal(monkeypatch):
    seq = {"n": 0}

    def fake_rsi(closes, period=14):
        seq["n"] += 1
        return 55.0 if seq["n"] % 2 == 1 else 65.0      # now=55, prev=65 → crossed below 60
    monkeypatch.setattr(rx_mod, "rsi_wilder", fake_rsi)
    rx = seeded()
    fired = rx.on_bar(bar(99.97, 13))
    assert fired and fired["signals"]["momentum_cooling"] and not fired["signals"]["level_loss"]


def test_five_minute_bars():
    rx = RunnerInvalidation("CALL", 99.0, 98.0, bar="5m")
    t0 = ET.localize(datetime(2026, 10, 27, 9, 30))
    closed = [rx._push_1m(bar(100 + i * 0.01, i, t0)) for i in range(10)]
    assert [c is not None for c in closed] == [False] * 4 + [True] + [False] * 4 + [True]
    assert closed[4]["close"] == pytest.approx(100.04) and closed[4]["ts"] == t0


def test_not_armed_before_tp1():
    rx = RunnerInvalidation("CALL", 99.5, 98.0)
    rx.seed([bar(c, i) for i, c in enumerate(SEED)])
    assert rx.on_bar(bar(99.4, 13)) is None and rx.fired is None


# ── ExitManager integration ──────────────────────────────────────────────────

def _em(qty=4, **over):
    p = get_profile("TREND_RIDER", {"runner_exit_enabled": True, **over})
    em = ExitManager(1.00, qty, {"orh": 99.0, "orl": 98.0}, "CALL", "15:58", p, is_zero_dte=False)
    em.seed_runner_bars([bar(c, i) for i, c in enumerate(SEED)])
    return em


def _hit_tp1(em, price=1.40):
    em.evaluate(price)
    a = em.evaluate(price)
    assert a["reason"] == "TP1"
    em.update_qty(a["qty"])
    return a


def test_fires_close_all_on_last_contract():
    em = _em()
    _hit_tp1(em)
    em.update_qty(em.qty_remaining - 1)                 # last runner only
    em.on_runner_bar(bar(99.9, 13), zones=[{"low": 100.0, "high": 100.2}])
    a = em.evaluate(1.35)
    assert (a["type"], a["qty"], a["reason"]) == ("CLOSE_ALL", 1, "RUNNER_INVALIDATION")


def test_inert_before_tp1():
    em = _em()
    em.on_runner_bar(bar(99.9, 13), zones=[{"low": 100.0, "high": 100.2}])
    assert em.evaluate(1.05)["type"] == "HOLD"
    assert em._runner_exit.fired is None and not em._runner_exit.armed


def test_off_by_default():
    em = ExitManager(1.00, 4, {"orh": 99.0, "orl": 98.0}, "CALL", "15:58",
                     get_profile("TREND_RIDER"), is_zero_dte=False)
    assert em._runner_exit is None and em.to_dict()["runner_exit"] is None


def test_breakeven_stop_still_wins():
    em = _em(be_grace_seconds=0)
    _hit_tp1(em)
    em.on_runner_bar(bar(99.9, 13), zones=[{"low": 100.0, "high": 100.2}])
    assert em.evaluate(0.95)["reason"] == "SL_CONFIRMING"   # TREND_RIDER sl_confirm_ticks 2
    a = em.evaluate(0.95)
    assert (a["type"], a["reason"]) == ("CLOSE_ALL", "BREAKEVEN_STOP")


def test_trail_confirm_does_not_delay_a_fired_exit():
    em = _em(runner_mode="trail", runner_trail_pct=0.20)
    _hit_tp1(em)                                        # 2 left, trail floor 1.40 × 0.8 = 1.12
    assert em.evaluate(1.10)["reason"] == "RUNNER_TRAIL_CONFIRMING"
    em.on_runner_bar(bar(99.9, 13), zones=[{"low": 100.0, "high": 100.2}])
    a = em.evaluate(1.10)                               # trail breached, would be confirming
    assert (a["type"], a["qty"], a["reason"]) == ("CLOSE_ALL", 2, "RUNNER_INVALIDATION")


def test_trail_and_cascade_still_preserve_one():
    em = ExitManager(1.00, 4, {"orh": 99.0, "orl": 98.0}, "CALL", "15:58",
                     get_profile("TREND_RIDER", {"runner_mode": "trail", "runner_trail_pct": 0.20,
                                                 "runner_trail_confirm_seconds": 0}), is_zero_dte=False)
    _hit_tp1(em)
    em.update_qty(em.qty_remaining - 1)
    em._cascade_down_ticks = 99
    assert em.evaluate(1.05)["type"] == "HOLD"          # below trail, cascade loaded — last one kept


# ── Runner profit floor ──────────────────────────────────────────────────────

def test_floor_moves_stop_above_entry():
    em = _em(runner_floor_pct=0.2)
    _hit_tp1(em, 1.40)
    assert em.hard_stop == pytest.approx(1.20) and em.be_stop_active


def test_floor_capped_at_arming_price():
    em = _em(runner_floor_pct=0.8)                      # +80% floor, TP1 fills at +40%
    _hit_tp1(em, 1.40)
    assert em.hard_stop == pytest.approx(1.40)


def test_no_floor_is_breakeven():
    em = _em()
    _hit_tp1(em)
    assert em.hard_stop == pytest.approx(1.00)


def test_floor_breach_uses_grace_then_closes_all():
    em = _em(runner_floor_pct=0.2, be_grace_seconds=60)
    _hit_tp1(em)
    assert em.evaluate(1.15)["reason"] == "SL_CONFIRMING"   # TREND_RIDER sl_confirm_ticks 2
    assert em.evaluate(1.15)["reason"] == "BE_GRACE"
    em._be_grace_start -= timedelta(seconds=61)
    a = em.evaluate(1.15)
    assert (a["type"], a["reason"]) == ("CLOSE_ALL", "RUNNER_FLOOR_STOP")


def test_floor_guard_bypasses_grace():
    em = _em(runner_floor_pct=0.2, be_grace_seconds=60)
    _hit_tp1(em)
    em.evaluate(0.65)
    a = em.evaluate(0.65)                               # ≤ 0.70 pre-TP1 stop → immediate
    assert (a["type"], a["reason"]) == ("CLOSE_ALL", "RUNNER_FLOOR_STOP")


# ── Wiring ───────────────────────────────────────────────────────────────────

def test_protective_path_and_labels():
    from services.strategy import notifier, review_generator
    assert "RUNNER_INVALIDATION" not in oe.PRICE_SEEKING_REASONS
    assert "RUNNER_FLOOR_STOP" not in oe.PRICE_SEEKING_REASONS
    src = open(notifier.__file__).read() + open(review_generator.__file__).read()
    assert src.count("RUNNER_INVALIDATION") >= 2 and src.count("RUNNER_FLOOR_STOP") >= 2


def test_override_keys_allowed():
    p = get_profile("TREND_RIDER", {"runner_exit_enabled": True, "runner_exit_buffer_pct": 0.1,
                                    "runner_exit_bar": "5m", "runner_floor_pct": 0.5})
    assert (p["runner_exit_enabled"], p["runner_exit_buffer_pct"], p["runner_exit_bar"],
            p["runner_floor_pct"]) == (True, 0.1, "5m", 0.5)


def _engine(profile_key="TREND_RIDER"):
    eng = oe.ORBEngine.__new__(oe.ORBEngine)
    eng.config = {"ticker": "SPY", "active": True}
    eng.ticker, eng.profile_key, eng.profile = "SPY", profile_key, get_profile(profile_key)
    eng.strategy_id, eng.strategy_name, eng.paper = "s1", "SPY TR", True
    eng.bypass_breakout_window = True
    eng._tick_lock = threading.Lock()
    eng.debug, eng.logger, eng.notifier, eng._hub = MagicMock(), MagicMock(), MagicMock(), MagicMock()
    eng._reset_session_state()
    return eng


class _Bar:
    def __init__(self, close, i, t0=None):
        t0 = t0 or ET.localize(datetime.now(ET).replace(hour=9, minute=45, second=0, microsecond=0,
                                                         tzinfo=None))
        self.ticker, self.ts, self.open, self.high, self.low = "SPY", t0 + timedelta(minutes=i), close, close + 0.05, close - 0.05
        self.close, self.volume = close, 1000


def test_engine_seeds_from_hub_and_fires():
    eng = _engine()
    hist = [_Bar(c, i) for i, c in enumerate(SEED)]
    cur = _Bar(99.9, 13)
    eng._hub.get_recent_bars.return_value = hist + [cur]
    eng._hub.get_status.return_value = None
    eng._runner_zone_cache = (oe.time.time(), [{"low": 100.0, "high": 100.2}])
    eng.trade_taken, eng.exit_manager = True, _em_unseeded()
    _hit_tp1(eng.exit_manager)
    eng._feed_runner_exit(cur)
    assert eng.exit_manager._runner_exit.seeded
    assert eng.exit_manager._runner_exit.fired["trigger"] == "confluence"


def test_engine_reversal_disables_orb_override():
    eng = _engine("REVERSAL")
    eng._hub.get_recent_bars.return_value = []
    eng.trade_taken, eng.exit_manager = True, _em_unseeded()
    eng._feed_runner_exit(_Bar(99.0, 0))
    assert eng.exit_manager._runner_exit.orb_override is False


def _em_unseeded():
    p = get_profile("TREND_RIDER", {"runner_exit_enabled": True})
    return ExitManager(1.00, 4, {"orh": 99.0, "orl": 98.0}, "CALL", "15:58", p, is_zero_dte=False)
