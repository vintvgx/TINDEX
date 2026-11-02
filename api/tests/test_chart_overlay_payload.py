"""
Chart trade overlay (brief v2) — display-only fields on the live push and the
simulation payload. Nothing here may change an exit decision.
"""
import json
import os
import sys
import threading
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from services.strategy import orb_engine as oe  # noqa: E402
from services.strategy import simulation as sm  # noqa: E402
from services.strategy.exit_manager import ExitManager  # noqa: E402
from services.strategy.profiles import get_profile  # noqa: E402


def _engine(qty=4):
    eng = oe.ORBEngine.__new__(oe.ORBEngine)
    eng.config = {"ticker": "SPY", "active": True}
    eng.ticker, eng.profile_key, eng.profile = "SPY", "TREND_RIDER", get_profile("TREND_RIDER")
    eng.strategy_id, eng.strategy_name, eng.paper = "s1", "SPY Rider", True
    eng._tick_lock = threading.Lock()
    eng.debug, eng.logger, eng.notifier, eng._hub = MagicMock(), MagicMock(), MagicMock(), MagicMock()
    eng.stream_manager = None
    eng._reset_session_state()
    eng.trade_taken, eng.contract_symbol = True, "SPY261030P00758000"
    eng.exit_manager = ExitManager(1.19, qty, {"orh": 761.43, "orl": 759.48}, "PUT", "15:58",
                                   get_profile("TREND_RIDER"), is_zero_dte=False)
    eng._current_option_price = 1.40
    eng._last_underlying_price = 758.40
    eng._stream_is_live = lambda: True
    eng._ladder_reserved = lambda: 0
    eng._maybe_refresh_overlay_delta = lambda force=False: None   # no network in tests
    return eng


def test_live_payload_carries_overlay_fields():
    eng = _engine()
    eng._overlay_realized_pnl = 71.4
    eng._overlay_delta = -0.42
    p = json.loads(eng._build_price_payload())
    assert p["pnl"] == pytest.approx(84.0)             # unchanged: unrealized on remaining
    assert p["realized_pnl"] == pytest.approx(71.4)
    assert p["delta"] == -0.42 and p["underlying_price"] == 758.40
    assert p["be_stop_active"] is False and p["be_level"] == pytest.approx(1.19)
    assert p["qty_entered"] == 4 and p["strategy_name"] == "SPY Rider"
    assert p["quote_age_s"] is not None


def test_finalize_exit_banks_the_leg_for_display():
    eng = _engine()
    eng.active_trade_id = "t1"
    eng._finalize_exit({"type": "CLOSE_PARTIAL", "qty": 2, "reason": "TP1"}, eng.contract_symbol, "PUT",
                       qty_closed=2, closing_all=False, current_price=758.05,
                       exit_premium=1.547, entry_premium=1.19)
    assert eng._overlay_realized_pnl == pytest.approx(71.4)
    p = json.loads(eng._build_price_payload())
    assert p["realized_pnl"] == pytest.approx(71.4)


def test_daily_reset_keeps_open_trade_realized():
    eng = _engine()
    eng._overlay_realized_pnl = 71.4
    eng._reset_session_state()
    assert eng._overlay_realized_pnl == pytest.approx(71.4)


@pytest.fixture(autouse=True)
def _no_sim_sleep(monkeypatch):
    # The sim paces itself with time.sleep — skip the waits, restored after.
    monkeypatch.setattr(sm.time, "sleep", lambda *_: None)


def _run_sim(scenario, profile):
    eng = MagicMock()
    r = sm.SimulationRunner(eng, suppress_push=True)
    r._running = True
    out = []
    r._broadcast = lambda p: out.append(json.loads(p))
    (r._run_reversal(profile) if scenario == "reversal" else r._run_single(scenario, profile))
    return [m for m in out if m["type"] == "price_update"], [m["type"] for m in out]


@pytest.mark.parametrize("profile", ["TREND_RIDER", "THUNDER_CAT"])
def test_sim_profit_total_includes_banked_legs(profile):
    pushes, _ = _run_sim("profit", profile)
    after_tp1 = next(m for m in pushes if m["tp1_hit"])
    assert after_tp1["realized_pnl"] > 0
    assert after_tp1["qty_remaining"] < pushes[0]["qty_remaining"]
    assert after_tp1["be_stop_active"] is True


@pytest.mark.parametrize("profile", ["TREND_RIDER", "THUNDER_CAT"])
def test_sim_loss_actually_stops_out_and_pushes_the_close(profile):
    pushes, kinds = _run_sim("loss", profile)
    assert pushes[-1]["qty_remaining"] == 0
    assert pushes[-1]["realized_pnl"] < 0
    assert kinds[-1] == "sim_complete"


def test_sim_reversal_closes_call_before_put_starts():
    pushes, _ = _run_sim("reversal", "TREND_RIDER")
    call = [m for m in pushes if m.get("sim_leg") == "call"]
    put = [m for m in pushes if m.get("sim_leg") == "put"]
    assert call[-1]["qty_remaining"] == 0
    assert put and put[0]["contract"] != call[0]["contract"]


