"""
MUSE_REVERSAL — pure helpers for the separate reversal strategy
(spec §10, 2026-11-02). No I/O, no broker, no DB — unit-testable.

This is deliberately NOT the REVERSAL profile's logic. REVERSAL stays
paused and untouched; MUSE_REVERSAL is a new profile + strategy that
enters only on:

  1. OrbService reversal scorer fire (HIGH), then
  2. 3 consecutive 1-minute bar closes on the reversal side of
     session VWAP (the VWAP hold), then
  3. intraday-only technicals >= 5 by the end of the hold.

And it exits on a VWAP reclaim: 3 consecutive 1-minute bar closes
back on the original-trend side of VWAP, then CLOSE_ALL. A single
tick or wick never counts — only bar closes count, for both the
hold and the reclaim. A close on the wrong side resets the counter
to zero; it does not pause it.
"""


class VwapSideTracker:
    """Count consecutive 1m bar closes on one side of session VWAP.

    direction: "PUT" means the reversal is bearish — the hold side is
    BELOW VWAP, and the reclaim side is ABOVE VWAP. "CALL" mirrors it.
    bars_required: 3 for both the hold and the reclaim (spec §10).
    """

    def __init__(self, direction: str, bars_required: int = 3):
        self.direction = direction
        self.bars_required = bars_required
        self.count = 0
        self.complete = False

    def _on_reversal_side(self, close: float, vwap: float) -> bool:
        if self.direction == "PUT":
            return close < vwap
        return close > vwap

    def feed(self, close: float, vwap: float) -> bool:
        """Feed one closed bar. Returns True once the count is met."""
        if self.complete:
            return True
        if close is None or vwap is None:
            return False
        if self._on_reversal_side(close, vwap):
            self.count += 1
        else:
            self.count = 0
        if self.count >= self.bars_required:
            self.complete = True
        return self.complete

    def reset(self) -> None:
        self.count = 0
        self.complete = False


def muse_technicals_pass(scores: dict) -> tuple:
    """Intraday-only technicals gate for MUSE_REVERSAL.

    scores: favour points in the REVERSAL direction (positive =
    favouring the reversal), each 0..2 for rsi / macd / trend, 0..2
    for zone rejection, 0..1 for vwap_slope and volume_surge.
    Daily RSI / daily trend / ORB position are deliberately NOT
    inputs — they are the slow drag that turned a clear intraday
    reversal (2026-11-02 SPY) into composite -3.

    Pass: total >= 5 AND at least two of (rsi, macd, trend) are 2.
    The second condition stops zone + volume alone from passing.
    Returns (passed, total).
    """
    scores = scores or {}
    total = sum(max(0, int(scores.get(k, 0))) for k in
                ("rsi", "macd", "trend", "zone", "vwap_slope", "volume"))
    core_twos = sum(1 for k in ("rsi", "macd", "trend")
                    if int(scores.get(k, 0)) >= 2)
    return (total >= 5 and core_twos >= 2), total


def muse_entry_ready(scorer_fired: bool, hold_complete: bool,
                     scores: dict) -> tuple:
    """All three entry conditions, in one place for the engine + tests."""
    passed, total = muse_technicals_pass(scores)
    return (bool(scorer_fired) and bool(hold_complete) and passed), total
