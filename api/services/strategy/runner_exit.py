"""
Runner technical invalidation exit (spec approved 2026-10-27).

After TP1 the last runner contract has no automated exit that secures
profit — trail and cascade both preserve 1, so it rides back to the
breakeven stop. This tracker sells the WHOLE runner (including the final
contract) once the reason for holding it is gone, judged on CLOSED
underlying bars only (1m, or 5m built from the 1m feed):

  1. Structure break — close beyond the most recent confirmed swing low
     (CALL) / swing high (PUT), minus the buffer.
  2. Level loss — close beyond the nearest zone on the trade's side
     (support below for a CALL, resistance above for a PUT), minus the
     buffer; session VWAP only when no zone exists on that side.
  3. Momentum cooling — RSI(14) crosses below 60 (CALL) / above 40 (PUT).
  4. Lower high — after a structure break, a bounce that rolls over while
     still below the prior swing high (CALL) / above the prior swing low (PUT).

Sell condition: (1) AND any of (2)/(3)/(4). Signals latch — a bounce back
over a broken level doesn't reset them; only a close beyond the prior
swing high (CALL) / low (PUT) does (the trend re-asserting). Hard
override: a close back inside the opening range (below ORH for a CALL,
above ORL for a PUT), minus the buffer, sells on its own — a failed
breakout. Not applied to REVERSAL trades, whose entries sit on the far
side of the range by design (their own levels are phase 2).

Pure — no I/O. ExitManager owns one per position and turns `fired` into
a CLOSE_ALL "RUNNER_INVALIDATION" on the next tick.
"""
from datetime import timedelta

import pytz

from services.strategy.reversal_signals import rsi_wilder
from services.strategy.structure_tracker import confirmed_swings

ET = pytz.timezone("America/New_York")

SWING_WINDOW = 3
RSI_COOL_CALL = 60.0
RSI_COOL_PUT = 40.0
BAR_MINUTES = {"1m": 1, "5m": 5}
MAX_BARS = 400


