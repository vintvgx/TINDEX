"""
Gate modes (daily / intraday / and / composite) and the composite score —
TODOs 91307fec, a3e2a3d9, constraint c8fc1694 (daily gate never replaced:
a strategy with no mode behaves exactly as before).
"""
import math
import os
import sys
from types import SimpleNamespace

import pandas as pd
import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from services import composite_technicals as ct  # noqa: E402
from services import entry_check_service as ecs  # noqa: E402


def _series(n: int, end: float, step: float, wiggle: float = 0.0, daily: bool = False) -> pd.Series:
    """Trending closes ending at `end`, with a small oscillation so RSI isn't
    pinned at 0/100. Daily series get a business-day index ending yesterday
    (the gate's daily path reads dates to decide replace-vs-append)."""
    vals = [end - (n - 1 - i) * step + wiggle * math.sin(i) for i in range(n)]
    if not daily:
        return pd.Series(vals, dtype=float)
    from datetime import datetime, timedelta
    yday = (datetime.now(ecs.ET) - timedelta(days=1)).date()
    idx = pd.bdate_range(end=yday, periods=n, tz="America/New_York")
    return pd.Series(vals, index=idx, dtype=float)


P = 767.0                                                  # "live" price in every test
UP_DAILY = _series(300, P - 2, 0.8, wiggle=3, daily=True)    # daily uptrend, price above EMA-20
DOWN_DAILY = _series(300, P + 40, -0.8, wiggle=3, daily=True)  # daily downtrend, price below EMAs
UP_5M = _series(200, P, 0.15, wiggle=0.05)
DOWN_5M = _series(200, P, -0.15, wiggle=0.05)


# ── composite score ────────────────────────────────────────────────────────────

@pytest.mark.parametrize("v,score", [(68, 2), (60, 2), (57, 1), (49, 0), (45, 0), (42, -1), (30, -2)])
def test_rsi_bands(v, score):
    assert ct._rsi_score(v) == score


def test_tiers():
    assert ct._tier(7) == "STRONG" and ct._tier(6) == "STRONG"
    assert ct._tier(5) == "MODERATE" and ct._tier(4) == "MODERATE"
    assert ct._tier(3) == "WATCH" and ct._tier(2) == "WATCH"
    assert ct._tier(1) == "NO_TRADE" and ct._tier(-9) == "NO_TRADE"


def test_distance_scores_mock_example():
    # Mock: SPY $767.04 vs VWAP $764.74 (+0.30%) → +1; vs ORH $764.02 (+0.40%) → +1
    c = ct.compute_composite("CALL", 767.04, vwap=764.74, orh=764.02, orl=760.0)
    by = {r["key"]: r for r in c["indicators"]}
    assert by["vwap"]["score"] == 1 and by["orb"]["score"] == 1
    # ≥ 0.5% beyond → ±2, below that ±1; PUT mirrors
    c = ct.compute_composite("CALL", 770.0, vwap=764.0, orh=769.0, orl=760.0)
    by = {r["key"]: r for r in c["indicators"]}
    assert by["vwap"]["score"] == 2      # +0.79%
    assert by["orb"]["score"] == 1       # +0.13%
    c = ct.compute_composite("PUT", 770.0, vwap=764.0, orh=769.0, orl=760.0)
    assert {r["key"]: r["score"] for r in c["indicators"]}["vwap"] == -2


def test_put_is_mirror_of_call():
    price = P
    kw = dict(daily_closes=UP_DAILY, closes_5m=UP_5M, vwap=price - 2, orh=price - 3, orl=price - 6)
    call = ct.compute_composite("CALL", price, **kw)
    put = ct.compute_composite("PUT", price, **kw)
    assert call["total"] == -put["total"]
    assert call["total"] >= 6 and call["tier"] == "STRONG"
    assert put["tier"] == "NO_TRADE"
    assert len(call["indicators"]) == 7 and call["max"] == 14


def test_missing_inputs_score_none_and_are_listed():
    c = ct.compute_composite("CALL", 100.0)
    assert c["total"] == 0
    assert all(r["score"] is None and not r["available"] for r in c["indicators"])
    assert len(c["missing"]) == 7


