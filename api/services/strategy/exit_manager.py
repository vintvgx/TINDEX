"""
Profile-aware exit manager. All thresholds come from the profile dict.

Exit sequence:
  1. TP1 (confirmed over N ticks, dollar-floored) — partial close, SL moves to entry.
  2. Cascade exit — after TP1, monitors the underlying for consecutive down ticks.
     On N consecutive downs: sells cascade_close_pct of non-runner contracts.
     Always preserves 1 runner contract.
  3. Runner — the final 1 contract exits at: TP2 (if reached), BE stop (entry price),
     EOD (15:58 ET), or manual.

TP1 dollar floor: TP = max(entry × mult, entry + min_dollars)
  Prevents cheap OTM contracts from locking in noise-level gains.

BULL DOG    — 10 contracts, TP1 +20% / $0.35 floor, cascade(3 ticks, 50%)
THUNDER CAT — 6 contracts,  TP1 +20% / $0.25 floor, cascade(3 ticks, 50%)
WOLF        — 3 contracts,  TP1 +15% / $0.20 floor, cascade(3 ticks, 50%)
TREND RIDER — 6 contracts,  TP1 +15% / $0.30 floor, cascade(3 ticks, 50%), be_hold runner
RETESTER    — 4 contracts,  TP1 +20% / $0.20 floor, cascade(3 ticks, 50%), trail runner
REVERSAL    — 3 contracts,  TP1 +15% / $0.18 floor, cascade(3 ticks, 50%), trail runner
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

        # Dollar-floored TP targets: TP = max(entry × mult, entry + min_dollars).
        # Prevents cheap OTM contracts from locking in noise-level gains on a %-only target.
        min_tp1 = profile.get("min_tp1_dollars", 0.0)
        min_tp2 = profile.get("min_tp2_dollars", 0.0)
        self.tp1 = max(entry_premium * profile["tp1_mult"], entry_premium + min_tp1)
        self.tp2 = max(entry_premium * profile["tp2_mult"], entry_premium + min_tp2)

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

        # TP1 confirmation: require N consecutive ticks at/above TP1 before firing.
        # Prevents a single ask-side spike from triggering a premature partial close.
        self._tp1_ticks        = 0
        self._tp1_ticks_needed = profile.get("tp1_confirm_ticks", 2)

        # Cascade exit: after TP1, track consecutive underlying down-ticks.
        # On N consecutive downs, sell cascade_close_pct of non-runner contracts.
        # Always preserves 1 runner contract regardless of cascade count.
        self._cascade_down_ticks   = 0
        self._cascade_ticks_needed = profile.get("cascade_ticks", 3)
        self._cascade_close_pct    = profile.get("cascade_close_pct", 0.50)
        self._cascade_last_price   = None

    def evaluate(self, current_option_price: float,
                 current_underlying_price: float = None,
                 current_volume: float = None) -> dict:
        now_et = datetime.now(ET).time()

        if now_et >= self.eod_close_time:
            return self._action("CLOSE_ALL", self.qty_remaining, "EOD_CLOSE")

        # Premium-based stop. Before TP1: hard stop at entry × (1 - max_loss_pct).
        # After TP1: hard_stop is moved to entry_premium (breakeven), so the same
        # check doubles as the BE stop — labeled correctly for analytics.
        if current_option_price <= self.hard_stop:
            reason = "BREAKEVEN_STOP" if self.be_stop_active else "HARD_STOP"
            return self._action("CLOSE_ALL", self.qty_remaining, reason,
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

        # TP1 — requires tp1_confirm_ticks consecutive ticks at/above the level.
        # Price falling back below TP1 mid-count resets the counter.
        if not self.tp1_hit:
            if current_option_price >= self.tp1:
                self._tp1_ticks += 1
                if self._tp1_ticks < self._tp1_ticks_needed:
                    return self._action("HOLD", 0, "TP1_CONFIRMING")
                self.tp1_hit        = True
                self.be_stop_active = True
                self.hard_stop      = self.entry_premium  # SL moves to breakeven
                if self._runner_mode == "trail":
                    self.runner_trail = current_option_price * (1 - self.profile["runner_trail_pct"])
                qty_tp1 = max(1, math.floor(self.qty_remaining * self.profile["tp1_close_pct"]))
                return self._action("CLOSE_PARTIAL", qty_tp1, "TP1", current_option_price)
            else:
                self._tp1_ticks = 0

        # TP2 — runner bonus target; only fires if the full move materialises.
        if self._use_tp2 and self.tp1_hit and not self.tp2_hit and current_option_price >= self.tp2:
            self.tp2_hit = True
            if self.profile["tp2_close_pct"] >= 1.0:
                return self._action("CLOSE_ALL", self.qty_remaining, "TP2_FULL_CLOSE",
                                    current_option_price)
            qty_tp2 = max(1, math.floor(self.qty_remaining * self.profile["tp2_close_pct"]))
            return self._action("CLOSE_PARTIAL", qty_tp2, "TP2", current_option_price)

        # Trail stop (trail mode only) — be_hold skips this; BE stop is the floor.
        if self._runner_mode == "trail" and self.tp1_hit and self.qty_remaining > 0:
            new_trail = current_option_price * (1 - self.profile["runner_trail_pct"])
            if new_trail > self.runner_trail:
                self.runner_trail = new_trail
            if current_option_price <= self.runner_trail:
                return self._action("CLOSE_ALL", self.qty_remaining, "RUNNER_TRAIL_STOP",
                                    current_option_price)

        # Cascade exit — fires when on_underlying_bar() has accumulated enough
        # consecutive lower closes (bar cadence, not quote cadence).
        # Always preserves 1 runner contract; that runner exits only via TP2/BE/EOD/manual.
        if self.tp1_hit and self.qty_remaining > 1:
            if self._cascade_down_ticks >= self._cascade_ticks_needed:
                self._cascade_down_ticks = 0
                sellable    = self.qty_remaining - 1
                qty_cascade = min(max(1, math.floor(sellable * self._cascade_close_pct)),
                                  sellable)
                return self._action("CLOSE_PARTIAL", qty_cascade, "CASCADE_EXIT",
                                    current_option_price)

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

    def on_underlying_bar(self, close: float) -> None:
        """
        Feed one 1-minute bar close into the cascade tracker.
        Must be called from on_bar (bar cadence), NOT from quote-tick handlers —
        inter-bar quotes repeat the same underlying price and would reset the counter.
        Equal prices (flat bar) are treated as no information.
        """
        if not self.tp1_hit:
            return  # cascade is only relevant after TP1
        if self._cascade_last_price is None:
            self._cascade_last_price = close
            return
        if close < self._cascade_last_price:
            self._cascade_down_ticks += 1
        elif close > self._cascade_last_price:
            self._cascade_down_ticks = 0
        # equal close → leave counter unchanged
        self._cascade_last_price = close

    def update_qty(self, qty_closed: int) -> None:
        """Call after executing a partial close so remaining contract count stays accurate."""
        self.qty_remaining = max(0, self.qty_remaining - qty_closed)

    def to_dict(self) -> dict:
        return {
            "entry_premium":       self.entry_premium,
            "hard_stop":           self.hard_stop,
            "tp1":                 self.tp1,
            "tp2":                 self.tp2,
            "runner_trail":        self.runner_trail,
            "tp1_hit":             self.tp1_hit,
            "tp2_hit":             self.tp2_hit,
            "be_stop_active":      self.be_stop_active,
            "use_tp2":             self._use_tp2,
            "qty":                 self.qty,
            "qty_remaining":       self.qty_remaining,
            "cascade_down_ticks":  self._cascade_down_ticks,
            "tp1_confirm_ticks":   self._tp1_ticks,
        }