class RunnerInvalidation:
    def __init__(self, direction: str, orh: float | None, orl: float | None,
                 buffer_pct: float = 0.05, bar: str = "1m", orb_override: bool = True):
        self.direction = direction
        self.orh = orh
        self.orl = orl
        self.buffer = max(0.0, float(buffer_pct)) / 100.0
        self.bar = bar if bar in BAR_MINUTES else "1m"
        self.minutes = BAR_MINUTES[self.bar]
        self.orb_override = orb_override

        self.bars: list[dict] = []       # closed bars at self.bar size, oldest first
        self._bucket: dict | None = None  # 5m bucket still forming
        self.seeded = False
        self.armed = False

        self.structure_break = False
        self.level_loss = False
        self.momentum_cooling = False
        self.lower_high = False
        self.prior_extreme = None   # swing high (CALL) / low (PUT) the break is measured against
        self._bounce_close = None   # close of the post-break bounce bar
        self.fired: dict | None = None

    # ── feed ────────────────────────────────────────────────────────────────

    def seed(self, bars_1m: list) -> None:
        """History before this tracker existed (the hub's recent bars) so
        swings and RSI are warm. Never evaluates signals."""
        for b in bars_1m:
            closed = self._push_1m(b)
            if closed:
                self.bars.append(closed)
        del self.bars[:-MAX_BARS]
        self.seeded = True

    def arm(self) -> None:
        """Runner phase begins (TP1 hit): signals count from the next bar."""
        if not self.armed:
            self.armed = True
            self._reset_latches()

    def on_bar(self, bar, zones: list | None = None, vwap: float | None = None) -> dict | None:
        """Feed one closed 1m bar (OrbBar-shaped or dict). Returns the fire
        detail the first time the exit condition is met, else None."""
        closed = self._push_1m(bar)
        if not closed:
            return None
        prev_close = self.bars[-1]["close"] if self.bars else closed["open"]
        self.bars.append(closed)
        del self.bars[:-MAX_BARS]
        if not self.armed or self.fired:
            return None
        return self._evaluate(closed, prev_close, zones or [], vwap)

    # ── internals ───────────────────────────────────────────────────────────

    def _push_1m(self, bar) -> dict | None:
        get = (lambda k: bar.get(k)) if isinstance(bar, dict) else (lambda k: getattr(bar, k, None))
        close = get("close")
        if close is None:
            return None
        b = {"ts": get("ts"), "open": get("open") if get("open") is not None else close,
             "high": get("high") if get("high") is not None else close,
             "low": get("low") if get("low") is not None else close, "close": close}
        if self.minutes == 1:
            return b
        ts = b["ts"]
        if ts is None:
            return None
        ts = (ts if ts.tzinfo else ET.localize(ts)).astimezone(ET)
        session_open = ts.replace(hour=9, minute=30, second=0, microsecond=0)
        if ts < session_open:
            return None
        idx = int((ts - session_open).total_seconds() // 60) // self.minutes
        start = session_open + timedelta(minutes=idx * self.minutes)
        cur = self._bucket
        if cur is None or cur["ts"] != start:
            cur = self._bucket = {**b, "ts": start}
        else:
            cur["high"] = max(cur["high"], b["high"])
            cur["low"] = min(cur["low"], b["low"])
            cur["close"] = b["close"]
        # A 1m bar starting at minute N closes the bucket when N+1 lands on
        # the bucket boundary — the 5m bar is final with this 1m close.
        if (ts + timedelta(minutes=1) - session_open).total_seconds() // 60 % self.minutes == 0:
            self._bucket = None
            return cur
        return None

    def _reset_latches(self) -> None:
        self.structure_break = self.level_loss = self.momentum_cooling = self.lower_high = False
        self.prior_extreme = None
        self._bounce_close = None

    def _beyond(self, close: float, level: float) -> bool:
        """Close through `level` against the trade, by more than the buffer."""
        if self.direction == "CALL":
            return close <= level * (1 - self.buffer)
        return close >= level * (1 + self.buffer)

    def _swing_refs(self) -> tuple:
        """(structure level, prior extreme) from swings confirmed before the
        latest bar: CALL → (last swing low, last swing high); PUT mirrored."""
        hist = self.bars[:-1]
        highs, lows = confirmed_swings(hist, SWING_WINDOW)
        last_high = hist[highs[-1]]["high"] if highs else None
        last_low = hist[lows[-1]]["low"] if lows else None
        return (last_low, last_high) if self.direction == "CALL" else (last_high, last_low)

    def _nearest_level(self, prev_close: float, zones: list, vwap: float | None):
        if self.direction == "CALL":
            edges = [z["low"] for z in zones if z.get("low") is not None and z["low"] < prev_close]
            if edges:
                return max(edges), "zone"
            return (vwap, "vwap") if vwap is not None and vwap < prev_close else (None, None)
        edges = [z["high"] for z in zones if z.get("high") is not None and z["high"] > prev_close]
        if edges:
            return min(edges), "zone"
        return (vwap, "vwap") if vwap is not None and vwap > prev_close else (None, None)

    def _evaluate(self, bar: dict, prev_close: float, zones: list, vwap: float | None) -> dict | None:
        close = bar["close"]
        call = self.direction == "CALL"

        orb_level = self.orh if call else self.orl
        if self.orb_override and orb_level and self._beyond(close, orb_level):
            return self._fire("orb_failed", close, level=orb_level)

        structure_level, extreme = self._swing_refs()

        # Trend re-asserts: a close beyond the prior swing extreme clears every latch.
        if self.prior_extreme is not None and (close > self.prior_extreme if call else close < self.prior_extreme):
            self._reset_latches()

        if not self.structure_break and structure_level is not None and self._beyond(close, structure_level):
            self.structure_break = True
            if extreme is None:
                extreme = max(b["high"] for b in self.bars) if call else min(b["low"] for b in self.bars)
            self.prior_extreme = extreme
            self._bounce_close = None
        elif self.structure_break and not self.lower_high and self.prior_extreme is not None:
            # Lower high: a bounce bar (close better than the prior close),
            # then a bar that closes back under it — all below the prior extreme.
            better = close > prev_close if call else close < prev_close
            below = close < self.prior_extreme if call else close > self.prior_extreme
            if self._bounce_close is not None and not better and below:
                self.lower_high = True
            elif better and below:
                self._bounce_close = close

        level, level_src = self._nearest_level(prev_close, zones, vwap)
        if level is not None and self._beyond(close, level):
            self.level_loss = True

        rsi_now = rsi_wilder([b["close"] for b in self.bars])
        rsi_prev = rsi_wilder([b["close"] for b in self.bars[:-1]])
        if rsi_now is not None and rsi_prev is not None:
            if (rsi_prev >= RSI_COOL_CALL > rsi_now) if call else (rsi_prev <= RSI_COOL_PUT < rsi_now):
                self.momentum_cooling = True

        if self.structure_break and (self.level_loss or self.momentum_cooling or self.lower_high):
            return self._fire("confluence", close, level=level, level_source=level_src,
                              structure_level=structure_level, rsi=rsi_now)
        return None

    def _fire(self, trigger: str, close: float, **detail) -> dict:
        self.fired = {"trigger": trigger, "close": close, "bar": self.bar,
                      "signals": self.signals(), **{k: v for k, v in detail.items() if v is not None}}
        return self.fired

    def signals(self) -> dict:
        return {"structure_break": self.structure_break, "level_loss": self.level_loss,
                "momentum_cooling": self.momentum_cooling, "lower_high": self.lower_high}

    def to_dict(self) -> dict:
        return {"bar": self.bar, "buffer_pct": round(self.buffer * 100, 4), "armed": self.armed,
                "orb_override": self.orb_override, "prior_extreme": self.prior_extreme,
                "fired": self.fired, **self.signals()}
