"""Bad-tick filter (zone_engine._drop_bad_tick_bars), 2026-11-01 fix.

Regression cases are the real bars from the 2026-11-01 Sunday-night
zone refresh: SPY/OXY/VST zero-volume phantom Lows must be dropped,
PLTR/VST traded 09:30 opening bars must be kept.
"""
import pandas as pd
import pytest

from services.strategy.zone_engine import _drop_bad_tick_bars


def _bars(rows):
    idx = pd.to_datetime([r[0] for r in rows])
    return pd.DataFrame(
        {"Open": [r[1] for r in rows], "High": [r[2] for r in rows],
         "Low": [r[3] for r in rows], "Close": [r[4] for r in rows],
         "Volume": [r[5] for r in rows]},
        index=idx,
    )


def test_zero_volume_phantom_low_dropped():
    # SPY 2026-10-26 16:30: Low 722.19, Close 765.30, Volume 0.
    bars = _bars([
        ("2026-10-26 16:00", 765.24, 765.44, 764.99, 765.26, 0),
        ("2026-10-26 16:30", 765.27, 765.37, 722.19, 765.30, 0),
        ("2026-10-26 17:00", 765.31, 765.37, 765.20, 765.31, 0),
    ])
    out = _drop_bad_tick_bars("SPY", bars, "intraday_5d")
    assert len(out) == 2
    assert "2026-10-26 16:30" not in out.index.strftime("%Y-%m-%d %H:%M")


def test_traded_opening_gap_kept():
    # PLTR 2026-10-30 09:30: Low 186.33 vs prior Close 194.00, Volume > 0,
    # next bar Low 186.14 — the market held near the opening Low.
    bars = _bars([
        ("2026-10-30 09:00", 193.95, 194.00, 192.36, 194.00, 0),
        ("2026-10-30 09:30", 193.76, 193.92, 186.33, 189.36, 4769742),
        ("2026-10-30 10:00", 189.23, 190.15, 186.14, 187.14, 2401220),
    ])
    out = _drop_bad_tick_bars("PLTR", bars, "intraday_5d")
    assert len(out) == 3


def test_traded_isolated_low_dropped_on_snap_back():
    bars = _bars([
        ("2026-10-30 10:00", 100.0, 100.5, 99.5, 100.0, 1000),
        ("2026-10-30 10:30", 100.0, 100.5, 94.0, 100.1, 1000),
        ("2026-10-30 11:00", 100.1, 100.6, 99.8, 100.2, 1000),
    ])
    out = _drop_bad_tick_bars("TEST", bars, "intraday_5d")
    assert len(out) == 2


def test_last_bar_gap_kept_unconfirmed():
    bars = _bars([
        ("2026-10-30 10:00", 100.0, 100.5, 99.5, 100.0, 1000),
        ("2026-10-30 10:30", 100.0, 100.5, 94.0, 99.0, 1000),
    ])
    out = _drop_bad_tick_bars("TEST", bars, "intraday_5d")
    assert len(out) == 2


def test_no_gap_bars_untouched():
    bars = _bars([
        ("2026-10-30 10:00", 100.0, 100.5, 99.5, 100.0, 1000),
        ("2026-10-30 10:30", 100.0, 100.5, 99.0, 100.1, 1000),
    ])
    out = _drop_bad_tick_bars("TEST", bars, "intraday_5d")
    assert len(out) == 2
