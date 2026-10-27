"""
Gate block → wait-and-monitor (TODO 073d0d9f): a blocked breakout becomes a
watch, re-checked on each 1-min close, entering the first time the gate
passes. Opt-in via technicals_gate.watch — a gate without it behaves exactly
as before (constraint c8fc1694).
"""
import os
import sys
import threading
from datetime import datetime
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from services.strategy import gate_watch as gw  # noqa: E402
from services.strategy import orb_engine as oe  # noqa: E402
from services.strategy.orb_engine import ORBEngine  # noqa: E402
from services.strategy.profiles import get_profile  # noqa: E402

ET = gw.ET
ORH, ORL = 764.02, 758.00


def _at(h, m):
    """Pin gate_watch's clock to h:m ET on a Monday."""
    fixed = ET.localize(datetime(2026, 10, 26, h, m))

    class _DT(datetime):
        @classmethod
        def now(cls, tz=None):
            return fixed.astimezone(tz) if tz else fixed.replace(tzinfo=None)
    return _DT


@pytest.fixture
def clock(monkeypatch):
    def set_(h, m):
        monkeypatch.setattr(gw, "datetime", _at(h, m))
    set_(10, 40)
    return set_


@pytest.fixture(autouse=True)
def sync_executor(monkeypatch):
    monkeypatch.setattr(gw, "_WATCH_EXECUTOR", MagicMock(submit=lambda fn, *a: fn(*a)))


@pytest.fixture
def no_contract(monkeypatch):
    """select_contract → None: the entry path stops right after the gate,
    so 'select_contract was called' == 'the gate let it through'."""
    m = MagicMock(return_value=None)
    monkeypatch.setattr(oe, "select_contract", m)
    return m


def _gate(passed=False, matched=2, total=4, needs_confirm=False, mode="daily"):
    return {
        "mode": mode, "passed": passed, "needs_confirm": needs_confirm, "matched": matched, "total": total,
        "results": [{"key": "trend", "ok": passed, "skipped": False},
                    {"key": "rsi", "ok": passed or matched > 2, "skipped": False},
                    {"key": "vwap", "ok": True, "skipped": False},
                    {"key": "orb", "ok": True, "skipped": False}],
        "summary": f"{matched}/{total} technicals matched",
    }


def _engine(watch=True, profile="TREND_RIDER", bypass=True, gate_results=None):
    eng = ORBEngine.__new__(ORBEngine)
    eng.config = {"ticker": "SPY", "active": True, "id": "s1", "strategy_name": "SPY TR",
                  "technicals_gate": {"enabled": True, "required": ["trend", "rsi", "vwap", "orb"],
                                      "mode": "daily", **({"watch": True} if watch else {})}}
    eng.ticker, eng.profile_key, eng.profile = "SPY", profile, get_profile(profile)
    eng.strategy_id, eng.strategy_name, eng.paper = "s1", "SPY TR", True
    eng.bypass_breakout_window, eng.confirm_entry = bypass, False
    eng.capital_limit = None
    eng._tick_lock = threading.Lock()
    eng.debug, eng.logger, eng.notifier, eng._hub = MagicMock(), MagicMock(), MagicMock(), MagicMock()
    eng.option_client, eng.stream_manager = None, None
    eng.limit_orders = MagicMock()
    eng._reset_session_state()
    eng.orh, eng.orl = ORH, ORL
    eng._find_ticker_conflict = lambda d: None
    eng._check_technicals_gate = MagicMock(side_effect=gate_results or [(False, False, _gate())])
    return eng


def _block(eng, direction="CALL", price=764.30):
    eng._enter_trade(direction, price)


# ── block → watch ──────────────────────────────────────────────────────────────

def test_block_starts_watch_instead_of_dropping(clock, no_contract):
    eng = _engine()
    _block(eng)
    w = eng.gate_watch_public()
    assert w and w["direction"] == "CALL" and w["level"] == ORH and w["score"] == "2/4"
    assert w["failed"] == ["trend"] or set(w["failed"]) <= {"trend", "rsi"}
    assert w["expires_at"].startswith("2026-10-26T12:40")         # 10:40 + 2h (window bypassed)
    eng.logger.create_gate_watch.assert_called_once()
    eng.notifier.notify_gate_watch_started.assert_called_once()
    eng.notifier.notify_entry_blocked_technicals.assert_not_called()
    assert eng._check_technicals_gate.call_args.kwargs["notify"] is False
    no_contract.assert_not_called()


def test_gate_without_watch_key_behaves_as_before(clock, no_contract):
    eng = _engine(watch=False)
    _block(eng)
    assert eng.gate_watch_public() is None
    eng.logger.create_gate_watch.assert_not_called()
    assert eng._check_technicals_gate.call_args.kwargs["notify"] is True


