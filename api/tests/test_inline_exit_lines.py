"""
Chart long-press + / TP / SL chips (spec chart-inline-exit-lines 2026-11-10):
the backend rules the chips rely on — a line per contract (the runner may
take one), a TP tap turns take profit on, and a stop set by STOCK price that
confirms on 1m closes and then follows the normal SL grace flow.

Run from api/:  python -m pytest tests/test_inline_exit_lines.py
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from services.strategy.exit_manager import ExitManager  # noqa: E402
from services.strategy.profiles import get_profile  # noqa: E402

ORB = {"orh": 770.0, "orl": 766.0}
SPEC = {"tp1_mult": 1.30, "min_tp1_dollars": 0.0, "tp2_mult": 1.90, "min_tp2_dollars": 0.0,
        "tp1_close_pct": 0.50, "tp2_close_pct": 0.35}


def _em(qty=4, direction="CALL"):
    return ExitManager(1.00, qty, ORB, direction, "23:59",
                       get_profile("TREND_RIDER", dict(SPEC)), is_zero_dte=False)


def _tick(em, price, stock=768.0, n=1):
    a = None
    for _ in range(n):
        a = em.evaluate(price, stock)
        if a["type"] != "HOLD":
            em.update_qty(a["qty"])
    return a


def _bars(em, close, n):
    for _ in range(n):
        em.on_underlying_bar(close + 0.05, close)


# ── TP: a line per contract, the runner may take one ──────────────────────

def test_four_stock_lines_on_four_contracts_then_the_fifth_is_refused():
    em = _em()
    lines = [{"stock_price": 769.0 + i, "qty": 1, "source": "chart-chip"} for i in range(4)]
    em.apply_overrides(tp_rungs=lines, current_underlying=768.0)
    assert sum(r["qty"] for r in em.rungs_public()) == 4
    assert next((x["qty"] for x in em.ladder() if x["key"] == "tp1"), 0) == 0   # TP1 gave its contract up
    with pytest.raises(ValueError, match="All 4 contracts already have TP lines"):
        em.apply_overrides(tp_rungs=lines + [{"stock_price": 774.0, "qty": 1}], current_underlying=768.0)


def test_one_contract_line_takes_the_runner_and_closes_the_trade():
    em = _em(qty=1)
    em.apply_overrides(tp_rungs=[{"stock_price": 769.5, "qty": 1}], current_underlying=768.0)
    a = _tick(em, 1.10, stock=769.6, n=em._tp1_ticks_needed)
    assert (a["type"], a["reason"], a["qty"]) == ("CLOSE_ALL", "TP_RUNG", 1)
    assert em.qty_remaining == 0


def test_last_line_sells_the_runner_too():
    em = _em(qty=2)
    em.apply_overrides(tp_rungs=[{"stock_price": 769.0, "qty": 1}, {"stock_price": 770.0, "qty": 1}],
                       current_underlying=768.0)
    a = _tick(em, 1.10, stock=769.1, n=em._tp1_ticks_needed)
    assert (a["reason"], a["qty"]) == ("TP_RUNG", 1) and em.qty_remaining == 1
    a = _tick(em, 1.12, stock=770.1, n=em._tp1_ticks_needed)
    assert (a["type"], a["reason"]) == ("CLOSE_ALL", "TP_RUNG") and em.qty_remaining == 0


# ── TP-off: a TP tap turns take profit on ─────────────────────────────────

def test_tp_tap_while_tp_off_turns_it_on():
    em = _em()
    em.apply_overrides(tp_enabled=False)
    with pytest.raises(ValueError, match="Take profit is off"):
        em.apply_overrides(tp_rungs=[{"stock_price": 770.0, "qty": 1}], current_underlying=768.0)
    changed = em.apply_overrides(tp_rungs=[{"stock_price": 770.0, "qty": 1}], tp_enabled=True,
                                 current_underlying=768.0)
    assert changed["tp_enabled"] is True and em.to_dict()["tp_enabled"] is True
    assert len(em.rungs_public()) == 1


def test_rejected_line_leaves_tp_off():
    em = _em()
    em.apply_overrides(tp_enabled=False)
    with pytest.raises(ValueError):   # below the stock: already reached for a CALL
        em.apply_overrides(tp_rungs=[{"stock_price": 767.0, "qty": 1}], tp_enabled=True,
                           current_underlying=768.0)
    assert em.to_dict()["tp_enabled"] is False and em.rungs_public() == []


# ── SL by stock price ─────────────────────────────────────────────────────

def test_stock_stop_must_sit_on_the_adverse_side():
    em = _em()
    with pytest.raises(ValueError, match="A stop sits below the current price"):
        em.apply_overrides(sl_stock_price=768.5, current_underlying=768.0)
    put = _em(direction="PUT")
    with pytest.raises(ValueError, match="A stop sits above the current price"):
        put.apply_overrides(sl_stock_price=767.5, current_underlying=768.0)


def test_sl_tap_moves_the_one_stop():
    em = _em()
    em.apply_overrides(sl_stock_price=767.0, current_underlying=768.0)
    em.apply_overrides(sl_stock_price=766.4, current_underlying=768.0)
    assert em.to_dict()["sl_stock_price"] == 766.4


def test_stock_stop_fires_on_confirmed_closes_and_sells_all():
    em = _em()
    em.apply_overrides(sl_stock_price=767.0, current_underlying=768.0, sl_grace_minutes=None)
    need = max(1, em._sl_ticks_needed)
    # Premium dips under the old premium stop (above the floor): inert
    # while a stock stop is set.
    assert em._sl_outer_floor is None or em._sl_outer_floor < em.hard_stop - 0.01
    assert _tick(em, em.hard_stop - 0.01, n=em._sl_ticks_needed + 1)["type"] == "HOLD"
    _bars(em, 766.9, need - 1)
    assert _tick(em, 0.80)["type"] == "HOLD"                      # not confirmed yet
    _bars(em, 767.2, 1)                                            # a close back above resets
    _bars(em, 766.9, need)
    a = _tick(em, 0.80)
    assert (a["type"], a["reason"], a["qty"]) == ("CLOSE_ALL", "HARD_STOP", 4)


def test_stock_stop_goes_through_the_sl_grace_window():
    em = _em()
    em.apply_overrides(sl_stock_price=767.0, current_underlying=768.0, sl_grace_minutes=5)
    _bars(em, 766.9, max(1, em._sl_ticks_needed))
    a = _tick(em, 0.80)
    assert (a["type"], a["reason"]) == ("HOLD", "SL_GRACE")


def test_breakeven_stop_still_protects_after_tp1_with_a_stock_stop():
    em = _em()
    em.apply_overrides(sl_stock_price=767.0, current_underlying=768.0)
    assert _tick(em, 1.30, n=em._tp1_ticks_needed)["reason"] == "TP1"
    assert em.be_stop_active
    em.apply_overrides(be_grace_seconds=0)
    a = _tick(em, em.hard_stop - 0.01, n=em._sl_ticks_needed)
    assert a["type"] == "CLOSE_ALL" and a["reason"] in ("BREAKEVEN_STOP", "RUNNER_FLOOR_STOP")


def test_clearing_and_sl_off():
    em = _em()
    em.apply_overrides(sl_stock_price=767.0, current_underlying=768.0)
    em.apply_overrides(sl_stock_price=None)
    assert em.to_dict()["sl_stock_price"] is None
    em.apply_overrides(sl_stock_price=767.0, current_underlying=768.0)
    changed = em.apply_overrides(sl_enabled=False)
    assert changed["sl_stock_price"] is None and em.to_dict()["sl_enabled"] is False


def test_untouched_trade_has_no_stock_stop_and_premium_stop_unchanged():
    em = _em()
    assert em.to_dict()["sl_stock_price"] is None
    a = _tick(em, em.hard_stop - 0.01, n=em._sl_ticks_needed)
    assert a["reason"] in ("HARD_STOP", "SL_GRACE")


def test_engine_tp_fills_are_recorded_for_the_realized_percent():
    em = _em()
    _tick(em, 1.31, n=em._tp1_ticks_needed)
    tp1 = next(x for x in em.ladder() if x["key"] == "tp1")
    assert tp1["hit"] and tp1["hit_premium"] == 1.31
