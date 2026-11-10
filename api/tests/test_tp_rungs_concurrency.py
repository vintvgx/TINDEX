"""
PR #121 CodeRabbit threads 0, 1, 2 — a TP line edited while ticks run can
never sell twice, in memory or after a restart, and lines stop reserving
contracts while take-profit is off.

Run from api/:  python -m pytest tests/test_tp_rungs_concurrency.py
"""
import os
import sys
import threading
import time
import types

import pytest

flask = pytest.importorskip("flask")
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import routes.strategy_routes as sr  # noqa: E402
from services.strategy.exit_manager import ExitManager  # noqa: E402
from services.strategy.profiles import get_profile  # noqa: E402
from services.strategy.trade_logger import merge_rung_state  # noqa: E402

SPEC = {"tp1_mult": 1.30, "min_tp1_dollars": 0.0, "tp2_mult": 1.90, "min_tp2_dollars": 0.0,
        "tp1_close_pct": 0.50, "tp2_close_pct": 0.35}


def _em():
    return ExitManager(1.00, 4, {"orh": 770.0, "orl": 766.0}, "CALL", "23:59",
                       get_profile("TREND_RIDER", dict(SPEC)), is_zero_dte=False)


def _tick(em, price, n=1):
    a = None
    for _ in range(n):
        a = em.evaluate(price, 768.0)
        if a["type"] != "HOLD":
            em.update_qty(a["qty"])
    return a


@pytest.fixture
def setup(monkeypatch):
    em = _em()
    engine = types.SimpleNamespace(
        exit_manager=em, active_trade_id="t1", _tick_lock=threading.Lock(),
        _current_option_price=1.20, _overlay_delta=None, _overlay_delta_source=None, _overlay_delta_at=0.0,
        _ladder_with_stock=lambda e, mid: e.ladder(),
        debug=types.SimpleNamespace(emit=lambda *a, **k: None))
    monkeypatch.setattr(sr, "_resolve_any_engine", lambda sid: engine)
    writes, release = [], threading.Event()

    def slow_update(**kw):
        release.wait(3)
        writes.append(kw.get("exit_overrides_patch"))
        return True

    monkeypatch.setattr(sr, "logger_svc", types.SimpleNamespace(
        update_exit_levels=slow_update, log_v2_event=lambda *a, **k: True, log_v2_override=lambda *a, **k: True))
    app = flask.Flask(__name__)
    app.register_blueprint(sr.strategy_bp)
    return app.test_client(), em, engine, writes, release


def _drain():
    sr._EXIT_PERSIST_POOL.submit(lambda: None).result(timeout=5)


def test_edit_waits_for_the_tick_lock_so_a_line_cannot_fire_mid_edit(setup):
    client, em, engine, writes, release = setup
    em.apply_overrides(tp_rungs=[{"id": "a", "premium": 1.25, "qty": 1}], current_price=1.20)
    rid = em.rungs_public()[0]["id"]
    done = {}
    engine._tick_lock.acquire()           # a tick is evaluating right now
    t = threading.Thread(target=lambda: done.setdefault("r", client.patch(
        "/strategy/configs/s1/exits",
        json={"tp_rungs": [{"id": rid, "premium": 1.25, "qty": 1}, {"premium": 1.6, "qty": 1}]})))
    t.start()
    time.sleep(0.2)
    assert "r" not in done                # the edit is waiting for the tick
    assert _tick(em, 1.26, 2)["reason"] == "TP_RUNG"   # the line fires in that tick
    engine._tick_lock.release()
    t.join(5)
    assert done["r"].status_code == 200
    line = next(r for r in em.rungs_public() if r["id"] == rid)
    assert line["hit"] is True                          # kept as fired, not re-armed
    for _ in range(4):
        assert _tick(em, 1.27)["reason"] != "TP_RUNG"   # never sells twice
    release.set()
    _drain()


def test_queued_persist_saves_a_hit_that_happened_after_the_request(setup):
    client, em, engine, writes, release = setup
    r = client.patch("/strategy/configs/s1/exits", json={"tp_rungs": [{"id": "a", "premium": 1.25, "qty": 1}]})
    assert r.status_code == 200
    with engine._tick_lock:               # the line fires before the write runs
        assert _tick(em, 1.26, 2)["reason"] == "TP_RUNG"
    release.set()
    _drain()
    saved = writes[-1]["rung_state"]["tp_rungs"][0]
    assert saved["hit"] is True


def test_merge_never_unfires_a_stored_line():
    stored = {"tp_rungs": [{"id": "a", "premium": 1.25, "qty": 1, "hit": True, "hit_premium": 1.26, "hit_at": "t"}]}
    stale = {"tp_rungs": [{"id": "a", "premium": 1.25, "qty": 1, "hit": False}, {"id": "b", "premium": 1.6, "qty": 1}]}
    merged = merge_rung_state(stored, stale)
    a = next(r for r in merged["tp_rungs"] if r["id"] == "a")
    assert a["hit"] is True and a["hit_premium"] == 1.26
    assert any(r["id"] == "b" for r in merged["tp_rungs"])
    # And the restored ladder doesn't re-fire it.
    em = _em()
    em.update_qty(1)
    em.restore_rungs({**merged, "tp1_qty_override": None})
    assert all(_tick(em, 1.30)["reason"] != "TP_RUNG" for _ in range(3))   # "a" stays fired


def test_lines_reserve_nothing_while_take_profit_is_off():
    em = _em()
    em.apply_overrides(tp_rungs=[{"premium": 1.6, "qty": 1}, {"premium": 1.7, "qty": 1}], current_price=1.20)
    reserved_free = em._free_qty()
    em.apply_overrides(tp_enabled=False)
    assert em._free_qty() == em.qty_remaining - 1
    assert len(em.rungs_public()) == 2                  # kept for a re-enable
    em.apply_overrides(tp_enabled=True)
    assert em._free_qty() == reserved_free              # reserving again
