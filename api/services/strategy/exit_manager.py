"""
Profile-aware exit manager. All thresholds come from the profile dict.

BULL DOG  — holds longer, exits less aggressively, 40% runner after TP2
THUNDER CAT — standard TP1/TP2/runner structure
WOLF      — fastest exits, closes everything at TP2 (no runner)
"""

import math
import pytz
from datetime import datetime, time
from collections import deque

ET = pytz.timezone("America/New_York")


class ExitManager:
    def __init__(self, entry_premium: float, qty: int, fib_levels: dict,
                 direction: str, eod_close_time: str, profile: dict):
        self.entry_premium  = entry_premium
        self.qty            = qty
        self.qty_remaining  = qty
        self.fib_levels     = fib_levels
        self.direction      = direction
        self.eod_close_time = self._parse_time(eod_close_time)
        self.profile        = profile

        self.entry_time   = datetime.now(ET)

        self.hard_stop    = entry_premium * (1 - profile["max_loss_pct"])
        self.tp1          = entry_premium * profile["tp1_mult"]
        self.tp2          = entry_premium * profile["tp2_mult"]
        self.runner_trail = entry_premium

        self.tp1_hit        = False
        self.tp2_hit        = False
        self.be_stop_active = False

        # Disable TP2 when the profile explicitly opts out OR when starting with
        # ≤ 2 contracts (TP1 closes one, the other becomes a runner — no TP2 needed).
        self._use_tp2 = profile.get("use_tp2", qty > 2)

        self.orh = fib_levels["orh"]
        self.orl = fib_levels["orl"]

        self._runner_mode  = profile.get("runner_mode", "trail")

        self.price_buffer  = deque(maxlen=profile["consol_bars"])
        self.volume_buffer = deque(maxlen=profile["consol_bars"])

    def evaluate(self, current_option_price: float,
                 current_underlying_price: float = None,
                 current_volume: float = None) -> dict:
        now_et = datetime.now(ET).time()

        if now_et >= self.eod_close_time:
            return self._action("CLOSE_ALL", self.qty_remaining, "EOD_CLOSE")

        # Premium-based hard stop: close when option price drops to entry × (1 - max_loss_pct).
        # This is the only hard stop — the underlying crossing back into the ORB range
        # does NOT trigger an automatic exit; the option price itself must hit the threshold.
        if current_option_price <= self.hard_stop:
            return self._action("CLOSE_ALL", self.qty_remaining, "HARD_STOP",
                                current_option_price)

        # Only track actual underlying price — option price is not a valid proxy
        # (same option premium on consecutive ticks would instantly fake consolidation)
        if current_underlying_price is not None:
            self.price_buffer.append(current_underlying_price)
        if current_volume is not None:
            self.volume_buffer.append(current_volume)

        secs_held = (datetime.now(ET) - self.entry_time).total_seconds()

        # Minimum 5-minute hold before consolidation exit: price consolidates naturally
        # right at the breakout level for the first few minutes — don't exit yet.
        # Also suppressed until TP1 hits — a real breakout can stall right after
        # entry while still being a winner; closing it here mistakes a pause for
        # a failed trade. Once TP1 is hit, the runner trail/BE-stop take over.
        if (secs_held >= 300 and self.profile["consol_exit"]
                and self.tp1_hit and self._is_consolidating()):
            return self._action("CLOSE_ALL", self.qty_remaining, "CONSOLIDATION",
                                current_option_price)

        # Minimum 3-minute hold before volume exit
        if secs_held >= 180 and self.profile.get("volume_exit", False) and self._is_low_volume() and not self.tp1_hit:
            qty_lv = max(1, self.qty_remaining // 2)
            return self._action("CLOSE_PARTIAL", qty_lv, "LOW_VOLUME_EXIT",
                                current_option_price)

        if not self.tp1_hit and current_option_price >= self.tp1:
            self.tp1_hit        = True
            self.be_stop_active = True
            self.hard_stop      = self.entry_premium  # move stop to breakeven after TP1
            # be_hold: runner sits at B/E stop only — no trailing stop, rides to TP2/EOD.
            # trail: high-water-mark trailing stop activates immediately at TP1.
            if self._runner_mode == "trail":
                self.runner_trail = current_option_price * (1 - self.profile["runner_trail_pct"])
            qty_tp1 = max(1, math.floor(self.qty_remaining * self.profile["tp1_close_pct"]))
            return self._action("CLOSE_PARTIAL", qty_tp1, "TP1", current_option_price)

        if self._use_tp2 and self.tp1_hit and not self.tp2_hit and current_option_price >= self.tp2:
            self.tp2_hit = True
            if self.profile["tp2_close_pct"] >= 1.0:
                return self._action("CLOSE_ALL", self.qty_remaining, "TP2_FULL_CLOSE",
                                    current_option_price)
            qty_tp2 = max(1, math.floor(self.qty_remaining * self.profile["tp2_close_pct"]))
            return self._action("CLOSE_PARTIAL", qty_tp2, "TP2", current_option_price)

        # trail mode only — be_hold skips this block entirely; the B/E stop below
        # is the only floor for the runner, which then targets TP2 or rides to EOD.
        if self._runner_mode == "trail" and self.tp1_hit and self.qty_remaining > 0:
            new_trail = current_option_price * (1 - self.profile["runner_trail_pct"])
            if new_trail > self.runner_trail:
                self.runner_trail = new_trail
            if current_option_price <= self.runner_trail:
                return self._action("CLOSE_ALL", self.qty_remaining, "RUNNER_TRAIL_STOP",
                                    current_option_price)

        if self.be_stop_active and current_option_price <= self.entry_premium:
            return self._action("CLOSE_ALL", self.qty_remaining, "BREAKEVEN_STOP",
                                self.entry_premium)

        return self._action("HOLD", 0, "")

    def _is_consolidating(self) -> bool:
        if len(self.price_buffer) < self.profile["consol_bars"]:
            return False
        hi, lo = max(self.price_buffer), min(self.price_buffer)
        mid = (hi + lo) / 2
        return mid > 0 and (hi - lo) / mid < self.profile["consol_range_pct"]

    def _is_low_volume(self) -> bool:
        if len(self.volume_buffer) < 3:
            return False
        avg = sum(list(self.volume_buffer)[:-1]) / (len(self.volume_buffer) - 1)
        current = self.volume_buffer[-1]
        return avg > 0 and current < avg * self.profile["volume_exit_threshold"]

    def _parse_time(self, time_str: str) -> time:
        h, m = map(int, time_str.split(":"))
        return time(h, m)

    def _action(self, action_type: str, qty: int, reason: str,
                current_premium: float = None) -> dict:
        return {"type": action_type, "qty": qty, "reason": reason,
                "current_premium": current_premium}

    def to_dict(self) -> dict:
        return {
            "entry_premium":  self.entry_premium,
            "hard_stop":      self.hard_stop,
            "tp1":            self.tp1,
            "tp2":            self.tp2,
            "runner_trail":   self.runner_trail,
            "tp1_hit":        self.tp1_hit,
            "tp2_hit":        self.tp2_hit,
            "be_stop_active": self.be_stop_active,
            "use_tp2":        self._use_tp2,
            "qty":            self.qty,
            "qty_remaining":  self.qty_remaining,
        }
