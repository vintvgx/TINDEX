"""At 09:45 the service ORB comes from the 09:30-09:45 1m history, not from
whatever bars the stream happened to see.

2026-10-13: QQQ's orb_ranges row was 742.69-743.43 (one 1m bar, volume 7108)
while the real opening range was 738.84-743.62 — a late stream / mid-window
restart left a sliver, and the chart drew that sliver as today's ORB box.

Run from api/:  python -m pytest tests/test_orb_reconcile.py
"""
import asyncio
from decimal import Decimal

from services.tindex.orb_service import OrbService

SLIVER = {"high": Decimal("743.43"), "low": Decimal("742.69"), "open": Decimal("743.43"), "volume": 7108}
FULL = {"high": Decimal("743.62"), "low": Decimal("738.84"), "open": Decimal("740.10"),
        "volume": 900000, "complete": True}


def _svc(streamed, responses):
    """responses: per-call history results (last one repeats)."""
    svc = OrbService.__new__(OrbService)  # no streaming/supabase wiring needed
    svc.orb_ranges = streamed
    svc.ORB_HISTORY_RETRY_SEC = 0
    calls = []

    async def fake_hist(ticker):
        calls.append(ticker)
        return responses[min(len(calls), len(responses)) - 1]

    svc.fetch_orb_range_historical = fake_hist
    return svc, calls


def _run(svc, tickers=("QQQ",)):
    asyncio.run(svc._finalize_orb_ranges_from_history(set(tickers)))


def test_complete_history_replaces_partial_stream():
    svc, calls = _svc({"QQQ": dict(SLIVER)}, [FULL])
    _run(svc)
    r = svc.orb_ranges["QQQ"]
    assert (r["high"], r["low"], r["open"], r["volume"]) == (
        Decimal("743.62"), Decimal("738.84"), Decimal("740.10"), 900000)
    assert calls == ["QQQ"]


def test_complete_history_is_authoritative_even_if_stream_is_wider():
    wider = {**SLIVER, "high": Decimal("744.50")}
    svc, _ = _svc({"QQQ": wider}, [FULL])
    _run(svc)
    assert svc.orb_ranges["QQQ"]["high"] == Decimal("743.62")


def test_waits_for_0944_bar_before_trusting_history():
    lagging = {**FULL, "low": Decimal("739.50"), "complete": False}
    svc, calls = _svc({"QQQ": dict(SLIVER)}, [lagging, lagging, FULL])
    _run(svc)
    assert len(calls) == 3
    assert svc.orb_ranges["QQQ"]["low"] == Decimal("738.84")


def test_never_complete_falls_back_to_union():
    partial = {"high": Decimal("743.20"), "low": Decimal("738.84"), "open": Decimal("740.10"),
               "volume": 800000, "complete": False}
    svc, calls = _svc({"QQQ": dict(SLIVER)}, [partial])
    _run(svc)
    r = svc.orb_ranges["QQQ"]
    assert (r["high"], r["low"]) == (Decimal("743.43"), Decimal("738.84"))
    assert len(calls) == OrbService.ORB_HISTORY_ATTEMPTS


def test_no_history_keeps_stream():
    svc, _ = _svc({"QQQ": dict(SLIVER)}, [None])
    _run(svc)
    assert svc.orb_ranges["QQQ"] == SLIVER


def test_ticker_with_no_streamed_bars_gets_history():
    svc, _ = _svc({}, [FULL])
    _run(svc)
    assert svc.orb_ranges["QQQ"]["low"] == Decimal("738.84")


# ── Persisting a corrected range ─────────────────────────────────────────────
# A bare upsert() keyed on the id primary key, so it could only insert: the
# 09:45 save worked, but a restart re-saving a corrected range collided with
# today's existing row and failed silently — the sliver stuck all day.

from datetime import datetime  # noqa: E402
from types import SimpleNamespace  # noqa: E402
from unittest.mock import MagicMock  # noqa: E402

import pytz  # noqa: E402

import services.tindex.orb_service as orb_mod  # noqa: E402


class _FakeTable:
    def __init__(self, rows):
        self.rows, self._op, self._payload, self._filters = rows, None, None, {}

    def update(self, payload):
        self._op, self._payload = "update", payload
        return self

    def insert(self, payload):
        self._op, self._payload = "insert", payload
        return self

    def upsert(self, payload, **_):  # orb_monitoring_state etc.
        self._op = "noop"
        return self

    def eq(self, col, val):
        self._filters[col] = val
        return self

    def execute(self):
        if self._op == "update":
            hit = [r for r in self.rows
                   if all(r.get(k) == v for k, v in self._filters.items())]
            for r in hit:
                r.update(self._payload)
            return SimpleNamespace(data=hit)
        if self._op == "insert":
            self.rows.append(dict(self._payload))
            return SimpleNamespace(data=[self._payload])
        return SimpleNamespace(data=[])


def _saving_svc(rows, monkeypatch):
    svc = OrbService.__new__(OrbService)
    svc.orb_ranges = {}
    svc._previous_close_cache = {}
    svc._state_cache = MagicMock()
    et = pytz.timezone("America/New_York")
    svc.get_current_et_time = lambda: et.localize(datetime(2026, 10, 13, 11, 38))
    svc.supabase = SimpleNamespace(table=lambda name: _FakeTable(rows if name == "orb_ranges" else []))
    monkeypatch.setattr(orb_mod, "get_gap_analysis_service",
                        lambda: SimpleNamespace(get_cached_prior=lambda *_: None))
    return svc


def test_save_overwrites_todays_existing_row(monkeypatch):
    rows = [{"ticker": "QQQ", "trade_date": "2026-10-13", "orb_high": 743.43, "orb_low": 742.69}]
    svc = _saving_svc(rows, monkeypatch)
    asyncio.run(svc.save_orb_range("QQQ", FULL))
    assert len(rows) == 1
    assert (rows[0]["orb_high"], rows[0]["orb_low"]) == (743.62, 738.84)


def test_save_inserts_when_no_row_yet(monkeypatch):
    rows = []
    svc = _saving_svc(rows, monkeypatch)
    asyncio.run(svc.save_orb_range("QQQ", FULL))
    assert len(rows) == 1 and rows[0]["orb_low"] == 738.84
