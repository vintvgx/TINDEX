"""
Chart / Edit-card TP lines — one rung ladder per trade (spec 2026-11-10
§4.5, §4.7, §7, §9). Reproduces the §5 worked example and the replacement
rule; pins that a line can never sell contracts another level owns.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from services.strategy.exit_manager import ExitManager  # noqa: E402
from services.strategy.profiles import get_profile  # noqa: E402

ORB = {"orh": 770.0, "orl": 766.0}
# SPY 770C ×4: entry $1.00, TP1 $1.30, TP2 $1.90 (worked example, §5).
SPEC = {"tp1_mult": 1.30, "min_tp1_dollars": 0.0, "tp2_mult": 1.90, "min_tp2_dollars": 0.0,
        "tp1_close_pct": 0.50, "tp2_close_pct": 0.35}


def _em(qty=4, entry=1.00, **over):
    return ExitManager(entry, qty, ORB, "CALL", "23:59",
                       get_profile("TREND_RIDER", {**SPEC, **over}), is_zero_dte=False)


def _tick(em, price, n=1):
    a = None
    for _ in range(n):
        a = em.evaluate(price, 768.0)
        if a["type"] != "HOLD":
            em.update_qty(a["qty"])
    return a


def _ladder(em):
    return [(x["label"], x["premium"], x["qty"], x["source"]) for x in em.to_dict()["tp_ladder"]]


def test_untouched_trade_has_no_rungs_and_engine_ladder():
    em = _em()
    assert em.to_dict()["tp_rungs"] == []
    assert _ladder(em) == [("TP1", 1.3, 2, "engine"), ("TP2", 1.9, 1, "engine")]


def test_worked_example_first_line_carves_from_tp1():
    em = _em()
    em.apply_overrides(tp_rungs=[{"premium": 1.57, "qty": 1, "stock_price": 769.20, "source": "chart-long-press"}])
    # TP1 keeps 1 (2 − 1 taken by the line), line sells 1, TP2 1, runner 1.
    assert _ladder(em) == [("TP1", 1.3, 1, "engine"), ("TP2", 1.57, 1, "chart-long-press"),
                           ("TP3", 1.9, 1, "engine")]
    assert _tick(em, 1.30, 2)["reason"] == "TP1" and em.qty_remaining == 3
    a = _tick(em, 1.57, 2)
    assert (a["reason"], a["qty"]) == ("TP_RUNG", 1) and em.qty_remaining == 2
    a = _tick(em, 1.90)
    assert (a["reason"], a["qty"]) == ("TP2", 1) and em.qty_remaining == 1   # runner kept


def test_first_line_with_tp1_full_qty_replaces_tp1():
    em = _em()
    em.apply_overrides(tp_rungs=[{"premium": 1.40, "qty": 2}])
    assert em.to_dict()["tp1_replaced"] is True
    assert [x[0:3] for x in _ladder(em)] == [("TP1", 1.4, 2), ("TP2", 1.9, 1)]
    assert _tick(em, 1.32, 3)["type"] == "HOLD"          # engine TP1 $1.30 does NOT fire
    a = _tick(em, 1.40, 2)
    assert (a["reason"], a["qty"]) == ("TP_RUNG", 2)
    assert em.tp1_hit and em.be_stop_active                # the line fired AS TP1


def test_further_lines_insert_and_reserve_from_the_pool():
    em = _em(qty=6)
    em.apply_overrides(tp_rungs=[{"id": "a", "premium": 1.50, "qty": 1},
                                 {"id": "b", "premium": 2.20, "qty": 2}])
    labels = _ladder(em)
    assert [x[1] for x in labels] == [1.3, 1.5, 1.9, 2.2]        # premium order
    assert sum(x[2] for x in labels) + 1 <= 6


def test_line_cannot_sell_twice():
    em = _em()
    em.apply_overrides(tp_rungs=[{"premium": 1.20, "qty": 1}])
    assert _tick(em, 1.20, 2)["reason"] == "TP_RUNG"
    for _ in range(4):
        assert _tick(em, 1.22)["reason"] != "TP_RUNG"


def test_engine_level_below_a_reached_line_fires_first():
    em = _em()
    em.apply_overrides(tp_rungs=[{"premium": 1.57, "qty": 1}])
    assert _tick(em, 1.60, 2)["reason"] == "TP1"           # $1.30 before $1.57


def test_validation_duplicate_overflow_and_one_contract():
    em = _em()
    with pytest.raises(ValueError, match="Already a line"):
        em.apply_overrides(tp_rungs=[{"premium": 1.30, "qty": 1}])     # on TP1
    with pytest.raises(ValueError, match="Already a line"):
        em.apply_overrides(tp_rungs=[{"premium": 1.5, "qty": 1}, {"premium": 1.5, "qty": 1}])
    with pytest.raises(ValueError, match="At most 3"):
        em.apply_overrides(tp_rungs=[{"premium": 1.4 + i / 10, "qty": 1} for i in range(4)])
    with pytest.raises(ValueError, match="Not enough contracts"):
        em.apply_overrides(tp_rungs=[{"premium": 1.5, "qty": 1}, {"premium": 1.7, "qty": 2}])
    assert em.to_dict()["tp_rungs"] == []                   # nothing applied on a rejection
    one = _em(qty=1)
    with pytest.raises(ValueError, match="At most 0"):
        one.apply_overrides(tp_rungs=[{"premium": 1.5, "qty": 1}])


def test_delete_returns_tp1_its_qty():
    em = _em()
    em.apply_overrides(tp_rungs=[{"premium": 1.40, "qty": 2}])
    em.apply_overrides(tp_rungs=[])
    assert not em.to_dict()["tp1_replaced"]
    assert _ladder(em)[0][:3] == ("TP1", 1.3, 2)


def test_cascade_and_tp2_never_sell_reserved_contracts():
    em = _em(qty=6, tp2_close_pct=1.0)
    _tick(em, 1.30, 2)                                       # TP1 sells 3 → 3 left
    em.apply_overrides(tp_rungs=[{"premium": 2.50, "qty": 1}])
    a = _tick(em, 1.90)
    # Full-close TP2 on a laddered trade: only the free contract — the line's
    # contract and the runner stay.
    assert (a["reason"], a["qty"]) == ("TP2", 1) and em.qty_remaining == 2


def test_rung_state_round_trips_for_restart():
    em = _em()
    em.apply_overrides(tp_rungs=[{"premium": 1.40, "qty": 2, "source": "chart-long-press"}])
    _tick(em, 1.40, 2)
    state = em.rungs_state()
    fresh = _em()
    fresh.update_qty(2)
    fresh.restore_rungs(state)
    assert fresh.to_dict()["tp_rungs"][0]["hit"] is True
    assert fresh.tp1_hit and fresh.be_stop_active
    assert _tick(fresh, 1.45, 3)["reason"] != "TP_RUNG"      # never re-fires


def test_ladder_reports_the_tp1_carve():
    em = _em()
    em.apply_overrides(tp_rungs=[{"premium": 1.57, "qty": 1}])
    line = next(x for x in em.ladder() if x["source"] != "engine")
    assert line["from_tp1"] == 1 and not line["replaces_tp1"]


def test_push_ladder_projects_stock_prices_from_delta():
    from types import SimpleNamespace
    from services.strategy.orb_engine import ORBEngine
    em = _em()
    em.apply_overrides(tp_rungs=[{"premium": 1.57, "qty": 1}])
    eng = SimpleNamespace(_overlay_delta=0.42, _last_underlying_price=768.32)
    ladder = ORBEngine._ladder_with_stock(eng, em, 1.20)
    assert [x["stock_price"] for x in ladder] == [768.56, 769.2, 769.99]   # §5 worked example
    eng._overlay_delta = None
    assert all(x["stock_price"] is None for x in ORBEngine._ladder_with_stock(eng, em, 1.20))   # never guessed


# ── PR #121 review fixes ─────────────────────────────────────────────────────

def test_rejects_tp_already_reached_unless_confirmed():
    em = _em()
    with pytest.raises(ValueError, match="already reached"):
        em.apply_overrides(tp_rungs=[{"premium": 1.15, "qty": 1}], current_price=1.20)
    em.apply_overrides(tp_rungs=[{"premium": 1.15, "qty": 1}], current_price=1.20, allow_immediate=True)
    assert em.rungs_public()[0]["premium"] == 1.15
    # Re-saving the ladder with that unchanged line isn't a new "immediate" TP.
    rid = em.rungs_public()[0]["id"]
    em.apply_overrides(tp_rungs=[{"id": rid, "premium": 1.15, "qty": 1}, {"premium": 1.6, "qty": 1}],
                       current_price=1.25)


def test_rejects_tp_at_or_below_entry_and_skips_price_check_without_quote():
    em = _em()
    with pytest.raises(ValueError, match="below entry"):
        em.apply_overrides(tp_rungs=[{"premium": 0.95, "qty": 1}])
    em.apply_overrides(tp_rungs=[{"premium": 1.6, "qty": 1}], current_price=None)   # no crash


def test_rejects_lines_while_take_profit_is_off():
    em = _em()
    em.apply_overrides(tp_enabled=False)
    with pytest.raises(ValueError, match="Take profit is off"):
        em.apply_overrides(tp_rungs=[{"premium": 1.6, "qty": 1}])
    em.apply_overrides(tp_rungs=[])          # clearing is always allowed


def test_stop_at_or_below_an_armed_floor_is_refused():
    em = _em(sl_grace_enabled=True, sl_grace_seconds=300, sl_outer_floor_pct=0.5)   # floor $0.50
    with pytest.raises(ValueError, match="below the floor"):
        em.apply_overrides(hard_stop=0.45)
    em.apply_overrides(hard_stop=0.60)                                              # above the floor: ok
    em.apply_overrides(sl_floor_enabled=False)
    em.apply_overrides(hard_stop=0.45)                                              # floor off: ok


def test_restart_seeds_cascade_peak_from_a_line_that_fired_as_tp1():
    from types import SimpleNamespace
    from services.strategy.orb_engine import ORBEngine
    em = _em()
    em.apply_overrides(tp_rungs=[{"premium": 1.45, "qty": 2}])
    _tick(em, 1.47, 2)
    fresh = _em()
    fresh.update_qty(2)
    fresh.restore_rungs(em.rungs_state())
    eng = SimpleNamespace(exit_manager=fresh)
    ORBEngine._seed_restored_cascade_peak(eng, {"tp1_price": 1.30}, [], 1.00)
    assert fresh._cascade_peak == pytest.approx(1.47)     # the line's fill, not engine TP1 $1.30


# Nov 3 SPY RIDER paper trade shape (spec §10): entry $1.48 ×4, TP1 $1.924,
# TP2 $2.38, SL $1.20 — replayed through the real ExitManager.
NOV3 = {"tp1_mult": 1.30, "min_tp1_dollars": 0.0, "tp2_mult": 1.50, "min_tp2_dollars": 0.90,
        "max_loss_pct": 1 - 1.20 / 1.48, "tp1_close_pct": 0.50, "tp2_close_pct": 0.35}
NOV3_PATH = [1.50, 1.62, 1.80, 1.93, 1.95, 2.02, 2.10, 2.12, 2.20, 2.31, 2.40, 2.41, 2.25, 2.05, 1.90]


def _nov3(mod):
    return mod.ExitManager(1.48, 4, ORB, "CALL", "23:59", get_profile("TREND_RIDER", dict(NOV3)), is_zero_dte=False)


def _run(em, path):
    out = []
    for p in path:
        a = em.evaluate(p, 768.0)
        if a["type"] != "HOLD":
            em.update_qty(a["qty"])
        out.append((a["type"], a["qty"], a["reason"], em.qty_remaining, round(em.hard_stop, 4)))
    return out


def test_nov3_shape_levels():
    em = _nov3(__import__("services.strategy.exit_manager", fromlist=["x"]))
    assert (round(em.tp1, 3), round(em.tp2, 2), round(em.hard_stop, 2)) == (1.924, 2.38, 1.20)


def test_nov3_shape_untouched_matches_master_exactly():
    import importlib.util, subprocess, tempfile
    src = subprocess.run(["git", "show", "origin/Master:api/services/strategy/exit_manager.py"],
                         capture_output=True, text=True, cwd=os.path.dirname(__file__))
    if src.returncode != 0:
        pytest.skip("origin/Master not available")
    with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False) as f:
        f.write(src.stdout)
    spec = importlib.util.spec_from_file_location("em_master", f.name)
    master = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(master)
    import services.strategy.exit_manager as current
    assert _run(_nov3(current), NOV3_PATH) == _run(_nov3(master), NOV3_PATH)


def test_nov3_shape_with_a_chart_line_sells_it_once():
    import services.strategy.exit_manager as current
    em = _nov3(current)
    em.apply_overrides(tp_rungs=[{"premium": 2.10, "qty": 1, "source": "chart-long-press"}], current_price=1.50)
    seq = _run(em, NOV3_PATH)
    reasons = [r for (_t, _q, r, _rem, _s) in seq if r in ("TP1", "TP_RUNG", "TP2")]
    assert reasons == ["TP1", "TP_RUNG", "TP2"]           # TP1 1, line 1, TP2 1
    assert seq[-1][3] == 1                                 # runner kept
    assert sum(1 for s in seq if s[2] == "TP_RUNG") == 1   # never twice