def test_orb_forming_is_no_data():
    c = ct.compute_composite("CALL", 100.0, orh=99.0, orl=98.0, orb_forming=True)
    orb = next(r for r in c["indicators"] if r["key"] == "orb")
    assert orb["score"] is None and orb["value"] == "Forming"


def test_daily_rsi_recovering_turning_signal():
    # Long decline then a two-day bounce: RSI below 50 but rising.
    closes = pd.concat([_series(100, 600, -1.5, wiggle=1), pd.Series([452.0, 455.0])], ignore_index=True)
    c = ct.compute_composite("CALL", 458.0, daily_closes=closes)
    rsi = next(r for r in c["indicators"] if r["key"] == "rsi_daily")
    assert "↗" in rsi["value"]
    assert any(t["title"] == "Daily RSI recovering" for t in c["turning"])


# ── evaluate_gate modes ────────────────────────────────────────────────────────

@pytest.fixture
def market(monkeypatch):
    """Daily downtrend + 5-min uptrend (the 2026-10-26 SPY shape)."""
    state = {"daily": DOWN_DAILY, "m5": UP_5M, "m5_calls": 0}
    monkeypatch.setattr(ecs, "_daily_closes", lambda t: state["daily"])

    def closes_5m(t, closes_1m=None):
        state["m5_calls"] += 1
        return state["m5"]
    monkeypatch.setattr(ecs, "_closes_5m", closes_5m)
    monkeypatch.setattr(ecs, "_intraday_bars", lambda t: None)
    return state


def _trend(gate):
    return next(r for r in gate["results"] if r["key"] == "trend")


def test_missing_mode_is_daily_and_never_touches_5m(market):
    price = P
    default = ecs.evaluate_gate("SPY", "CALL", ["trend", "rsi"], price)
    daily = ecs.evaluate_gate("SPY", "CALL", ["trend", "rsi"], price, mode="daily")
    unknown = ecs.evaluate_gate("SPY", "CALL", ["trend", "rsi"], price, mode="bogus")
    assert default["mode"] == daily["mode"] == unknown["mode"] == "daily"
    assert default["results"] == daily["results"] == unknown["results"]
    assert market["m5_calls"] == 0


def test_intraday_and_modes(market):
    price = P
    daily = ecs.evaluate_gate("SPY", "CALL", ["trend"], price, mode="daily")
    intra = ecs.evaluate_gate("SPY", "CALL", ["trend"], price, mode="intraday")
    both = ecs.evaluate_gate("SPY", "CALL", ["trend"], price, mode="and")
    assert not _trend(daily)["ok"]
    assert _trend(intra)["ok"] and intra["passed"]
    assert intra["rows"]["trend"]["timeframe"] == "5m"
    assert not _trend(both)["ok"] and not both["passed"]
    assert "daily ✗" in _trend(both)["note"] and "5-min ✓" in _trend(both)["note"]

    market["daily"] = UP_DAILY
    both = ecs.evaluate_gate("SPY", "CALL", ["trend"], price, mode="and")
    assert both["passed"]


def test_and_mode_fails_closed_without_5m(market):
    market["m5"] = None
    market["daily"] = UP_DAILY
    gate = ecs.evaluate_gate("SPY", "CALL", ["trend"], P, mode="and")
    assert not gate["passed"] and "no 5-min data" in _trend(gate)["note"]


def test_non_trend_factors_identical_across_modes(market):
    market["daily"] = UP_DAILY
    price = P
    for mode in ("daily", "intraday", "and"):
        g = ecs.evaluate_gate("SPY", "CALL", ["vwap", "orb"], price, vwap=price - 1, orh=price - 2, orl=price - 5, mode=mode)
        assert g["passed"], mode


