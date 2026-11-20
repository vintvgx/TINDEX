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
from datetime import date, datetime, timedelta
from types import SimpleNamespace
from unittest import mock
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


def test_mode_latches_after_profitable_exit():
    # -$300 trips the soft cap; a +$100 winner pulls the running total
    # back to -$200, but the mode stays CONFIRMATION — a winning re-entry
    # must not loosen the requirements (CodeRabbit PR #126).
    account_risk.record_pnl(True, -300.0)
    assert account_risk.mode(True) == account_risk.CONFIRMATION
    account_risk.record_pnl(True, 100.0)
    assert account_risk.realized_pnl(True) == -200.0
    assert account_risk.mode(True) == account_risk.CONFIRMATION
    # A further -$250 loss trips the hard cap; a +$100 winner does not
    # release the halt.
    account_risk.record_pnl(True, -250.0)
    assert account_risk.mode(True) == account_risk.HALTED
    account_risk.record_pnl(True, 100.0)
    assert account_risk.realized_pnl(True) == -350.0
    assert account_risk.mode(True) == account_risk.HALTED


def test_mode_latch_resets_on_date_change():
    day1, day2 = date(2026, 11, 19), date(2026, 11, 20)
    account_risk.record_pnl(True, -300.0, today=day1)
    assert account_risk.mode(True, today=day1) == account_risk.CONFIRMATION
    # Next session: fresh record — both the day P&L and the latch reset.
    assert account_risk.mode(True, today=day2) == account_risk.NORMAL
    assert account_risk.realized_pnl(True, today=day2) == 0.0


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


class _SyncExecutor:
    """Synchronous stand-in for _GATE_EXECUTOR (runs the gate inline)."""

    def submit(self, fn, *a, **k):
        class _F:
            def result(self, timeout=None):
                return fn(*a, **k)
        return _F()


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
    monkeypatch.setattr(oe, "_GATE_EXECUTOR", _SyncExecutor())

    eng._check_technicals_gate("CALL", 765.0, [], mode="composite")
    assert seen["min_composite"] is None and seen["min_hold_bars"] == 0

    account_risk.record_pnl(True, -300.0)
    eng._check_technicals_gate("CALL", 765.0, [], mode="composite")
    assert seen["min_composite"] == 10 and seen["min_hold_bars"] == 10


def test_gate_forces_composite_mode_in_confirmation(monkeypatch):
    # A daily-mode gate ignores min_composite/min_hold_bars, so in
    # confirmation mode the evaluation is forced to composite mode —
    # the +10 / 10-close bar holds whatever the strategy configured
    # (CodeRabbit PR #126).
    eng = _engine()
    seen = {}

    def fake_gate(*a, **k):
        seen.update(k)
        return {"passed": True, "needs_confirm": False, "mode": "composite",
                "summary": "ok", "results": []}
    monkeypatch.setattr(ecs, "evaluate_gate", fake_gate)
    monkeypatch.setattr(oe, "_GATE_EXECUTOR", _SyncExecutor())

    account_risk.record_pnl(True, -300.0)  # CONFIRMATION
    eng._check_technicals_gate("CALL", 765.0, [], mode="daily")
    assert seen["mode"] == "composite"
    assert seen["min_composite"] == 10 and seen["min_hold_bars"] == 10


def _disabled_gate_engine():
    eng = _engine()
    eng.config["technicals_gate"] = {"enabled": False}
    return eng


def test_disabled_gate_confirmation_blocks_entry(monkeypatch):
    # The technicals gate is disabled, so it never runs — but in
    # confirmation mode _enter_trade enforces the +10 bar itself.
    # A +7 composite must not reach contract selection.
    eng = _disabled_gate_engine()
    select = MagicMock(return_value=None)
    monkeypatch.setattr(oe, "select_contract", select)

    def fake_gate(*a, **k):
        return {"passed": False, "needs_confirm": False, "mode": "composite",
                "summary": "composite +7/14 STRONG — confirmation mode needs ≥+10",
                "results": []}
    monkeypatch.setattr(ecs, "evaluate_gate", fake_gate)
    monkeypatch.setattr(oe, "_GATE_EXECUTOR", _SyncExecutor())

    account_risk.record_pnl(True, -300.0)  # CONFIRMATION
    eng._enter_trade("CALL", 765.0)
    select.assert_not_called()
    emitted = " ".join(str(c) for c in eng.debug.emit.call_args_list)
    assert "confirmation mode needs" in emitted


def test_disabled_gate_confirmation_passes_at_plus11(monkeypatch):
    eng = _disabled_gate_engine()
    select = MagicMock(return_value=None)
    monkeypatch.setattr(oe, "select_contract", select)

    def fake_gate(*a, **k):
        return {"passed": True, "needs_confirm": False, "mode": "composite",
                "summary": "composite +11/14 STRONG",
                "results": []}
    monkeypatch.setattr(ecs, "evaluate_gate", fake_gate)
    monkeypatch.setattr(oe, "_GATE_EXECUTOR", _SyncExecutor())

    account_risk.record_pnl(True, -300.0)  # CONFIRMATION
    eng._enter_trade("CALL", 765.0)
    select.assert_called_once()


