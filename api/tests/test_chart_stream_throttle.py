"""/ws/chart/<ticker>/live throttle (chart CPU/thermal fix, 2026-10-06): every
Alpaca trade used to be forwarded to the phone. LatestPriceMailbox keeps only
the newest price, sends at most one per interval (trailing edge) and skips
unchanged prices.

Run from api/:  python -m pytest tests/test_chart_stream_throttle.py
"""
import threading
import time

from services.websocket.stock_chart_stream import LatestPriceMailbox


def _drain(mb: LatestPriceMailbox, out: list, stop: threading.Event):
    while not stop.is_set():
        p = mb.next(timeout=0.05)
        if p is not None:
            out.append((time.monotonic(), p))


def test_burst_is_coalesced_and_last_price_delivered():
    mb = LatestPriceMailbox(min_interval=0.1)
    sent: list = []
    stop = threading.Event()
    t = threading.Thread(target=_drain, args=(mb, sent, stop), daemon=True)
    t.start()
    # ~1s of trades at 200/s with a changing price.
    prices = [600 + i / 100 for i in range(200)]
    t0 = time.monotonic()
    for p in prices:
        mb.put(p)
        time.sleep(0.005)
    burst_s = time.monotonic() - t0
    time.sleep(0.25)
    stop.set()
    t.join(1)

    # 200 trades at a 100ms cap -> about one message per 100ms of burst, not
    # 200. Bounded by the burst's MEASURED length: sleep(0.005) overshoots
    # (1.2–1.5s for the loop on macOS / a loaded CI box), so a fixed "~1s"
    # bound flaked whenever the burst simply ran long.
    assert 5 <= len(sent) <= burst_s / 0.1 + 3, (len(sent), burst_s)
    # Trailing edge: the burst's final price always goes out.
    assert sent[-1][1] == prices[-1]
    # Never faster than the interval (small scheduler slack).
    gaps = [b[0] - a[0] for a, b in zip(sent, sent[1:])]
    assert min(gaps) >= 0.09, gaps


def test_unchanged_price_is_not_resent():
    mb = LatestPriceMailbox(min_interval=0.0)
    mb.put(100.0)
    assert mb.next(timeout=0.1) == 100.0
    mb.put(100.0)
    mb.put(100.0)
    assert mb.next(timeout=0.1) is None  # keepalive path, no duplicate
    mb.put(100.5)
    assert mb.next(timeout=0.1) == 100.5


def test_timeout_returns_none_for_keepalive():
    mb = LatestPriceMailbox(min_interval=0.25)
    start = time.monotonic()
    assert mb.next(timeout=0.1) is None
    assert time.monotonic() - start >= 0.09


def test_first_price_is_sent_immediately():
    mb = LatestPriceMailbox(min_interval=10)
    mb.put(42.0)
    start = time.monotonic()
    assert mb.next(timeout=1) == 42.0
    assert time.monotonic() - start < 0.05
