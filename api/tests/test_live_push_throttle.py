"""/ws/strategy/<id>/live fan-out throttle (polling audit 2026-10-07, A3):
ORBEngine._publish_live coalesces price/pending updates to at most one per
LIVE_PUSH_MIN_INTERVAL_S per kind — immediate first send, ONE trailing send
built from the latest state, identical payloads skipped, nothing built when
no client is connected.

Run from api/:  python -m pytest tests/test_live_push_throttle.py
"""
import queue
import sys
import threading
import time
import types

import pytest

# orb_engine → trade_logger imports supabase at module load; stub it only
# where the package isn't installed (local runs) — the throttle never uses it.
try:
    import supabase  # noqa: F401
except ModuleNotFoundError:
    stub = types.ModuleType("supabase")
    stub.create_client = lambda *a, **k: None
    stub.Client = object
    sys.modules["supabase"] = stub

import services.strategy.orb_engine as oe  # noqa: E402

INTERVAL = 0.05


@pytest.fixture(autouse=True)
def fast_interval(monkeypatch):
    monkeypatch.setattr(oe, "LIVE_PUSH_MIN_INTERVAL_S", INTERVAL)


def make_engine(with_client=True):
    eng = oe.ORBEngine.__new__(oe.ORBEngine)  # skip the heavy __init__
    eng._live_clients = []
    eng._live_clients_lock = threading.Lock()
    eng._live_push = {}
    eng._live_push_lock = threading.Lock()
    q = queue.Queue()
    if with_client:
        eng._live_clients.append(q)
    return eng, q


def drain(q):
    out = []
    while not q.empty():
        out.append(q.get_nowait())
    return out


def test_burst_sends_first_immediately_then_one_trailing_with_latest_state():
    eng, q = make_engine()
    state = {"mid": 0}
    build = lambda: f"mid={state['mid']}"
    for i in range(1, 11):          # 10 ticks inside one window
        state["mid"] = i
        eng._publish_live("price_update", build)
    assert drain(q) == ["mid=1"]    # first goes out at once
    time.sleep(INTERVAL * 3)
    assert drain(q) == ["mid=10"]   # ONE trailing send, newest price


def test_identical_payload_is_skipped():
    eng, q = make_engine()
    eng._publish_live("price_update", lambda: "same")
    time.sleep(INTERVAL * 2)
    eng._publish_live("price_update", lambda: "same")
    time.sleep(INTERVAL * 2)
    assert drain(q) == ["same"]


def test_nothing_is_built_without_listeners():
    eng, _ = make_engine(with_client=False)
    calls = []
    eng._publish_live("price_update", lambda: calls.append(1) or "x")
    time.sleep(INTERVAL * 2)
    assert calls == []


def test_kinds_are_throttled_independently():
    eng, q = make_engine()
    eng._publish_live("price_update", lambda: "price")
    eng._publish_live("pending_price_update", lambda: "pending")
    assert sorted(drain(q)) == ["pending", "price"]
