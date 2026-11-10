"""
Composite sides + chart lens (spec 2026-11-10 §2.2). The PUT side is scored
by its own rules; with today's bands it must equal the old sign-flip exactly,
because the engine's composite gate is frozen for the November paper run.
"""
import os
import sys

import pandas as pd

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from services import composite_technicals as ct  # noqa: E402
from services.entry_check_service import chart_lens  # noqa: E402


def test_put_rules_score_each_indicator_for_the_put():
    for v in (25, 39.9, 40, 44.9, 45, 50, 54.9, 55, 59.9, 60, 75):
        assert ct._rsi_score(v, False) == -ct._rsi_score(v, True)
    assert ct._trend_score("Bearish", False) == 2 and ct._trend_score("Bullish", False) == -2
    assert ct._macd_score(-1.0, -0.5, False) == 2 and ct._macd_score(0.2, 0.5, False) == 1
    assert ct._distance_score(-1, -0.8, False) == 2 and ct._distance_score(1, 0.1, False) == -1


def test_put_total_positive_when_the_tape_favours_a_put():
    closes = pd.Series([100 - i * 0.6 for i in range(60)], index=pd.date_range("2026-08-01", periods=60))
    c5 = pd.Series([64 - i * 0.05 for i in range(70)])
    put = ct.compute_composite("PUT", 60.4, daily_closes=closes, closes_5m=c5, vwap=61.5, orh=62.0, orl=61.0)
    call = ct.compute_composite("CALL", 60.4, daily_closes=closes, closes_5m=c5, vwap=61.5, orh=62.0, orl=61.0)
    assert put["total"] > 0 > call["total"]
    assert put["tier"] in ("STRONG", "MODERATE")      # graded on its own side


def _comp(call, put):
    return {"CALL": {"total": call, "tier": ct._tier(call)}, "PUT": {"total": put, "tier": ct._tier(put)}}


def _verdicts(call_dec, put_dec):
    return {"CALL": {"decision": call_dec, "score": 1}, "PUT": {"decision": put_dec, "score": 1}}


def test_lens_nov9_call_side_with_daily_put_labelled():
    # Nov 9: SPY above VWAP + ORH, 5-min trend bullish, CALL +5 MODERATE,
    # while the daily verdict said PUT ENTER.
    rows = {"vwap": {"value": 744.0}, "orb": {"position": "Above high"}}
    lens = chart_lens(749.0, _comp(5, -5), rows, {"trend": {"label": "Bullish"}},
                      _verdicts("WAIT", "ENTER"), "PUT")
    assert lens["intraday"]["side"] == "CALL"
    assert lens["intraday"]["text"] == "Intraday: CALL +5 MODERATE"
    assert not lens["agree"]
    assert lens["label"] == "Daily: PUT (verdict ENTER) · Intraday: CALL +5 MODERATE"


def test_lens_wait_shows_both_totals():
    rows = {"vwap": {"value": 744.0}, "orb": {"position": "Inside"}}
    lens = chart_lens(745.0, _comp(5, -5), rows, {"trend": {"label": "Bullish"}},
                      _verdicts("WAIT", "WAIT"), "WAIT")
    assert lens["intraday"]["side"] == "WAIT"
    assert lens["intraday"]["text"] == "Intraday: WAIT (CALL +5 · PUT -5)"


def test_lens_put_side_mirror():
    rows = {"vwap": {"value": 750.0}, "orb": {"position": "Below low"}}
    lens = chart_lens(745.0, _comp(-6, 6), rows, {"trend": {"label": "Bearish"}},
                      _verdicts("DONT_ENTER", "ENTER"), "PUT")
    assert lens["intraday"]["side"] == "PUT" and lens["agree"]
