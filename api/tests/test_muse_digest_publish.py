"""Tests for POST /muse/market-digest/publish (Muse-published morning digest).

Run from api/: python -m pytest tests/test_muse_digest_publish.py
"""
import os
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

os.environ["MUSE_API_KEY"] = "test-key"

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

# Stub third-party modules that routes.muse pulls in transitively but the
# tests never touch (the real ones aren't installed in this environment).
from unittest.mock import MagicMock  # noqa: E402

for _mod in ("supabase", "supabase.lib", "supabase.lib.client_options"):
    sys.modules.setdefault(_mod, MagicMock())
sys.modules["supabase"].Client = MagicMock
sys.modules["supabase"].create_client = MagicMock(return_value=MagicMock())
sys.modules["supabase.lib.client_options"].ClientOptions = MagicMock


from routes.muse import bp as muse_bp  # noqa: E402


class _FakeTable:
    def __init__(self, store):
        self._store = store

    def upsert(self, row, on_conflict=None):
        self._store.append((row, on_conflict))
        return self

    def execute(self):
        m = MagicMock()
        m.data = []
        return m


def _sb():
    store = []
    client = MagicMock()
    client.table.side_effect = (
        lambda name: _FakeTable(store) if name == "market_digests" else MagicMock()
    )
    svc = SimpleNamespace(client=client)
    svc._store = store
    return svc


@pytest.fixture()
def app_client():
    app = Flask(__name__)
    app.register_blueprint(muse_bp)
    return app.test_client()


def _headers():
    return {"X-Muse-Key": "test-key", "Content-Type": "application/json"}


def _content():
    return {
        "version": "muse-brief-v1",
        "generated_at": "2026-10-05T12:00:00+00:00",
        "market": {},
    }


def test_publish_ok_notifies(app_client):
    svc = _sb()
    with patch("routes.muse.get_supabase_service", return_value=svc), patch(
        "services.strategy.notifier.StrategyNotifier"
    ) as notifier_cls:
        resp = app_client.post(
            "/muse/market-digest/publish", json={"content": _content()}, headers=_headers()
        )
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["success"] is True
    assert body["data"]["silent"] is False
    assert len(svc._store) == 1
    row, conflict = svc._store[0]
    assert conflict == "digest_date"
    assert row["content_json"]["version"] == "muse-brief-v1"
    notifier_cls.return_value.notify_market_digest_ready.assert_called_once()


def test_publish_silent_skips_notify(app_client):
    svc = _sb()
    with patch("routes.muse.get_supabase_service", return_value=svc), patch(
        "services.strategy.notifier.StrategyNotifier"
    ) as notifier_cls:
        resp = app_client.post(
            "/muse/market-digest/publish",
            json={"content": _content(), "silent": True, "date": "2026-10-05"},
            headers=_headers(),
        )
    assert resp.status_code == 200
    assert resp.get_json()["data"] == {"date": "2026-10-05", "silent": True}
    notifier_cls.return_value.notify_market_digest_ready.assert_not_called()


def test_publish_rejects_bad_key(app_client):
    resp = app_client.post(
        "/muse/market-digest/publish",
        json={"content": _content()},
        headers={"X-Muse-Key": "wrong"},
    )
    assert resp.status_code == 401


def test_publish_requires_content_shape(app_client):
    svc = _sb()
    with patch("routes.muse.get_supabase_service", return_value=svc):
        r1 = app_client.post("/muse/market-digest/publish", json={}, headers=_headers())
        assert r1.status_code == 400
        r2 = app_client.post(
            "/muse/market-digest/publish",
            json={"content": {"version": "x"}},  # missing generated_at
            headers=_headers(),
        )
        assert r2.status_code == 400
        r3 = app_client.post(
            "/muse/market-digest/publish",
            json={"content": _content(), "date": "not-a-date"},
            headers=_headers(),
        )
        assert r3.status_code == 400


