"""
Reversal watch (2026-10-27): a REVERSAL signal the gate (VWAP) blocked is
watched for up to 30 min and entered the first time the gate passes WHILE
the scorer's reversal trigger still holds. Re-checked on OrbService's
per-bar scorer status, not on raw bars. Breakout watches unchanged.
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
VWAP = 762.00


def _at(h, m):
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
    set_(11, 0)
    return set_


@pytest.fixture(autouse=True)
def sync_executor(monkeypatch):
    monkeypatch.setattr(gw, "_WATCH_EXECUTOR", MagicMock(submit=lambda fn, *a: fn(*a)))


@pytest.fixture
def no_contract(monkeypatch):
    m = MagicMock(return_value=None)
    monkeypatch.setattr(oe, "select_contract", m)
    return m


def _gate(passed=False):
    return {"mode": "daily", "passed": passed, "needs_confirm": False, "matched": int(passed), "total": 1,
            "results": [{"key": "vwap", "ok": passed, "skipped": False}],
            "summary": f"{int(passed)}/1 technicals matched"}


BLOCKED, ALIGNED = (False, False, _gate()), (True, False, _gate(passed=True))


def _engine(watch=True, gate_results=None, vwap=VWAP):
    eng = ORBEngine.__new__(ORBEngine)
    eng.config = {"ticker": "SPY", "active": True, "id": "s1", "strategy_name": "SPY REV",
                  "technicals_gate": {"enabled": True, "required": ["vwap"],
                                      **({"watch": True} if watch else {})}}
    eng.ticker, eng.profile_key, eng.profile = "SPY", "REVERSAL", get_profile("REVERSAL")
    eng.strategy_id, eng.strategy_name, eng.paper = "s1", "SPY REV", True
    eng.bypass_breakout_window, eng.confirm_entry = True, False
    eng.capital_limit = None
    eng._tick_lock = threading.Lock()
    eng.debug, eng.logger, eng.notifier, eng._hub = MagicMock(), MagicMock(), MagicMock(), MagicMock()
    eng.option_client, eng.stream_manager = None, None
    eng.limit_orders = MagicMock()
    eng._reset_session_state()
    eng.orh, eng.orl = ORH, ORL
    eng._find_ticker_conflict = lambda d: None
    eng._live_session_vwap = lambda: vwap
    eng._check_technicals_gate = MagicMock(side_effect=gate_results or [BLOCKED])
    return eng


def _reversal(eng, direction="CALL", price=761.0):
    """A scored reversal reaches the gate, as on_reversal_confirmed hands it."""
    eng._reversal_entry_in_progress = True
    try:
        eng._enter_trade(direction, price)
    finally:
        eng._reversal_entry_in_progress = False


def _status(close, trigger=True, direction="CALL", active=True, reason=None):
    if not active:
        return {"active": False, "reason": reason}
    return {"active": True, "direction": direction, "score": 4 if trigger else 2, "threshold": 3,
            "trigger": trigger, "close": close}


def test_block_opens_reversal_watch_with_30_min_deadline(clock, no_contract):
    eng = _engine()
    _reversal(eng)
    w = eng.gate_watch_public()
    assert w["kind"] == "reversal" and w["failed"] == ["vwap"]
    assert w["expires_at"].startswith("2026-10-26T11:30")
    assert eng.notifier.notify_gate_watch_started.call_args.kwargs["kind"] == "reversal"
    eng._hub.publish_reversal_declined.assert_called_once_with("SPY", "CALL")   # scorer keeps scoring
    eng.logger.create_gate_watch.assert_called_once()
    assert eng.logger.create_gate_watch.call_args.args[0]["kind"] == "reversal"


def test_watch_off_behaves_as_today(clock, no_contract):
    eng = _engine(watch=False)
    _reversal(eng)
    assert eng.gate_watch_public() is None
    eng._hub.publish_reversal_declined.assert_called_once()
    assert eng._check_technicals_gate.call_args.kwargs["notify"] is True   # plain block push
    eng.notifier.notify_gate_watch_started.assert_not_called()


def test_vwap_alignment_without_trigger_does_not_enter(clock, no_contract):
    eng = _engine(gate_results=[BLOCKED, ALIGNED, ALIGNED])
    _reversal(eng)
    eng._on_reversal_status(_status(762.5, trigger=False))
    assert eng.gate_watch_public() is not None
    no_contract.assert_not_called()
    eng.notifier.notify_gate_watch_confirmed.assert_not_called()


def test_full_condition_enters_via_normal_entry_path(clock, no_contract):
    eng = _engine(gate_results=[BLOCKED, ALIGNED])
    _reversal(eng)
    eng._on_reversal_status(_status(762.5, trigger=True))
    assert eng.gate_watch_public() is None
    eng.notifier.notify_gate_watch_confirmed.assert_called_once()
    assert eng.notifier.notify_gate_watch_confirmed.call_args.kwargs["kind"] == "reversal"
    assert eng._check_technicals_gate.call_count == 2          # not re-run inside _enter_trade
    no_contract.assert_called_once()
    assert no_contract.call_args.kwargs["trigger_price"] == 762.5


def test_gate_still_blocked_with_trigger_keeps_watching(clock, no_contract):
    eng = _engine(gate_results=[BLOCKED, BLOCKED])
    _reversal(eng)
    eng._on_reversal_status(_status(761.2, trigger=True))
    assert eng.gate_watch_public() is not None
    no_contract.assert_not_called()


def test_reversal_trigger_resolved_expires(clock, no_contract):
    # The scorer's episode ending (original breakout resumed) is the
    # reversal condition resolving without an entry.
    eng = _engine()
    _reversal(eng)
    eng._on_reversal_status(_status(None, active=False,
                                    reason="price re-broke the ORB low — the original breakout resumed"))
    assert eng.gate_watch_public() is None
    reason = eng.notifier.notify_gate_watch_ended.call_args.args[3]
    assert "original breakout resumed" in reason
    assert eng.notifier.notify_gate_watch_ended.call_args.kwargs["kind"] == "reversal"


def test_price_moving_away_from_vwap_expires(clock, no_contract):
    eng = _engine()
    _reversal(eng, price=761.0)                     # CALL, $1.00 below VWAP
    eng._on_reversal_status(_status(761.4))         # toward VWAP — still watching
    assert eng.gate_watch_public() is not None
    eng._on_reversal_status(_status(760.8))         # $1.20 below — further away
    assert eng.gate_watch_public() is None
    assert "away from VWAP" in eng.notifier.notify_gate_watch_ended.call_args.args[3]


def test_put_moving_away_from_vwap_expires(clock, no_contract):
    eng = _engine()
    _reversal(eng, "PUT", 763.0)                    # PUT, $1.00 above VWAP
    eng._on_reversal_status(_status(763.5, direction="PUT"))
    assert eng.gate_watch_public() is None


def test_30_minute_expiry(clock, no_contract):
    eng = _engine()
    _reversal(eng)
    clock(11, 31)
    eng._on_reversal_status(_status(761.5))
    assert eng.gate_watch_public() is None
    assert "30 min" in eng.notifier.notify_gate_watch_ended.call_args.args[3]
    clock(11, 0)
    eng = _engine()
    _reversal(eng)
    clock(11, 31)
    assert eng.expire_gate_watch_if_stale() is True     # sweep, no status needed


def test_opposite_side_signal_replaces_watch(clock, no_contract):
    eng = _engine(gate_results=[BLOCKED, BLOCKED])
    _reversal(eng, "CALL", 761.0)
    first = eng.gate_watch_public()
    _reversal(eng, "PUT", 763.0)
    w = eng.gate_watch_public()
    assert w["direction"] == "PUT" and w["id"] != first["id"]
    assert "replaced by a PUT block" in eng.notifier.notify_gate_watch_ended.call_args.args[3]


def test_same_side_refresh_keeps_original_deadline(clock, no_contract):
    eng = _engine(gate_results=[BLOCKED, BLOCKED])
    _reversal(eng)
    first = eng.gate_watch_public()
    clock(11, 10)
    _reversal(eng, price=761.3)
    again = eng.gate_watch_public()
    assert again["id"] == first["id"] and again["expires_at"] == first["expires_at"]


def test_position_open_expires(clock, no_contract):
    eng = _engine()
    _reversal(eng)
    eng.trade_taken = True
    eng._on_reversal_status(_status(761.5))
    assert eng.gate_watch_public() is None


def test_raw_bars_do_not_drive_a_reversal_watch(clock, no_contract):
    eng = _engine(gate_results=[BLOCKED, ALIGNED])
    _reversal(eng)
    eng._on_bar_gate_watch(762.5)
    assert eng._check_technicals_gate.call_count == 1 and eng.gate_watch_public()


def test_reversal_watches_not_restored_after_restart(clock):
    eng = _engine()
    eng.logger.list_gate_watches.return_value = [
        {"id": "r1", "kind": "reversal", "direction": "CALL", "trigger_price": 761.0,
         "created_at": "2026-10-26T14:55:00+00:00", "expires_at": "2026-10-26T15:25:00+00:00"}]
    eng.restore_gate_watch()
    assert eng.gate_watch_public() is None
    assert eng.logger.update_gate_watch.call_args.args[0] == "r1"


def test_hub_fans_out_reversal_status():
    from services.utils.orb_data_hub import OrbDataHub
    hub, got = OrbDataHub(), []
    hub.subscribe_reversal_status("SPY", got.append)
    hub.publish_reversal_status("SPY", {"active": False, "reason": "x"})
    hub.unsubscribe("SPY", got.append)
    hub.publish_reversal_status("SPY", {"active": True})
    assert got == [{"active": False, "reason": "x"}]


# ── OrbService side: the scorer's trigger + status publish ─────────────────────

def _svc(now):
    from services.tindex.orb_service import OrbService
    from services.strategy.reversal_signals import SessionVwap
    svc = OrbService.__new__(OrbService)
    svc._hub = MagicMock()
    svc._bar_history = {"SPY": []}
    svc._session_vwap = SessionVwap()
    svc._reversal_fire_threshold = 3
    svc.get_current_et_time = lambda: now
    svc._rev_state = {"SPY": {
        "direction": "PUT", "score": 0, "signals_hit": {"rsi_exhaustion", "volume_surge"},
        "max_extension": 0.0, "consec_wrong_side": 1, "bars_counted": 3, "fired": False,
        "worst_wrong_close": None, "prev_wrong_close": None, "consec_recovery": 0,
        "rsi_exhaustion": True, "zone_wall": None,
    }}
    return svc


def _bar(close, high=None, low=None, volume=100):
    from types import SimpleNamespace
    return SimpleNamespace(close=close, high=high or close, low=low or close, volume=volume)


def test_scorer_trigger_ignores_decline_cooldown():
    from datetime import timedelta
    now = ET.localize(datetime(2026, 10, 26, 11, 0))
    svc = _svc(now)
    svc._rev_state["SPY"]["cooldown_until"] = now + timedelta(minutes=5)
    # PUT breakout (ORL 758) failing back above it: level_violated + sustained_press
    r = svc._score_reversal("SPY", _bar(759.5), "PUT", ORH, ORL)
    assert r["fire"] is False                         # held by the cooldown
    assert svc._rev_state["SPY"]["trigger"] is True    # but the trigger itself holds


def test_status_payloads():
    svc = _svc(ET.localize(datetime(2026, 10, 26, 11, 0)))
    svc._rev_state["SPY"].update(score=4, threshold=3, trigger=True)
    svc._publish_reversal_status("SPY", 759.5, None)
    st = svc._hub.publish_reversal_status.call_args.args[1]
    assert st == {"active": True, "direction": "CALL", "score": 4, "threshold": 3, "trigger": True,
                  "close": 759.5}
    svc._publish_reversal_status("SPY", 757.0, "price re-broke the ORB low — the original breakout resumed")
    assert svc._hub.publish_reversal_status.call_args.args[1]["active"] is False
    svc._rev_state.pop("SPY")
    svc._publish_reversal_status("SPY", 760.0, None)
    assert svc._hub.publish_reversal_status.call_args.args[1] == {
        "active": False, "reason": "the reversal episode ended"}
