"""
Account-level daily loss caps (0.8.05, 2026-11-19).

One day P&L shared by every strategy engine in the same paper/live
account: -$250 soft cap -> confirmation mode (+10 composite + 10
consecutive 1-min closes beyond the level; MUSE 10 VWAP-hold bars +
technicals >= 7), -$400 hard cap -> no new entries from any strategy.
"""
import os
import sys
import threading
from datetime import date, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import services.composite_technicals as ct  # noqa: E402
import services.entry_check_service as ecs  # noqa: E402
from services.strategy import account_risk  # noqa: E402
from services.strategy import orb_engine as oe  # noqa: E402
from services.strategy.muse_reversal import VwapSideTracker  # noqa: E402
from services.strategy.orb_engine import ORBEngine  # noqa: E402
from services.strategy.profiles import get_profile  # noqa: E402

ORH, ORL = 764.02, 758.00


@pytest.fixture(autouse=True)
def clean_account_state():
    account_risk.reset_for_tests()
    yield
    account_risk.reset_for_tests()


# ── account_risk ─────────────────────────────────────────────────────────────

def test_mode_boundaries():
    assert account_risk.mode_for_pnl(0.0) == account_risk.NORMAL
    assert account_risk.mode_for_pnl(-249.99) == account_risk.NORMAL
    assert account_risk.mode_for_pnl(-250.0) == account_risk.CONFIRMATION
    assert account_risk.mode_for_pnl(-399.99) == account_risk.CONFIRMATION
    assert account_risk.mode_for_pnl(-400.0) == account_risk.HALTED
    assert account_risk.mode_for_pnl(-1000.0) == account_risk.HALTED


def test_record_pnl_accumulates_and_returns_mode():
    assert account_risk.record_pnl(True, -100.0) == account_risk.NORMAL
    assert account_risk.record_pnl(True, -200.0) == account_risk.CONFIRMATION
    assert account_risk.realized_pnl(True) == -300.0
    assert account_risk.mode(True) == account_risk.CONFIRMATION


def test_date_change_resets_day_pnl():
    day1, day2 = date(2026, 11, 19), date(2026, 11, 20)
    account_risk.record_pnl(True, -500.0, today=day1)
    assert account_risk.mode(True, today=day1) == account_risk.HALTED
    assert account_risk.mode(True, today=day2) == account_risk.NORMAL
    assert account_risk.realized_pnl(True, today=day2) == 0.0


def test_paper_live_books_are_isolated():
    account_risk.record_pnl(True, -500.0)
    assert account_risk.mode(True) == account_risk.HALTED
    assert account_risk.mode(False) == account_risk.NORMAL
    assert account_risk.realized_pnl(False) == 0.0


# ── composite gate in confirmation mode ──────────────────────────────────────

@pytest.fixture
def market(monkeypatch):
    monkeypatch.setattr(ecs, "_daily_closes", lambda t: [100.0] * 30)
    monkeypatch.setattr(ecs, "_closes_5m", lambda t, c=None: [100.0] * 50)
    monkeypatch.setattr(ecs, "_intraday_bars", lambda t: None)


def _fake_composite(monkeypatch, tier, total):
    def fake(*a, **k):
        return {"direction": "CALL", "total": total, "max": 14, "tier": tier,
                "turning": [], "missing": [],
                "indicators": [{"key": "vwap", "label": "VWAP", "score": total,
                                "value": "Above", "detail": "", "available": True}]}
    monkeypatch.setattr(ct, "compute_composite", fake)


def test_confirmation_blocks_plus7_passes_plus11(market, monkeypatch):
    _fake_composite(monkeypatch, "STRONG", 7)
    gate = ecs.evaluate_gate("SPY", "CALL", [], 770.0, vwap=769.0, orh=769.0, orl=760.0,
                             mode="composite", min_composite=10)
    assert not gate["passed"] and not gate["needs_confirm"]
    _fake_composite(monkeypatch, "STRONG", 11)
    gate = ecs.evaluate_gate("SPY", "CALL", [], 770.0, vwap=769.0, orh=769.0, orl=760.0,
                             mode="composite", min_composite=10)
    assert gate["passed"] and not gate["needs_confirm"]


def test_confirmation_has_no_moderate_path(market, monkeypatch):
    _fake_composite(monkeypatch, "MODERATE", 5)
    normal = ecs.evaluate_gate("SPY", "CALL", [], 770.0, vwap=769.0, orh=769.0, orl=760.0,
                               mode="composite")
    assert normal["passed"] and normal["needs_confirm"]
    confirm = ecs.evaluate_gate("SPY", "CALL", [], 770.0, vwap=769.0, orh=769.0, orl=760.0,
                                mode="composite", min_composite=10)
    assert not confirm["passed"] and not confirm["needs_confirm"]


