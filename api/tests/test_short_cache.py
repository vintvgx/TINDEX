"""Short shared cache for the polled position endpoints (polling audit A5).

Run from api/:  python -m pytest tests/test_short_cache.py
"""
import threading
import time
import types

import pytest

from services.utils.short_cache import ShortCache


def test_hits_share_one_compute():
    c, calls = ShortCache(ttl=10), []
    for _ in range(5):
        assert c.get_or_compute("k", lambda: calls.append(1) or "v") == "v"
    assert len(calls) == 1


def test_expires_after_ttl():
    c, calls = ShortCache(ttl=0.05), []
    c.get_or_compute("k", lambda: calls.append(1))
    time.sleep(0.08)
    c.get_or_compute("k", lambda: calls.append(1))
    assert len(calls) == 2


def test_uncacheable_results_are_recomputed():
    c, calls = ShortCache(ttl=10), []
    bad = lambda: calls.append(1) or {"available": False}
    for _ in range(3):
        c.get_or_compute("k", bad, cacheable=lambda r: r["available"])
    assert len(calls) == 3


def test_concurrent_misses_compute_once():
    c, calls = ShortCache(ttl=10), []

    def slow():
        calls.append(1)
        time.sleep(0.1)
        return "v"

    results = []
    threads = [threading.Thread(target=lambda: results.append(c.get_or_compute("k", slow))) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(calls) == 1 and results == ["v"] * 8


def test_clear_during_compute_does_not_store_stale_value():
    c = ShortCache(ttl=10)

    def compute_then_cleared():
        c.clear()  # e.g. a sell landed while Alpaca was being asked
        return "pre-sell"

    c.get_or_compute("k", compute_then_cleared)
    assert c.get_or_compute("k", lambda: "post-sell") == "post-sell"


# ── /strategy/accounts/positions uses it ─────────────────────────────────────

flask = pytest.importorskip("flask")


@pytest.fixture
def client(monkeypatch):
    import routes.strategy_routes as sr
    import services.alpaca.shared_clients as shared

    fetches = []

    def fake_client(paper):
        def get_all_positions():
            fetches.append(paper)
            return [types.SimpleNamespace(symbol="SPY", qty=1, side="long", market_value=100,
                                          unrealized_pl=5, unrealized_plpc=0.05,
                                          current_price=1.0, avg_entry_price=0.95)]
        return types.SimpleNamespace(get_all_positions=get_all_positions)

    monkeypatch.setattr(shared, "get_trading_client", fake_client)
    monkeypatch.setattr(sr, "_positions_cache", ShortCache(ttl=10))
    app = flask.Flask(__name__)
    app.register_blueprint(sr.strategy_bp)
    return app.test_client(), fetches


def test_accounts_positions_one_fetch_per_account_across_modes(client):
    c, fetches = client
    for mode in ("both", "paper", "live", "both"):
        r = c.get(f"/strategy/accounts/positions?mode={mode}")
        assert r.status_code == 200
    assert sorted(fetches) == [False, True]
    assert r.get_json()["live"]["total_market_value"] == 100


def test_write_request_clears_the_cache():
    import routes.strategy_routes as sr
    sr._positions_cache.get_or_compute("x", lambda: 1)
    app = flask.Flask(__name__)
    with app.test_request_context("/strategy/anything", method="POST"):
        sr._invalidate_positions_cache(flask.Response())
    assert sr._positions_cache.get_or_compute("x", lambda: 2) == 2
