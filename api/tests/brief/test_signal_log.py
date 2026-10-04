from datetime import date

from services.brief import signal_log

from .fakes import FakeSB, et


def test_resolve_day_sets_outcomes_and_joins_pnl():
    db = {
        "paper_signals": [
            {"id": "A-2026-10-05-AMZN", "signal_path": "A", "signal_date": "2026-10-05", "ticker": "AMZN",
             "direction": "CALL", "signal_at": "2026-10-05T09:32:00-04:00", "trigger": 247.75, "target": 252.5,
             "invalidation": 245.0, "fill_status": "filled", "trade_id": "t1", "pnl": None, "outcome": None},
            {"id": "A-2026-10-05-META", "signal_path": "A", "signal_date": "2026-10-05", "ticker": "META",
             "direction": "CALL", "signal_at": "2026-10-05T09:40:00-04:00", "trigger": 701.0, "target": 713.5,
             "invalidation": 692.0, "fill_status": "skipped", "trade_id": None, "pnl": None, "outcome": None},
            {"id": "B-t0", "signal_path": "B", "signal_date": "2026-10-02", "ticker": "NVDA", "direction": "PUT",
             "signal_at": "2026-10-02T09:50:00-04:00", "trigger": 180, "target": 176, "invalidation": 182,
             "fill_status": "filled", "trade_id": "t0", "pnl": None, "outcome": "stopped"},
        ],
        "orb_trades": [
            {"id": "t1", "pnl": 118.5, "pnl_pct": 39.5, "exit_time": "2026-10-05T14:10:00Z"},
            {"id": "t0", "pnl": -52.0, "pnl_pct": -30.0, "exit_time": "2026-10-02T15:00:00Z"},
        ],
    }
    windows = []

    def bars(ticker, start, end):
        windows.append((ticker, start.strftime("%H:%M"), end.strftime("%H:%M")))
        t = lambda m: et(2026, 10, 5, 9, m)
        return {"AMZN": [(t(33), 249, 247.6, 248.8), (t(50), 252.7, 250, 252.6)],
                "META": [(t(41), 701.5, 691.5, 692.0)]}[ticker]

    out = signal_log.resolve_day(date(2026, 10, 5), sb=FakeSB(db), bars_fn=bars)
    assert out == {"date": "2026-10-05", "signals": 2, "outcomes_resolved": 2, "trades_joined": 2}
    assert windows == [("AMZN", "09:33", "16:00"), ("META", "09:41", "16:00")]   # bars after the signal bar
    rows = {r["id"]: r for r in db["paper_signals"]}
    assert rows["A-2026-10-05-AMZN"]["outcome"] == "target_hit" and rows["A-2026-10-05-AMZN"]["pnl"] == 118.5
    assert rows["A-2026-10-05-META"]["outcome"] == "stopped" and rows["A-2026-10-05-META"].get("pnl") is None
    assert rows["B-t0"]["pnl"] == -52.0          # prior-day trade that closed later


def test_open_trade_leaves_pnl_empty():
    db = {"paper_signals": [{"id": "B-t9", "signal_path": "B", "signal_date": "2026-10-05", "ticker": "SPY",
                             "direction": "CALL", "signal_at": None, "trigger": 1, "target": 2, "invalidation": 0,
                             "fill_status": "filled", "trade_id": "t9", "pnl": None, "outcome": None}],
          "orb_trades": [{"id": "t9", "pnl": None, "pnl_pct": None, "exit_time": None}]}
    out = signal_log.resolve_day(date(2026, 10, 5), sb=FakeSB(db), bars_fn=lambda *a: [])
    assert out["trades_joined"] == 0 and db["paper_signals"][0]["pnl"] is None


def test_upsert_drops_nones():
    db = {"paper_signals": [{"id": "x", "fill_status": "pending", "trade_id": None}]}
    signal_log.upsert_signal(FakeSB(db), {"id": "x", "fill_status": "filled", "trade_id": "t1", "profile": None})
    row = db["paper_signals"][0]
    assert row["fill_status"] == "filled" and row["trade_id"] == "t1" and "profile" not in row
