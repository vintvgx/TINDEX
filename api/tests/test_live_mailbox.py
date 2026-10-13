"""/ws/strategy live mailbox: coalesce prices, keep events (2026-10-13).

Run from api/:  python -m pytest tests/test_live_mailbox.py
"""
import json
import queue

import pytest

from services.websocket.live_mailbox import LiveMailbox


def price(mid):
    return json.dumps({"type": "price_update", "mid_price": mid})


def test_backlog_collapses_to_the_newest_price():
    box = LiveMailbox()
    for m in range(50):                         # ~17s of ticks while backgrounded
        box.put_nowait(price(m))
    assert json.loads(box.get(0.1))["mid_price"] == 49
    with pytest.raises(queue.Empty):
        box.get(0.01)


def test_events_are_never_dropped_and_stay_ordered():
    box = LiveMailbox()
    box.put_nowait(price(1))
    box.put_nowait(json.dumps({"type": "position_closed"}))
    box.put_nowait(price(2))
    out = [json.loads(box.get(0.1))["type"] for _ in range(2)]
    assert out == ["price_update", "position_closed"]


def test_pending_and_price_coalesce_separately():
    box = LiveMailbox()
    box.put_nowait(price(1))
    box.put_nowait(json.dumps({"type": "pending_price_update", "mid_price": 7}))
    box.put_nowait(price(3))
    got = [json.loads(box.get(0.1)) for _ in range(2)]
    assert got[0]["mid_price"] == 3 and got[1]["type"] == "pending_price_update"


def test_engine_seed_and_fanout_work_with_the_mailbox():
    import sys, threading, types
    try:
        import supabase  # noqa: F401
    except ModuleNotFoundError:
        stub = types.ModuleType("supabase"); stub.create_client = lambda *a, **k: None; stub.Client = object
        sys.modules["supabase"] = stub
    import services.strategy.orb_engine as oe
    eng = oe.ORBEngine.__new__(oe.ORBEngine)
    eng._live_clients, eng._live_clients_lock = [], threading.Lock()
    eng._live_push, eng._live_push_lock = {"price_update": {"at": 0, "last": price(5), "timer": None}}, threading.Lock()
    box = LiveMailbox()
    eng._register_live_client(box)               # seeds the cached latest
    assert json.loads(box.get(0.1))["mid_price"] == 5
