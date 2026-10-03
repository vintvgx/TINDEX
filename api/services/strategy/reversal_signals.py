"""
Pure helpers for the REVERSAL scorer's confluence signals (2026-10-02):
technicals feed the failed-breakout scorer as extra signals instead of
living in a separate silo. No I/O — OrbService wires these in, and they're
unit-testable without the streaming stack.

  rsi_exhaustion  breakout confirmed into exhaustion (CALL with intraday
                  RSI-14 ≥ 70, PUT ≤ 30) — breakouts into exhaustion fail more
  zone_wall       a zone-engine zone scoring ≥ 50 sits at the breakout price
                  (resistance for a CALL breakout, support for a PUT)
  VWAP threshold  fire at 3 signals normally, 4 when price is on the wrong
                  side of session VWAP for the reversal direction (counter-
                  trend) — a higher bar, not a veto
  decline re-fire a reversal the engine's technicals gate declined is
                  restored with a cooldown instead of being lost for the day
"""

import copy
from datetime import timedelta

RSI_PERIOD = 14
RSI_OVERBOUGHT = 70.0
RSI_OVERSOLD = 30.0
ZONE_WALL_MIN_SCORE = 50
ZONE_WALL_TOLERANCE_PCT = 0.003   # breakout price within 0.3% of the zone band
BASE_FIRE_THRESHOLD = 3
COUNTER_VWAP_FIRE_THRESHOLD = 4
DECLINE_COOLDOWN_SECONDS = 5 * 60


def rsi_wilder(closes: list, period: int = RSI_PERIOD) -> "float | None":
    """Wilder-smoothed RSI of `closes` (oldest first); None with fewer than
    period + 1 closes."""
    vals = [float(c) for c in closes if c is not None]
    if len(vals) < period + 1:
        return None
    gains, losses = [], []
    for prev, cur in zip(vals, vals[1:]):
        d = cur - prev
        gains.append(max(d, 0.0))
        losses.append(max(-d, 0.0))
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period
    for g, l in zip(gains[period:], losses[period:]):
        avg_gain = (avg_gain * (period - 1) + g) / period
        avg_loss = (avg_loss * (period - 1) + l) / period
    if avg_loss == 0:
        return 100.0 if avg_gain > 0 else 50.0
    rs = avg_gain / avg_loss
    return 100.0 - 100.0 / (1.0 + rs)


def rsi_exhausted(breakout_direction: str, rsi: "float | None") -> bool:
    """CALL breakout with RSI ≥ 70 or PUT breakout with RSI ≤ 30."""
    if rsi is None:
        return False
    return rsi >= RSI_OVERBOUGHT if breakout_direction == "CALL" else rsi <= RSI_OVERSOLD


def zone_wall(snapshot: "dict | None", breakout_direction: str, price: float) -> "dict | None":
    """The zone the breakout ran into, or None: a resistance zone (CALL) /
    support zone (PUT) scoring ≥ ZONE_WALL_MIN_SCORE whose band, widened by
    ZONE_WALL_TOLERANCE_PCT, contains the breakout price."""
    if not snapshot or not price:
        return None
    side = "resistance" if breakout_direction == "CALL" else "support"
    best = None
    for z in snapshot.get(side, []) or []:
        if (z.get("score") or 0) < ZONE_WALL_MIN_SCORE:
            continue
        lo = z["low"] * (1 - ZONE_WALL_TOLERANCE_PCT)
        hi = z["high"] * (1 + ZONE_WALL_TOLERANCE_PCT)
        if lo <= price <= hi and (best is None or z["score"] > best["score"]):
            best = z
    return best


def fire_threshold(reversal_direction: str, price: float, session_vwap: "float | None") -> int:
    """3 normally; 4 when price is on the wrong side of session VWAP for the
    REVERSAL's direction (above VWAP for a PUT reversal, below for a CALL)."""
    if session_vwap is None or not price:
        return BASE_FIRE_THRESHOLD
    counter = price > session_vwap if reversal_direction == "PUT" else price < session_vwap
    return COUNTER_VWAP_FIRE_THRESHOLD if counter else BASE_FIRE_THRESHOLD


def restore_after_decline(fired_state: dict, now) -> dict:
    """A copy of the scoring state captured when a reversal fired, re-opened
    after the engine's gate declined it: `fired` cleared and a cooldown set
    so the scorer may fire again (once the cooldown passes) instead of the
    opportunity dying on one blocked attempt."""
    st = copy.deepcopy(fired_state)
    st["fired"] = False
    st["cooldown_until"] = now + timedelta(seconds=DECLINE_COOLDOWN_SECONDS)
    st["declines"] = st.get("declines", 0) + 1
    return st


def in_cooldown(state: dict, now) -> bool:
    until = state.get("cooldown_until")
    return until is not None and now < until


class SessionVwap:
    """Running session VWAP per ticker from 1-minute bars (resets each ET
    day) — the service's bar history only keeps the last 100 bars."""

    def __init__(self):
        self._acc: dict = {}   # ticker -> [session_date, sum_pv, sum_v]

    def update(self, ticker: str, session_date, high, low, close, volume) -> None:
        if close is None or not volume:
            return
        acc = self._acc.get(ticker)
        if acc is None or acc[0] != session_date:
            acc = self._acc[ticker] = [session_date, 0.0, 0.0]
        h = float(high) if high is not None else float(close)
        l = float(low) if low is not None else float(close)
        typical = (h + l + float(close)) / 3.0
        acc[1] += typical * float(volume)
        acc[2] += float(volume)

    def get(self, ticker: str, session_date) -> "float | None":
        acc = self._acc.get(ticker)
        if not acc or acc[0] != session_date or acc[2] <= 0:
            return None
        return acc[1] / acc[2]
