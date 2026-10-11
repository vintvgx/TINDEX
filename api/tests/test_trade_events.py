"""Alpaca trade_updates → in-process events (polling audit C1).

Run from api/:  python -m pytest tests/test_trade_events.py
"""
import asyncio
import types
from datetime import datetime

import pytz

from services.alpaca import trade_events as te

ET = pytz.timezone("America/New_York")


def _update(event="fill"):
    order = types.SimpleNamespace(
        id="o-1", symbol="SPY261009C00580000", side=types.SimpleNamespace(value="buy"),
        status=types.SimpleNamespace(value="filled"), qty="2", filled_qty="2", filled_avg_price="1.25",
    )
    return types.SimpleNamespace(event=types.SimpleNamespace(value=event), order=order,
                                 price="1.25", position_qty="2")


def test_normalize_update():
    e = te.normalize_update(_update(), paper=True)
    assert e["account"] == "paper" and e["event"] == "fill" and e["side"] == "buy"
    assert e["filled_qty"] == 2.0 and e["filled_avg_price"] == 1.25 and e["symbol"].startswith("SPY")


def test_hub_isolates_failing_subscriber():
    hub, got = te.TradeEventHub(), []
    hub.subscribe(lambda e: 1 / 0)
    hub.subscribe(got.append)
    hub.publish({"event": "fill"})
    assert got == [{"event": "fill"}]


def test_handler_publishes_normalized_event():
    hub, got = te.TradeEventHub(), []
    hub.subscribe(got.append)
    mgr = te.TradeUpdatesManager(hub)
    asyncio.run(mgr._handler(False)(_update("canceled")))
    assert got[0]["account"] == "live" and got[0]["event"] == "canceled"
    assert mgr.last_event_at is not None


def test_session_window():
    wed = lambda h, m: ET.localize(datetime(2026, 10, 7, h, m))
    assert te._in_session(wed(9, 25)) and te._in_session(wed(15, 0)) and te._in_session(wed(16, 5))
    assert not te._in_session(wed(8, 0)) and not te._in_session(wed(20, 0))
    assert not te._in_session(ET.localize(datetime(2026, 10, 10, 12, 0)))   # Saturday


def test_fill_event_clears_positions_cache():
    import pytest
    pytest.importorskip("flask")
    import routes.strategy_routes as sr

    sr._positions_cache.get_or_compute("k", lambda: "old")
    te.get_trade_event_hub().publish({"event": "new"})       # not a position change
    assert sr._positions_cache.get_or_compute("k", lambda: "new") == "old"
    te.get_trade_event_hub().publish({"event": "fill"})
    assert sr._positions_cache.get_or_compute("k", lambda: "new") == "new"