def test_confirmation_hold_needs_ten_closes_beyond_level(market, monkeypatch):
    _fake_composite(monkeypatch, "STRONG", 11)
    base = dict(vwap=757.0, orh=ORH, orl=ORL, mode="composite",
                min_composite=10, min_hold_bars=10)
    # PUT: ten consecutive 1-min closes below ORL.
    ten_below = [(i, 757.0 - i * 0.1) for i in range(10)]
    ok = ecs.evaluate_gate("SPY", "PUT", [], 757.0, intraday_closes=ten_below, **base)
    assert ok["passed"]
    # Nine closes is not a hold.
    nine = ecs.evaluate_gate("SPY", "PUT", [], 757.0, intraday_closes=ten_below[:9], **base)
    assert not nine["passed"]
    # One close back above ORL breaks the hold.
    broken = ten_below[:5] + [(5, 759.0)] + ten_below[6:]
    bad = ecs.evaluate_gate("SPY", "PUT", [], 757.0, intraday_closes=broken, **base)
    assert not bad["passed"]
    # No bar data at all fails closed.
    none = ecs.evaluate_gate("SPY", "PUT", [], 757.0, intraday_closes=None, **base)
    assert not none["passed"]


# ── engine wiring ────────────────────────────────────────────────────────────

def _engine(paper=True):
    eng = ORBEngine.__new__(ORBEngine)
    eng.config = {"ticker": "SPY", "active": True, "id": "s1", "strategy_name": "SPY TR",
                  "technicals_gate": {"enabled": True, "required": ["trend", "rsi", "vwap", "orb"],
                                      "mode": "composite", "watch": True}}
    eng.ticker, eng.profile_key, eng.profile = "SPY", "TREND_RIDER", get_profile("TREND_RIDER")
    eng.strategy_id, eng.strategy_name, eng.paper = "s1", "SPY TR", paper
    eng.bypass_breakout_window, eng.confirm_entry = True, False
    eng.capital_limit = None
    eng._tick_lock = threading.Lock()
    eng.debug, eng.logger, eng.notifier, eng._hub = MagicMock(), MagicMock(), MagicMock(), MagicMock()
    eng.option_client, eng.stream_manager = None, None
    eng.limit_orders = MagicMock()
    eng._reset_session_state()
    eng.orh, eng.orl = ORH, ORL
    eng._find_ticker_conflict = lambda d: None
    return eng


def test_halted_account_blocks_entry_before_contract_selection(monkeypatch):
    eng = _engine()
    select = MagicMock(return_value=None)
    monkeypatch.setattr(oe, "select_contract", select)
    account_risk.record_pnl(True, -450.0)
    eng._enter_trade("CALL", 765.0)
    select.assert_not_called()
    emitted = " ".join(str(c) for c in eng.debug.emit.call_args_list)
    assert "account daily loss limit" in emitted


def test_gate_forwards_confirmation_bar(monkeypatch):
    eng = _engine()
    seen = {}

    def fake_gate(*a, **k):
        seen.update(k)
        return {"passed": True, "needs_confirm": False, "mode": "composite",
                "summary": "ok", "results": []}
    monkeypatch.setattr(ecs, "evaluate_gate", fake_gate)

    class _Sync:
        def submit(self, fn, *a, **k):
            class _F:
                def result(self, timeout=None):
                    return fn(*a, **k)
            return _F()
    monkeypatch.setattr(oe, "_GATE_EXECUTOR", _Sync())

    eng._check_technicals_gate("CALL", 765.0, [], mode="composite")
    assert seen["min_composite"] is None and seen["min_hold_bars"] == 0

    account_risk.record_pnl(True, -300.0)
    eng._check_technicals_gate("CALL", 765.0, [], mode="composite")
    assert seen["min_composite"] == 10 and seen["min_hold_bars"] == 10


def _muse_engine():
    eng = ORBEngine.__new__(ORBEngine)
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


def _armed_muse_engine(score):
    eng = _muse_engine()
    eng._muse_armed, eng._muse_direction = True, "PUT"
    tracker = VwapSideTracker("PUT", 3)
    for c in (759.5, 759.0, 758.5):
        tracker.feed(c, 760.0)
    assert tracker.complete
    eng._muse_hold_tracker = tracker
    eng._live_session_vwap = lambda: 760.0
    eng._muse_intraday_score = lambda d, p: (score, "test")
    entered = []
    eng._enter_trade = lambda d, p, gate_result=None: entered.append((d, p, gate_result))
    return eng, entered


def test_muse_confirmation_raises_technicals_bar():
    # Score 6 enters in NORMAL mode (bar is 5).
    eng, entered = _armed_muse_engine(6)
    eng._muse_on_bar(SimpleNamespace(close=759.0, open=759.0, high=759.5, low=758.5, ts=None))
    assert len(entered) == 1
    # Same score does NOT enter in CONFIRMATION mode (bar is 7).
    account_risk.record_pnl(True, -300.0)
    eng, entered = _armed_muse_engine(6)
    eng._muse_on_bar(SimpleNamespace(close=759.0, open=759.0, high=759.5, low=758.5, ts=None))
    assert entered == []
    # Score 7 enters in CONFIRMATION mode.
    eng, entered = _armed_muse_engine(7)
    eng._muse_on_bar(SimpleNamespace(close=759.0, open=759.0, high=759.5, low=758.5, ts=None))
    assert len(entered) == 1