def test_reversal_never_watches(clock, no_contract):
    eng = _engine(profile="REVERSAL")
    eng._reversal_entry_in_progress = True
    _block(eng)
    assert eng.gate_watch_public() is None
    eng._hub.publish_reversal_declined.assert_called_once_with("SPY", "CALL")


def test_past_breakout_window_no_watch_plain_block_push(clock, no_contract):
    eng = _engine(bypass=False)          # TREND_RIDER window ends 9:45 + limit, before 10:40
    eng.profile = {**eng.profile, "breakout_time_limit_min": 45}
    _block(eng)
    assert eng.gate_watch_public() is None
    eng.notifier.notify_entry_blocked_technicals.assert_called_once()


@pytest.mark.parametrize("hm,limit,bypass,expect,why", [
    ((10, 0), 45, False, "10:30", "breakout window closed"),
    ((10, 0), 240, False, "12:00", "2h without confirmation"),
    ((14, 30), 240, True, None, "end of day"),
])
def test_deadline_is_earliest_rule(clock, hm, limit, bypass, expect, why):
    clock(*hm)
    eng = _engine(bypass=bypass)
    eng.profile = {**eng.profile, "breakout_time_limit_min": limit, "eod_buffer_minutes": 20}
    at, reason = eng._gate_watch_deadline(gw.datetime.now(ET))
    assert reason == why
    assert f"{at:%H:%M}" == (expect or "15:38")


# ── re-check on bar close ──────────────────────────────────────────────────────

def test_confirms_on_passing_bar_and_runs_entry_once(clock, no_contract):
    eng = _engine(gate_results=[(False, False, _gate()), (True, False, _gate(passed=True, matched=4))])
    _block(eng)
    eng._on_bar_gate_watch(765.10)
    assert eng.gate_watch_public() is None
    eng.notifier.notify_gate_watch_confirmed.assert_called_once()
    assert "4/4" in eng.notifier.notify_gate_watch_confirmed.call_args.args[3]
    # gate ran twice (block + re-check) — _enter_trade did NOT run it a third time
    assert eng._check_technicals_gate.call_count == 2
    assert eng._check_technicals_gate.call_args.kwargs["quiet"] is True
    no_contract.assert_called_once()
    assert no_contract.call_args.kwargs["trigger_price"] == 765.10
    status = [c.args[1].get("status") for c in eng.logger.update_gate_watch.call_args_list]
    assert "confirmed" in status
    eng.notifier.notify_gate_watch_ended.assert_not_called()


def test_moderate_confirm_routes_to_confirm_first(clock, monkeypatch):
    eng = _engine(gate_results=[(False, False, _gate()),
                                (True, True, _gate(passed=True, matched=5, total=14, mode="composite"))])
    monkeypatch.setattr(oe, "select_contract", MagicMock(return_value={"symbol": "X", "strike": 765, "ask": 1.0}))
    seen = {}

    def stop_after_gate(direction, trigger_price, gate_result=None):
        seen["gate_result"] = gate_result
    _block(eng)
    eng._enter_trade = stop_after_gate
    eng._on_bar_gate_watch(765.10)
    assert seen["gate_result"] is True
    assert eng.notifier.notify_gate_watch_confirmed.call_args.kwargs["confirm_first"] is True


def test_failing_recheck_keeps_watching_and_tracks_score(clock, no_contract):
    eng = _engine(gate_results=[(False, False, _gate()), (False, False, _gate(matched=3)),
                                (False, False, _gate(matched=3))])
    _block(eng)
    eng._on_bar_gate_watch(765.0)
    eng._on_bar_gate_watch(765.2)
    w = eng.gate_watch_public()
    assert w and w["score"] == "3/4" and w["checks"] == 2
    no_contract.assert_not_called()


def test_recheck_skipped_while_confirmation_pending(clock, no_contract):
    eng = _engine()
    _block(eng)
    eng._pending_confirmation = {"id": "p"}
    eng._on_bar_gate_watch(765.0)
    assert eng._check_technicals_gate.call_count == 1 and eng.gate_watch_public()


# ── expiry ─────────────────────────────────────────────────────────────────────

def test_expires_when_bar_closes_back_below_orh(clock, no_contract):
    eng = _engine()
    _block(eng)
    eng._on_bar_gate_watch(763.90)
    assert eng.gate_watch_public() is None
    reason = eng.notifier.notify_gate_watch_ended.call_args.args[3]
    assert "below the ORB high $764.02" in reason
    assert eng._check_technicals_gate.call_count == 1


def test_put_expires_when_bar_closes_back_above_orl(clock, no_contract):
    eng = _engine()
    _block(eng, "PUT", 757.5)
    eng._on_bar_gate_watch(758.40)
    assert eng.gate_watch_public() is None


