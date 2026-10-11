"""Invest tab (handoff spec 6): revenue FY labeling from fiscal-year end
dates, consensus counts, and the thesis payload contract."""
from datetime import datetime

import pytest

pytest.importorskip("pytz")

from services.ticker_brief.fundamentals import consensus_counts, metrics_from_info, revenue_series  # noqa: E402
from services.thesis.thesis_queue import clean_ticker, validate_thesis  # noqa: E402


def test_revenue_fy_labels_follow_fiscal_year_end():
    # NVDA's FY ends in late January: FY26 = year ending Jan 2026.
    acts = [(datetime(2026, 1, 25), 215.9e9), (datetime(2025, 1, 26), 130.5e9),
            (datetime(2024, 1, 28), 60.9e9), (datetime(2023, 1, 29), 27.0e9), (datetime(2022, 1, 30), 26.9e9)]
    est = {"0y": {"avg": 411.7e9, "low": 403.2e9, "high": 426.9e9, "analysts": 50},
           "+1y": {"avg": 692.2e9, "low": 506.5e9, "high": 778.5e9, "analysts": 57}}
    r = revenue_series(acts, est)
    assert [b["label"] for b in r["bars"]] == ["FY23", "FY24", "FY25", "FY26", "FY27E", "FY28E"]
    assert r["has_estimates"] and r["analysts"] == 57


def test_revenue_never_invents_estimates():
    r = revenue_series([(datetime(2025, 6, 30), 5e8)], {})
    assert [b["label"] for b in r["bars"]] == ["FY25"] and not r["has_estimates"]
    assert revenue_series([], {"0y": {"avg": 1.0}})["bars"] == []


def test_consensus_counts_current_month():
    rows = [{"period": "0m", "strongBuy": 10, "buy": 31, "hold": 8, "sell": 1, "strongSell": 0},
            {"period": "-1m", "buy": 99}]
    assert consensus_counts(rows) == {"buy": 41, "hold": 8, "sell": 1}
    assert consensus_counts([]) is None


def test_metrics_are_null_safe():
    m = metrics_from_info({})
    assert m["pe_trailing"] is None and m["beta"] is None and m["dividend_yield_pct"] is None


def test_thesis_contract():
    assert validate_thesis({"verdict": "HOLD", "summary": "x"}) is None
    assert validate_thesis({"verdict": "HOLD"}) == "thesis.summary is required"
    assert validate_thesis({"verdict": "HOLD", "summary": "x", "bull": "nope"})
    assert validate_thesis({"verdict": "HOLD", "summary": "x", "conviction": 11})
    assert clean_ticker("$nvda") == "NVDA" and clean_ticker("bad ticker") is None