class _Greeks:
    def __init__(self, delta):
        self.delta = delta


class _Snap:
    def __init__(self, delta):
        self.greeks = _Greeks(delta) if delta is not None else None


def _wait_delta(eng, timeout=2.0):
    import time as _time
    end = _time.time() + timeout
    while _time.time() < end:
        if eng._overlay_delta is not None or not eng._overlay_delta_inflight:
            # Give the thread a beat to finish after inflight clears.
            _time.sleep(0.05)
            if eng._overlay_delta is not None:
                return
            if not eng._overlay_delta_inflight:
                return
        _time.sleep(0.02)


def test_overlay_delta_snapshot_miss_falls_back_to_chain():
    eng = _engine()
    eng._overlay_delta = None
    eng._overlay_delta_at = 0.0
    eng._overlay_delta_source = None
    # Real refresh method (the harness stubs it out).
    eng._maybe_refresh_overlay_delta = oe.ORBEngine._maybe_refresh_overlay_delta.__get__(eng, oe.ORBEngine)
    client = MagicMock()
    client.get_option_snapshot.return_value = {"SPY261030P00758000": _Snap(None)}
    client.get_option_chain.return_value = {"SPY261030P00758000": _Snap(-0.42)}
    eng.option_client = client
    eng._maybe_refresh_overlay_delta(force=True)
    _wait_delta(eng)
    assert eng._overlay_delta == pytest.approx(-0.42)
    assert eng._overlay_delta_source == "chain"


def test_overlay_delta_snapshot_hit_sets_source():
    eng = _engine()
    eng._overlay_delta = None
    eng._overlay_delta_at = 0.0
    eng._maybe_refresh_overlay_delta = oe.ORBEngine._maybe_refresh_overlay_delta.__get__(eng, oe.ORBEngine)
    client = MagicMock()
    client.get_option_snapshot.return_value = {"SPY261030P00758000": _Snap(-0.38)}
    eng.option_client = client
    eng._maybe_refresh_overlay_delta(force=True)
    _wait_delta(eng)
    assert eng._overlay_delta == pytest.approx(-0.38)
    assert eng._overlay_delta_source == "snapshot"
    client.get_option_chain.assert_not_called()


def test_overlay_delta_snapshot_throw_still_falls_back_to_chain():
    # 2026-11-02 revised fix: a snapshot THROW must not skip the chain.
    eng = _engine()
    eng._overlay_delta = None
    eng._overlay_delta_at = 0.0
    eng._overlay_delta_source = None
    eng._maybe_refresh_overlay_delta = oe.ORBEngine._maybe_refresh_overlay_delta.__get__(eng, oe.ORBEngine)
    client = MagicMock()
    client.get_option_snapshot.side_effect = RuntimeError("opra entitlement")
    client.get_option_chain.return_value = {"SPY261030P00758000": _Snap(-0.42)}
    eng.option_client = client
    eng._maybe_refresh_overlay_delta(force=True)
    _wait_delta(eng)
    assert eng._overlay_delta == pytest.approx(-0.42)
    assert eng._overlay_delta_source == "chain"


def test_overlay_delta_refresh_cadence_is_five_minutes():
    # Kareem 2026-11-02: delta changes minimally; 5 minutes, not 15 seconds.
    assert oe.OVERLAY_DELTA_REFRESH_S == 300


def test_cascade_peak_restored_from_hit_levels_after_tp2():
    # 2026-11-02 SPY RIDER shape: 4 entered, 2 left after TP2, peak wiped
    # by a restart. Restore must seed a peak floor so cascade can re-arm.
    eng = _engine(qty=4)
    em = eng.exit_manager
    em.tp1_hit = True
    em.tp2_hit = True
    em.qty_remaining = 2
    assert em._cascade_peak is None
    # _engine() uses entry 1.19, so seed with that entry premium.
    row = {"tp1_price": 1.378, "tp1_premium": 1.40, "tp2_price": 1.96, "tp2_premium": 2.10}
    peak = eng._seed_restored_cascade_peak(row, [], 1.19)
    assert peak == pytest.approx(2.10)
    assert em._cascade_peak == pytest.approx(2.10)
    # Trigger from the floored peak still sits above entry (banks profit).
    assert em.cascade_trigger_level() == pytest.approx(1.645)
    assert em.cascade_trigger_level() > 1.19


def test_cascade_peak_not_restored_when_runner_only():
    # Runner preservation: with only 1 contract left, cascade has nothing
    # to trim, so no peak is seeded (and no false re-arm).
    eng = _engine(qty=4)
    em = eng.exit_manager
    em.tp1_hit = True
    em.tp2_hit = True
    em.qty_remaining = 1
    row = {"tp1_price": 1.378, "tp2_price": 1.96}
    assert eng._seed_restored_cascade_peak(row, [], 1.19) is None
    assert em._cascade_peak is None