def test_pending_approval_blocked_when_account_halted():
    # Another strategy trips the hard cap while a confirmation is
    # pending: approving it must NOT submit a BUY (CodeRabbit PR #126).
    # _execute_entry re-checks the account mode immediately before the
    # order; _enter_pending resolves the row EXPIRED (no trade was taken)
    # and the error surfaces to the approver.
    eng = _engine()
    eng.trading_client = MagicMock()
    pc = {
        "id": "pc1", "direction": "CALL", "contract_symbol": "SPY261120C00765000",
        "trigger_price": 765.0,
        "_contract": {"symbol": "SPY261120C00765000", "ask": 1.0, "bid": 0.95, "delta": 0.4},
        "_qty": 4, "_effective_profile": get_profile("TREND_RIDER"),
        "_gate_snapshot": None,
        "expires_at": (datetime.now(oe.ET) + timedelta(minutes=5)).isoformat(),
    }
    eng._pending_confirmation = pc
    account_risk.record_pnl(True, -450.0)  # HALTED
    with pytest.raises(RuntimeError, match="account daily loss limit"):
        eng.approve_pending_entry("pc1")
    eng.trading_client.submit_order.assert_not_called()
    assert eng._pending_confirmation is None  # resolved, not lingering
    status = eng.logger.update_pending_confirmation.call_args[0][1]["status"]
    assert status == "EXPIRED"


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


class _Bar:
    def __init__(self, ts, close):
        self.ts = ts
        self.close = close


def _muse_1m_bars(today_5m):
    """75 1m bars (09:30 -> 10:44 ET) whose 5-min bucket-end closes are
    today_5m — the shape _muse_intraday_score resamples."""
    today = datetime.now(oe.ET).date()
    start = oe.ET.localize(datetime(today.year, today.month, today.day, 9, 30))
    bars = []
    for i in range(len(today_5m) * 5):
        ts = start + timedelta(minutes=i)
        bars.append(_Bar(ts, today_5m[min(i // 5, len(today_5m) - 1)]))
    return bars


# Prior sessions: 312 5-min closes declining 762 -> 750 (same shape as
# test_muse_reversal's score-6 series).
_MUSE_PRIOR = [762.0 - (12.0 * i / 311) for i in range(312)]
# Score 6: steady decline, all three intraday rows +2.
_MUSE_TODAY_6 = [749.50 - (1.30 * i / 14) for i in range(15)]
# Score 5: an early bounce (+0.70 x3) lifts the intraday RSI to +1 while
# the resumed decline keeps MACD +2 and trend +2.
_MUSE_TODAY_5 = [749.38, 749.26, 749.96, 750.66, 751.36, 751.24, 751.12,
                 751.0, 750.88, 750.76, 750.64, 750.52, 750.4, 750.28, 750.16]


def _armed_muse_engine_real(today_5m):
    """MUSE engine armed for a PUT, fed by REAL hub bars — the intraday
    score comes from _muse_intraday_score, not a stub. Returns
    (engine, entered, price). Only the prior-session data source is
    mocked (its per-day cache); the scorer itself runs for real."""
    eng = _muse_engine()
    eng.orh, eng.orl = ORH, ORL
    eng._live_session_vwap = lambda: 760.0
    eng._hub.get_recent_bars = lambda ticker: _muse_1m_bars(today_5m)
    eng._muse_armed, eng._muse_direction = True, "PUT"
    price = today_5m[-1]
    tracker = VwapSideTracker("PUT", 3)
    for c in (price + 0.4, price + 0.2, price + 0.1):
        tracker.feed(c, 760.0)
    assert tracker.complete
    eng._muse_hold_tracker = tracker
    entered = []
    eng._enter_trade = lambda d, p, gate_result=None: entered.append((d, p, gate_result))
    return eng, entered, price


def test_muse_confirmation_boundary_uses_real_score():
    # 6 is the scorer's max (three terms of at most +2) — the old
    # confirmation bar of 7 was unreachable, so no MUSE entry could pass
    # after the soft cap (CodeRabbit PR #126). The bar is now 6: a
    # perfect intraday score passes, 5 does not.
    for today_5m, want_score in ((_MUSE_TODAY_6, 6), (_MUSE_TODAY_5, 5)):
        eng, entered, price = _armed_muse_engine_real(today_5m)
        bar = SimpleNamespace(close=price, open=price, high=price + 0.5,
                              low=price - 0.5, ts=None)
        with mock.patch("services.entry_check_service._prior_closes_5m",
                        return_value=list(_MUSE_PRIOR)):
            score, detail = eng._muse_intraday_score("PUT", price)
            assert score == want_score, (
                f"test setup: expected {want_score}, got {score} ({detail})")
            # NORMAL mode (bar 5): both scores enter.
            eng._muse_on_bar(bar)
        assert len(entered) == 1, f"score {want_score} should enter in NORMAL mode"
    # CONFIRMATION mode (bar 6): 6 enters, 5 does not.
    account_risk.record_pnl(True, -300.0)
    for today_5m, should_enter in ((_MUSE_TODAY_6, True), (_MUSE_TODAY_5, False)):
        eng, entered, price = _armed_muse_engine_real(today_5m)
        bar = SimpleNamespace(close=price, open=price, high=price + 0.5,
                              low=price - 0.5, ts=None)
        with mock.patch("services.entry_check_service._prior_closes_5m",
                        return_value=list(_MUSE_PRIOR)):
            eng._muse_on_bar(bar)
        assert bool(entered) == should_enter, (
            f"score {6 if should_enter else 5} in CONFIRMATION mode: "
            f"expected {'enter' if should_enter else 'no entry'}, got {entered}")
