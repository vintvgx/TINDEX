"""Unified P&L (handoff spec 5): period bucketing by ET close date, fee
estimate, and partial exits of still-open trades."""
from datetime import datetime, timezone

from services.strategy.pnl_summary import compute_realized

NOW = datetime(2026, 10, 9, 19, 0, tzinfo=timezone.utc)  # Fri 3:00 PM ET


def _rows():
    return [
        # closed today 2:30 PM ET, naive-UTC string as the logger writes it
        {"pnl": 120, "qty_entered": 3, "qty_exited": 3, "exit_time": "2026-10-09T18:30:00", "exit_reason": "TP2"},
        # 11:30 PM ET yesterday = 03:30Z today — must NOT count as today
        {"pnl": -50, "qty_entered": 1, "qty_exited": 1, "exit_time": "2026-10-09T03:30:00+00:00", "exit_reason": "SL"},
        # expired worthless 20 days ago: entry-side fee only
        {"pnl": -80, "qty_entered": 2, "qty_exited": 2, "exit_time": "2026-09-19T20:00:00", "exit_reason": "EXPIRED_WORTHLESS"},
        # last year
        {"pnl": 500, "qty_entered": 1, "qty_exited": 1, "exit_time": "2025-12-30T20:00:00", "exit_reason": "TP1"},
        # still open, TP1 partial taken today
        {"pnl": 30, "qty_entered": 3, "qty_exited": 1, "exit_time": None,
         "exit_stages": [{"qty": 1, "pnl": 30, "time": "2026-10-09T15:00:00"}]},
        # actual fees recorded (phase 2) win over the estimate
        {"pnl": 10, "qty_entered": 1, "qty_exited": 1, "exit_time": "2026-10-09T17:00:00", "fees": 1.3},
    ]


def test_periods():
    out, max_exit = compute_realized(_rows(), NOW)
    assert out["today"] == {"realized_gross": 160.0, "fees": 6.2, "realized_net": 153.8, "trades_closed": 2}
    assert out["week"] == {"realized_gross": 110.0, "fees": 7.6, "realized_net": 102.4, "trades_closed": 3}
    assert out["month"]["realized_gross"] == 30.0 and out["month"]["fees"] == 9.0
    assert out["ytd"] == out["month"]
    assert out["all_time"]["realized_gross"] == 530.0 and out["all_time"]["trades_closed"] == 5
    assert max_exit == datetime(2026, 10, 9, 18, 30, tzinfo=timezone.utc)


def test_empty():
    out, max_exit = compute_realized([], NOW)
    assert all(v["realized_net"] == 0 and v["trades_closed"] == 0 for v in out.values())
    assert max_exit is None
