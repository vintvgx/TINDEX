"""Chart history stale-while-revalidate + warm-up (polling audit B4).

Run from api/:  python -m pytest tests/test_history_swr.py
"""
import time

import pandas as pd
import pytest

import services.yfinance.yfinance_service as ys


def _frame(price):
    idx = pd.date_range("2026-10-09 14:00", periods=3, freq="1D", tz="UTC")
    return pd.DataFrame({"Open": price, "High": price, "Low": price, "Close": price, "Volume": 1}, index=idx)


@pytest.fixture
def yahoo(monkeypatch):
    """Fake yfinance: returns whatever frame `state['next']` holds."""
    state = {"calls": 0, "next": _frame(100.0), "delay": 0}

    class FakeTicker:
        def __init__(self, t):
            pass

        def history(self, **kw):
            state["calls"] += 1
            if state["delay"]:
                time.sleep(state["delay"])
            return state["next"]

    monkeypatch.setattr(ys.yf, "Ticker", FakeTicker)
    # Stale-while-revalidate is session behaviour — don't let a run after
    # the close treat aged copies as final (covered separately below).
    monkeypatch.setattr(ys, "_fetched_since_close", lambda *_a, **_k: False)
    ys._HISTORY_CACHE.clear()
    with ys._REFRESHING_LOCK:
        ys._REFRESHING.clear()
    yield state
    ys._HISTORY_CACHE.clear()


def _age_cache(seconds):
    for k, (ts, v) in list(ys._HISTORY_CACHE.items()):
        ys._HISTORY_CACHE[k] = (ts - seconds, v)


def _wait_refreshes():
    for _ in range(100):
        with ys._REFRESHING_LOCK:
            if not ys._REFRESHING:
                return
        time.sleep(0.02)


def test_fresh_hit_skips_yahoo(yahoo):
    ys.get_historical_prices("AAPL", "1Y")
    r = ys.get_historical_prices("AAPL", "1Y")
    assert yahoo["calls"] == 1 and r["from_cache"] is True and not r.get("stale")


def test_expired_copy_served_instantly_then_refreshed_once(yahoo):
    ys.get_historical_prices("AAPL", "1Y")
    _age_cache(ys._history_ttl_s("1d") + 5)          # past TTL, within max-stale
    yahoo["next"], yahoo["delay"] = _frame(200.0), 0.2
    t0 = time.monotonic()
    r1 = ys.get_historical_prices("AAPL", "1Y")
    r2 = ys.get_historical_prices("AAPL", "1Y")      # while refresh in flight
    assert time.monotonic() - t0 < 0.15               # didn't wait on Yahoo
    assert r1["stale"] and r1["prices"][0] == 100.0 and r2["stale"]
    _wait_refreshes()
    assert yahoo["calls"] == 2                        # ONE background refresh
    r3 = ys.get_historical_prices("AAPL", "1Y")
    assert not r3.get("stale") and r3["prices"][0] == 200.0


def test_too_old_copy_is_a_normal_miss(yahoo):
    ys.get_historical_prices("AAPL", "1Y")
    _age_cache(ys._history_max_stale_s("1d") + 5)
    r = ys.get_historical_prices("AAPL", "1Y")
    assert yahoo["calls"] == 2 and not r.get("stale")


def test_failed_refresh_keeps_good_copy_and_backs_off(yahoo):
    ys.get_historical_prices("AAPL", "1Y")
    _age_cache(ys._history_ttl_s("1d") + 5)
    yahoo["next"] = pd.DataFrame()                    # Yahoo returns nothing
    ys.get_historical_prices("AAPL", "1Y")            # stale + background refresh
    _wait_refreshes()
    r = ys.get_historical_prices("AAPL", "1Y")
    assert r["prices"][0] == 100.0 and not r.get("stale")   # re-stamped, not blanked
    assert yahoo["calls"] == 2


def test_warm_history_fills_cache(yahoo):
    n = ys.warm_history(["SPY", "QQQ"], combos=(("1Y", None, False),), pause_s=0)
    assert n == 2 and yahoo["calls"] == 2
    ys.get_historical_prices("SPY", "1Y")
    assert yahoo["calls"] == 2


# ── Home chart deck spark (closes-only) ──────────────────────────────────────
# The spark used to drop the history cache's `stale` flag and keep the expired
# copy for another 45s, so the home charts showed old bars for up to a minute.

def test_spark_passes_stale_through_and_doesnt_cache_it(yahoo):
    ys._SPARK_CACHE.clear()
    ys.get_historical_prices("AAPL", "1Y")
    _age_cache(600)
    yahoo["next"] = _frame(120.0)

    first = ys.get_spark_prices("AAPL", "1Y")
    assert first["stale"] is True and first["closes"][-1] == 100.0
    _wait_refreshes()

    # The quick re-ask gets the refreshed bars, not a cached stale copy.
    second = ys.get_spark_prices("AAPL", "1Y")
    assert second["stale"] is False and second["closes"][-1] == 120.0
    ys._SPARK_CACHE.clear()


def test_spark_caches_fresh_copies(yahoo):
    ys._SPARK_CACHE.clear()
    ys.get_spark_prices("AAPL", "1Y")
    ys.get_spark_prices("AAPL", "1Y")
    assert yahoo["calls"] == 1
    assert ys.get_spark_prices("AAPL", "1Y")["open"] == 100.0
    ys._SPARK_CACHE.clear()


def test_spark_keys_on_interval(yahoo):
    ys._SPARK_CACHE.clear()
    a = ys.get_spark_prices("AAPL", "1Y", "1d")
    b = ys.get_spark_prices("AAPL", "1Y", "1wk")
    assert (a["interval"], b["interval"]) == ("1d", "1wk")
    ys._SPARK_CACHE.clear()


# ── After the close, a post-close copy is final ─────────────────────────────
# Every evening swipe used to get an expired-copy reply (stale=True) because
# the 45s TTL ignored that the bars had stopped moving.

from datetime import datetime as _dt  # noqa: E402

_ET = ys.ET


def _et(s):
    return _ET.localize(_dt.fromisoformat(s))


def test_post_close_copy_is_fresh_until_next_open():
    fetched = _et("2026-10-13 16:20").timestamp()
    assert ys._fetched_since_close(fetched, _et("2026-10-13 20:00"))
    assert ys._fetched_since_close(fetched, _et("2026-10-14 09:00"))       # pre-open
    assert not ys._fetched_since_close(fetched, _et("2026-10-14 09:20"))   # session window


def test_copy_from_during_the_session_is_not_final():
    fetched = _et("2026-10-13 15:50").timestamp()
    assert not ys._fetched_since_close(fetched, _et("2026-10-13 20:00"))


def test_weekend_uses_fridays_close():
    fetched = _et("2026-10-16 17:00").timestamp()                          # Friday evening
    assert ys._fetched_since_close(fetched, _et("2026-10-18 12:00"))       # Sunday
    assert not ys._fetched_since_close(_et("2026-10-16 15:00").timestamp(), _et("2026-10-18 12:00"))
