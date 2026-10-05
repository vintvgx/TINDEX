"""Route tests for the digest entry-mode preferences:
GET /brief/modes and POST /brief/mode.

Run from api/: python -m pytest tests/brief/test_entry_mode_routes.py
"""
import os
import sys
from types import SimpleNamespace

import pytest
from flask import Flask

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

import routes.brief_routes as brief_routes  # noqa: E402


class _FakeIO:
    def __init__(self):
        self.modes = {}

    def entry_modes(self):
        return dict(self.modes)

    def set_entry_mode(self, ticker, mode):
        if mode not in ("confirm", "auto"):
            raise ValueError("mode must be confirm or auto")
        self.modes[ticker.upper()] = mode
        return {"ticker": ticker.upper(), "mode": mode}


@pytest.fixture()
def app_client(monkeypatch):
    fake = _FakeIO()
    monkeypatch.setattr(brief_routes, "get_brief_service",
                        lambda: SimpleNamespace(io=fake))
    app = Flask(__name__)
    app.register_blueprint(brief_routes.bp)
    client = app.test_client()
    client._fake_io = fake
    return client


def test_get_modes_empty_by_default(app_client):
    resp = app_client.get("/brief/modes")
    assert resp.status_code == 200
    assert resp.get_json() == {"success": True, "data": {}}


def test_set_mode_roundtrip(app_client):
    resp = app_client.post("/brief/mode", json={"ticker": "amzn", "mode": "auto"})
    assert resp.status_code == 200
    assert resp.get_json() == {"success": True, "data": {"ticker": "AMZN", "mode": "auto"}}
    # Missing tickers still default to confirm on read; set ones come back.
    resp = app_client.get("/brief/modes")
    assert resp.get_json()["data"] == {"AMZN": "auto"}


def test_set_mode_rejects_bad_mode(app_client):
    resp = app_client.post("/brief/mode", json={"ticker": "AMZN", "mode": "yolo"})
    assert resp.status_code == 400
    assert resp.get_json()["success"] is False


def test_set_mode_requires_ticker(app_client):
    resp = app_client.post("/brief/mode", json={"mode": "auto"})
    assert resp.status_code == 400