def test_composite_mode_tiers(market, monkeypatch):
    price = P
    market["daily"] = UP_DAILY
    strong = ecs.evaluate_gate("SPY", "CALL", ["sector"], price, vwap=price - 2, orh=price - 3, orl=price - 6,
                               mode="composite")
    assert strong["mode"] == "composite" and strong["passed"] and not strong["needs_confirm"]
    assert strong["required"] == []  # `required` is ignored in composite mode

    def fake(tier, total):
        return lambda *a, **k: {"direction": "CALL", "total": total, "max": 14, "tier": tier, "turning": [],
                                "missing": [], "indicators": [{"key": "vwap", "label": "VWAP", "score": total,
                                                               "value": "Above", "detail": "", "available": True}]}
    monkeypatch.setattr(ct, "compute_composite", fake("MODERATE", 4))
    mod = ecs.evaluate_gate("SPY", "CALL", [], price, vwap=1, orh=1, orl=1, mode="composite")
    assert mod["passed"] and mod["needs_confirm"]
    monkeypatch.setattr(ct, "compute_composite", fake("WATCH", 3))
    watch = ecs.evaluate_gate("SPY", "CALL", [], price, vwap=1, orh=1, orl=1, mode="composite")
    assert not watch["passed"] and not watch["needs_confirm"]


def test_composite_fails_closed_with_no_data(monkeypatch):
    monkeypatch.setattr(ecs, "_daily_closes", lambda t: None)
    monkeypatch.setattr(ecs, "_closes_5m", lambda t, c=None: None)
    monkeypatch.setattr(ecs, "_intraday_bars", lambda t: None)
    gate = ecs.evaluate_gate("SPY", "CALL", [], 100.0, mode="composite")
    assert not gate["passed"] and "no indicator data" in gate["summary"]


# ── engine mode resolution ─────────────────────────────────────────────────────

def test_engine_gate_mode_resolution():
    from services.strategy.orb_engine import ORBEngine
    tr = SimpleNamespace(profile_key="TREND_RIDER")
    rev = SimpleNamespace(profile_key="REVERSAL")
    assert ORBEngine._gate_mode(tr, {}) == "daily"
    assert ORBEngine._gate_mode(tr, {"mode": "and"}) == "and"
    assert ORBEngine._gate_mode(tr, {"mode": "composite"}) == "composite"
    assert ORBEngine._gate_mode(rev, {"mode": "composite"}) == "daily"  # REVERSAL keeps the binary gate
    assert ORBEngine._gate_mode(rev, {"mode": "intraday"}) == "intraday"


# ── 5-min bucketing ────────────────────────────────────────────────────────────

def test_today_closes_5m_buckets_last_close(monkeypatch):
    from datetime import datetime
    today = datetime.now(ecs.ET).date()
    mk = lambda h, m: ecs.ET.localize(datetime(today.year, today.month, today.day, h, m))
    bars = [(mk(9, 29), 1.0), (mk(9, 30), 2.0), (mk(9, 34), 3.0), (mk(9, 35), 4.0), (mk(9, 39), 5.0)]
    assert ecs._today_closes_5m(bars) == [3.0, 5.0]


# ── MODERATE → confirm-first, fail closed ──────────────────────────────────────

def _pause_self(persist_ok: bool):
    from unittest.mock import MagicMock
    eng = SimpleNamespace(
        strategy_id="s1", ticker="SPY", profile_key="TREND_RIDER", paper=True, fib_levels={},
        _compute_confidence=lambda d, p: (60.0, {}),
        logger=MagicMock(), debug=MagicMock(), notifier=MagicMock(), stream_manager=None,
        _execute_entry=MagicMock(), _pending_confirmation=None,
    )
    eng.logger.create_pending_confirmation.return_value = {"id": "p1"} if persist_ok else None
    return eng


@pytest.mark.parametrize("require_confirm,entered", [(True, False), (False, True)])
def test_pause_persist_failure(require_confirm, entered):
    from services.strategy.orb_engine import ORBEngine
    eng = _pause_self(persist_ok=False)
    profile = {"max_loss_pct": 0.3, "tp1_mult": 1.15, "tp2_mult": 2.5}
    ORBEngine._pause_for_confirmation(eng, "CALL", 767.0, {"symbol": "SPY261026C00770000", "strike": 770, "ask": 1.0},
                                      2, profile, require_confirm=require_confirm)
    # composite MODERATE never falls back to entering; plain opt-in still does
    assert eng._execute_entry.called is entered