def _full_brief():
    """Complete muse-brief-v1 payload exercising every schema section."""
    return {
        "version": "muse-brief-v1",
        "digest_date": "2026-10-06",
        "generated_at": "2026-10-06T08:00:00-04:00",
        "silent_update": False,
        "market": {
            "regime": "risk-on",
            "headline": "Futures green into CPI.",
            "futures": {"es": "+0.4%", "nq": "+0.6%"},
            "vix": 14.2,
        },
        "etfs": [
            {
                "ticker": "SPY",
                "score": 82,
                "trend": "up",
                "levels": {"support": 668, "resistance": 682},
                "note": "Holding above Friday's high.",
            }
        ],
        "news": [
            {
                "headline": "CPI due 8:30 AM ET",
                "source": "Bloomberg",
                "url": "https://www.bloomberg.com",
                "tickers": ["SPY"],
            }
        ],
        "events": [
            {
                "time_et": "8:30 AM",
                "label": "CPI (Sep)",
                "consensus": "+0.3% m/m",
                "prior": "+0.4% m/m",
                "impact": "high",
            }
        ],
        "watch": ["No new risk before the 8:30 print."],
        "watchlist": [
            {
                "ticker": "AMZN",
                "score": 87.8,
                "components": {"zone": 25, "proximity": 12.3, "trend": 15},
                "direction": "PUT",
                "setup": "ORB breakdown",
                "if_then": "If AMZN loses 244.80, then PUT toward 243.50.",
                "invalidation": "Reclaim of 245.60 kills it.",
                "levels": {"support": 243.5, "resistance": 247.5, "orh": 246.2, "orl": 244.8},
                "premium_tier": "SCALP_30_100",
            }
        ],
        "muse_picks": [
            {
                "ticker": "AVGO",
                "score": 85.1,
                "components": {"zone": 24, "trend": 15},
                "thesis": "Unusual premarket volume with semis leading.",
                "direction": "CALL",
                "setup": "ORB breakout",
                "if_then": "If AVGO breaks 342.50, then CALL toward 345.",
                "invalidation": "Back under 341 — false breakout.",
                "levels": {"support": 338, "resistance": 345, "orh": 342.5, "orl": 340.1},
                "premium_tier": "SCALP_50",
            }
        ],
        "earnings_blackout": ["JPM"],
        "correlation_note": "Treat semi names as one position.",
    }


def test_publish_full_brief_roundtrip(app_client):
    """Every schema section survives the publish pipe into content_json."""
    svc = _sb()
    brief = _full_brief()
    with patch("routes.muse.get_supabase_service", return_value=svc), patch(
        "services.strategy.notifier.StrategyNotifier"
    ):
        resp = app_client.post(
            "/muse/market-digest/publish",
            json={"content": brief, "date": "2026-10-06"},
            headers=_headers(),
        )
    assert resp.status_code == 200
    assert len(svc._store) == 1
    stored = svc._store[0][0]["content_json"]
    assert stored == brief
    assert stored["news"][0]["tickers"] == ["SPY"]
    assert stored["events"][0]["impact"] == "high"
    assert stored["muse_picks"][0]["thesis"].startswith("Unusual")


def _assert_ticker_shape(t):
    for key in (
        "ticker", "score", "components", "direction", "setup",
        "if_then", "invalidation", "levels", "premium_tier",
    ):
        assert key in t, f"ticker {t.get('ticker')} missing {key}"
    assert t["direction"] in ("CALL", "PUT")
    assert isinstance(t["components"], dict) and len(t["components"]) > 0
    assert isinstance(t["score"], (int, float)) and 0 <= t["score"] <= 100
    for lk in ("support", "resistance", "orh", "orl"):
        assert lk in t["levels"]


def test_brief_contract_shape():
    """Guards the approved muse-brief-v1 contract (2026-10-04)."""
    b = _full_brief()
    assert b["version"] == "muse-brief-v1"
    assert b["market"]["regime"] in ("risk-on", "risk-off", "chop")
    assert isinstance(b["market"]["futures"], dict)
    for e in b["etfs"]:
        assert {"ticker", "score", "trend", "levels", "note"} <= set(e)
        assert e["trend"] in ("up", "down", "flat")
    for n in b["news"]:
        assert {"headline", "source", "url", "tickers"} <= set(n)
    for ev in b["events"]:
        assert {"time_et", "label", "impact"} <= set(ev)
        assert ev["impact"] in ("high", "medium", "low")
    assert isinstance(b["watch"], list)
    assert len(b["watchlist"]) == 1 and len(b["muse_picks"]) == 1
    for t in b["watchlist"] + b["muse_picks"]:
        _assert_ticker_shape(t)
    assert "thesis" in b["muse_picks"][0]
    assert isinstance(b["earnings_blackout"], list)
