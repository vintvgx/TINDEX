"""/ws/app push channel bus (polling audit C2).

Run from api/:  python -m pytest tests/test_app_events.py
"""
import threading
import time
import types

import pytest

from services.websocket import app_events as ae


@pytest.fixture(autouse=True)
def fast(monkeypatch):
    monkeypatch.setattr(ae, "MIN_INTERVAL_S", 0.05)


def test_burst_coalesces_into_one_notice():
    box = ae.AppMailbox()
    for _ in range(10):
        box.put_topics(["positions"])
    box.put_topics(["account"])
    assert box.next(1) == (["account", "positions"], [])


def test_rate_limited_between_sends():
    box = ae.AppMailbox()
    box.put_topics(["pending"])
    box.next(1)
    box.put_topics(["pending"])
    t0 = time.monotonic()
    assert box.next(1) == (["pending"], [])
    assert time.monotonic() - t0 >= 0.04


def test_timeout_returns_none_for_keepalive():
    assert ae.AppMailbox().next(0.05) is None


def test_wakes_on_put_from_another_thread():
    box = ae.AppMailbox()
    threading.Timer(0.05, lambda: box.put_event({"event": "fill"})).start()
    assert box.next(2) == ([], [{"event": "fill"}])


def test_bus_fans_out_and_unregisters():
    bus = ae.AppEventBus()
    a, b = bus.register(), bus.register()
    bus.notify("positions")
    assert a.next(1)[0] == ["positions"] and b.next(1)[0] == ["positions"]
    bus.unregister(a)
    assert bus.client_count() == 1


def test_pending_write_notifies_phones(monkeypatch):
    import services.strategy.trade_logger as tl

    box = ae.get_app_event_bus().register()
    try:
        fake_table = types.SimpleNamespace(
            insert=lambda row: types.SimpleNamespace(execute=lambda: types.SimpleNamespace(data=[row])))
        logger = tl.TradeLogger.__new__(tl.TradeLogger)
        logger.client = types.SimpleNamespace(table=lambda name: fake_table)
        assert logger.create_pending_confirmation({"strategy_id": "s1"})["id"]
        assert box.next(1) == (["pending"], [])
    finally:
        ae.get_app_event_bus().unregister(box)
