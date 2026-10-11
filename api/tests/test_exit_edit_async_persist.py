"""PATCH /strategy/configs/<id>/exits responds after the in-memory apply and
persists to Supabase in the background, in edit order (polling audit B1).

Run from api/:  python -m pytest tests/test_exit_edit_async_persist.py
"""
import threading
import time
import types

import pytest

flask = pytest.importorskip("flask")

import routes.strategy_routes as sr  # noqa: E402


class FakeExitManager:
    entry_premium = 1.0
    _sl_outer_floor = None

    def __init__(self):
        self.hard_stop = 0.7

    def apply_overrides(self, **kw):
        if kw.get("hard_stop") is not None:
            self.hard_stop = kw["hard_stop"]
            return {"hard_stop": kw["hard_stop"]}
        return {}

    def to_dict(self):
        return {"hard_stop": self.hard_stop}


@pytest.fixture
def setup(monkeypatch):
    em = FakeExitManager()
    engine = types.SimpleNamespace(exit_manager=em, active_trade_id="t1",
                                   debug=types.SimpleNamespace(emit=lambda *a, **k: None))
    monkeypatch.setattr(sr, "_resolve_any_engine", lambda sid: engine)

    persisted, release = [], threading.Event()

    def slow_update(**kw):
        release.wait(2)             # Supabase is slow
        persisted.append(kw["hard_stop_price"])
        return True

    monkeypatch.setattr(sr, "logger_svc", types.SimpleNamespace(update_exit_levels=slow_update))
    app = flask.Flask(__name__)
    app.register_blueprint(sr.strategy_bp)
    return app.test_client(), em, persisted, release


def _drain():
    sr._EXIT_PERSIST_POOL.submit(lambda: None).result(timeout=5)


def test_responds_before_persist_and_applies_in_memory(setup):
    client, em, persisted, release = setup
    t0 = time.monotonic()
    r = client.patch("/strategy/configs/s1/exits", json={"hard_stop": 0.8})
    assert time.monotonic() - t0 < 0.5
    assert r.status_code == 200 and r.get_json()["exit_state"]["hard_stop"] == 0.8
    assert em.hard_stop == 0.8 and persisted == []   # protected now, saved later
    release.set()
    _drain()
    assert persisted == [0.8]


def test_rapid_edits_persist_in_order(setup):
    client, _, persisted, release = setup
    for v in (0.81, 0.82, 0.83):
        assert client.patch("/strategy/configs/s1/exits", json={"hard_stop": v}).status_code == 200
    release.set()
    _drain()
    assert persisted == [0.81, 0.82, 0.83]
