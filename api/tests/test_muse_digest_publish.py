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
