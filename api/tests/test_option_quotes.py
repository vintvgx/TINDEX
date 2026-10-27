"""Watched-contract quotes: one batched Alpaca snapshot call, mid-price marks,
short cache. Run from api/:  python -m pytest tests/test_option_quotes.py
"""
from types import SimpleNamespace

import pytest

import routes.options_routes as r


def _snap(bid, ask, last=None):
    return SimpleNamespace(latest_quote=SimpleNamespace(bid_price=bid, ask_price=ask),
                           latest_trade=SimpleNamespace(price=last) if last is not None else None)


@pytest.fixture
def alpaca(monkeypatch):
    state = {"calls": [], "snaps": {}}

    class Client:
        def get_option_snapshot(self, req):
            state["calls"].append(list(req.symbol_or_symbols))
            return state["snaps"]

    import services.alpaca.alpaca_option_service as svc
    monkeypatch.setattr(svc, "get_alpaca_option_service", lambda: SimpleNamespace(options_client=Client()))
    r._QUOTE_CACHE.clear()
    yield state
    r._QUOTE_CACHE.clear()


A, B = "ACGO261120C00420000", "SPY261120P00700000"


def test_batches_and_marks_at_mid(alpaca):
    alpaca["snaps"] = {A: _snap(2.60, 2.66, last=2.50), B: _snap(0, 0, last=1.10)}
    out = r.fetch_option_quotes([A, B])
    assert alpaca["calls"] == [[A, B]]
    assert out[A]["mark"] == 2.63          # two-sided → mid
    assert out[B]["mark"] == 1.10          # no quote → last trade


def test_cached_symbols_skip_alpaca(alpaca):
    alpaca["snaps"] = {A: _snap(2.60, 2.66)}
    r.fetch_option_quotes([A])
    r.fetch_option_quotes([A])
    assert len(alpaca["calls"]) == 1


def test_unpriced_symbol_is_left_out(alpaca):
    alpaca["snaps"] = {}
    assert r.fetch_option_quotes([A]) == {}