def test_expires_after_deadline_via_bar_and_sweep(clock, no_contract):
    eng = _engine()
    _block(eng)
    clock(12, 41)
    assert eng.expire_gate_watch_if_stale() is True
    assert eng.gate_watch_public() is None
    assert "2h" in eng.notifier.notify_gate_watch_ended.call_args.args[3]


def test_position_open_or_skip_ends_watch(clock, no_contract):
    eng = _engine()
    _block(eng)
    eng.trade_taken = True
    eng._on_bar_gate_watch(765.0)
    assert eng.gate_watch_public() is None

    eng = _engine()
    _block(eng)
    eng._skip("BREAKOUT_TIME_LIMIT_EXCEEDED")
    assert eng.gate_watch_public() is None


def test_same_side_refreshes_opposite_side_replaces(clock, no_contract):
    eng = _engine(gate_results=[(False, False, _gate())] * 3)
    _block(eng)
    first = eng.gate_watch_public()
    clock(10, 50)
    _block(eng, "CALL", 764.6)
    again = eng.gate_watch_public()
    assert again["id"] == first["id"] and again["expires_at"] == first["expires_at"]
    assert again["trigger_price"] == 764.6
    _block(eng, "PUT", 757.0)
    put = eng.gate_watch_public()
    assert put["direction"] == "PUT" and put["id"] != first["id"]
    assert "replaced by a PUT block" in eng.notifier.notify_gate_watch_ended.call_args.args[3]


def test_direct_pass_supersedes_watch(clock, no_contract):
    eng = _engine(gate_results=[(False, False, _gate()), (True, False, _gate(passed=True, matched=4))])
    _block(eng)
    _block(eng, "CALL", 765.5)            # fresh signal, passes on its own
    assert eng.gate_watch_public() is None
    eng.notifier.notify_gate_watch_ended.assert_not_called()
    no_contract.assert_called_once()


def test_watch_turned_off_mid_watch_cancels(clock, no_contract):
    eng = _engine()
    _block(eng)
    eng.config["technicals_gate"]["watch"] = False
    eng._on_bar_gate_watch(765.0)
    assert eng.gate_watch_public() is None
    no_contract.assert_not_called()


# ── restart survival ───────────────────────────────────────────────────────────

def test_restore_after_restart(clock):
    eng = _engine()
    eng.logger.list_gate_watches.return_value = [
        {"id": "old", "direction": "CALL", "trigger_price": 764.1, "created_at": "2026-10-23T14:40:00+00:00",
         "expires_at": "2026-10-23T16:40:00+00:00"},
        {"id": "live", "direction": "CALL", "trigger_price": 764.3, "gate_mode": "daily",
         "failed_factors": ["trend", "rsi"], "summary": "2/4", "expiry_reason": "2h without confirmation",
         "created_at": "2026-10-26T14:40:00+00:00", "expires_at": "2026-10-26T16:40:00+00:00"},
    ]
    eng.restore_gate_watch()
    w = eng.gate_watch_public()
    assert w["id"] == "live" and w["level"] == ORH and w["failed"] == ["trend", "rsi"]
    expired = [c.args[0] for c in eng.logger.update_gate_watch.call_args_list]
    assert expired == ["old"]


def test_restore_skipped_when_watch_turned_off(clock):
    eng = _engine(watch=False)
    eng.logger.list_gate_watches.return_value = [
        {"id": "live", "direction": "CALL", "trigger_price": 764.3,
         "created_at": "2026-10-26T14:40:00+00:00", "expires_at": "2026-10-26T16:40:00+00:00"}]
    eng.restore_gate_watch()
    assert eng.gate_watch_public() is None


def test_score_labels():
    assert gw.gate_score_label(_gate(matched=2, total=4)) == "2/4"
    assert gw.gate_score_label({"mode": "composite", "matched": 3, "total": 14}) == "+3/14"
    assert gw.gate_failed_factors({"mode": "composite", "matched": 3, "total": 14,
                                   "composite": {"tier": "WATCH"}}) == ["score +3/14 WATCH"]


def test_on_bar_drives_the_watch(clock, no_contract):
    from services.utils.orb_data_hub import OrbBar
    eng = _engine(gate_results=[(False, False, _gate()), (True, False, _gate(passed=True, matched=4))])
    eng._get_option_price = lambda: None
    _block(eng)
    eng.on_bar(OrbBar(ticker="SPY", ts=gw.datetime.now(ET), open=764.5, high=765.3, low=764.4,
                      close=765.2, volume=1000))
    eng.notifier.notify_gate_watch_confirmed.assert_called_once()
    no_contract.assert_called_once()
