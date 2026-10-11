"""Async manual sell (polling audit B2): start_manual_exit reserves under the
lock and returns at once; the same price-seek/finalize runs in the
background and its result matches the synchronous submit_manual_exit.

Run from api/:  python -m pytest tests/test_async_manual_exit.py
"""
import sys
import threading
import time
import types

import pytest

try:
    import supabase  # noqa: F401
except ModuleNotFoundError:
    stub = types.ModuleType("supabase")
    stub.create_client = lambda *a, **k: None
    stub.Client = object
    sys.modules["supabase"] = stub

import services.strategy.orb_engine as oe  # noqa: E402


def make_engine(fill_delay=0.2, filled_qty=2, avg=1.5, blow_up=False):
    eng = oe.ORBEngine.__new__(oe.ORBEngine)
    eng._tick_lock = threading.Lock()
    eng._manual_exits = {}
    eng._manual_exits_lock = threading.Lock()
    eng.trade_taken = True
    eng.contract_symbol = "SPY261009C00580000"
    eng.position = "CALL"
    eng.ticker = "SPY"
    eng.active_trade_id = None
    eng._last_underlying_price = 580.0
    eng.debug = types.SimpleNamespace(emit=lambda *a, **k: None)
    em = types.SimpleNamespace(qty_remaining=2, entry_premium=1.0, mark_breakeven=lambda: None)
    eng.exit_manager = em
    calls = {"reserve": 0, "finalize": 0, "reset": 0}

    def reserve(closing_all, contract, want):
        calls["reserve"] += 1

    def execute(want, contract, limit_price):
        if blow_up:
            raise RuntimeError("alpaca down")
        time.sleep(fill_delay)
        return {"filled_qty": filled_qty, "avg_fill_price": avg}

    eng._reserve_exit_qty = reserve
    eng._execute_priced_exit = execute
    eng._reconcile_exit_shortfall = lambda *a: None
    eng._finalize_exit = lambda *a, **k: calls.__setitem__("finalize", calls["finalize"] + 1)
    eng.reset_session = lambda: calls.__setitem__("reset", calls["reset"] + 1)
    return eng, calls


def wait_result(eng, sell_id, timeout=3):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        r = eng.get_manual_exit_result(sell_id)
        if r and r["status"] != "pending":
            return r
        time.sleep(0.02)
    raise AssertionError("no outcome")


def test_returns_at_once_then_same_result_as_sync():
    eng, calls = make_engine(fill_delay=0.3)
    t0 = time.monotonic()
    started = eng.start_manual_exit(None, None)
    assert time.monotonic() - t0 < 0.1
    assert started["status"] == "accepted" and started["qty"] == 2
    assert calls["reserve"] == 1                                   # reserved before returning
    assert eng.get_manual_exit_result(started["sell_id"]) == {"status": "pending"}
    async_result = wait_result(eng, started["sell_id"])

    sync_eng, _ = make_engine(fill_delay=0)
    assert async_result == sync_eng.submit_manual_exit(None, None)
    assert async_result["status"] == "ok" and async_result["qty_sold"] == 2 and async_result["pnl"] == 100.0
    assert calls["finalize"] == 1 and calls["reset"] == 1


def test_validation_errors_are_immediate():
    eng, calls = make_engine()
    eng.trade_taken = False
    r = eng.start_manual_exit(None, None)
    assert r == {"status": "error", "message": "No active position to sell"} and calls["reserve"] == 0


def test_background_exception_is_reported_not_lost():
    eng, _ = make_engine(blow_up=True)
    started = eng.start_manual_exit(1, None)
    r = wait_result(eng, started["sell_id"])
    assert r["status"] == "error"


def test_unknown_sell_id():
    eng, _ = make_engine()
    assert eng.get_manual_exit_result("nope") is None
