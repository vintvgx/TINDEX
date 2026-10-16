"""A key-level / brief-trigger cross push says how much volume the 1-minute
close bar had — whatever it was (there's no volume gate on a level cross).
Run from api/:  python -m pytest tests/test_level_cross_volume.py
"""
from datetime import datetime
from types import SimpleNamespace

import services.strategy.key_level_watcher as klw
from services.strategy.notifier import StrategyNotifier, _fmt_volume


def _bar(close, volume):
    return SimpleNamespace(close=close, volume=volume, ts=datetime(2026, 10, 14, 9, 41))


def _watcher(monkeypatch, level):
    w = klw.KeyLevelWatcher()
    w._watching = {"SPY": {level["id"]: level}}
    fired = []
    monkeypatch.setattr(klw.threading, "Thread",
                        lambda target, args, **_: SimpleNamespace(start=lambda: fired.append(args)))
    return w, fired


LEVEL = {"id": "L1", "ticker": "SPY", "direction": "bullish", "level_low": 585.2,
         "level_high": 585.2, "notes": "Brief pick — Breakout CALL trigger"}


def test_cross_passes_close_bar_volume_and_prior_average(monkeypatch):
    w, fired = _watcher(monkeypatch, dict(LEVEL))
    w._on_bar("SPY", _bar(584.0, 1000))   # arming bar (below)
    w._on_bar("SPY", _bar(584.5, 3000))   # still below
    w._on_bar("SPY", _bar(585.4, 1000))   # crosses on light volume — still fires
    (level, price, direction, volume, avg), = fired
    assert (price, direction, volume) == (585.4, "bullish", 1000)
    assert avg == 2000                    # the two bars before it


def _push(**kw):
    sent = {}
    n = StrategyNotifier.__new__(StrategyNotifier)
    n._dispatch = lambda **d: sent.update(d)
    n.notify_level_confirmed(ticker="SPY", direction="bullish", level_low=585.2, level_high=585.2,
                             price=585.4, level_id="L1", **kw)
    return sent


def test_brief_push_has_volume_even_below_average():
    sent = _push(volume=1000, avg_volume=2000, brief_trigger=True)
    assert sent["title"] == "📈 SPY Brief Trigger Crossed"
    assert sent["body"] == "Closed above $585.20 @ $585.40 · 1m vol 1.0K (0.5× avg)"


def test_plain_level_push_without_volume_unchanged():
    assert _push()["body"] == "Closed above $585.20 @ $585.40"


def test_fmt_volume():
    assert (_fmt_volume(1_240_000), _fmt_volume(52_300), _fmt_volume(812)) == ("1.24M", "52.3K", "812")
