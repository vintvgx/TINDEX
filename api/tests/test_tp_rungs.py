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
