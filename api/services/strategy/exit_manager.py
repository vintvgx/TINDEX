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
REVERSAL    — 3 contracts,  TP1 +15% / $0.18 floor, cascade(5 ticks, 50%), be_hold runner
"""

import math
import pytz
from datetime import datetime, time, timedelta
from collections import deque

from services.strategy.profiles import grace_fields_for_minutes

ET = pytz.timezone("America/New_York")

# ─── KILL-SWITCH (added 2026-08-04, re-enabled 2026-08-07) ─────────────────
# Originally hard-disabled both RUNNER_TRAIL_STOP and CASCADE_EXIT after
# runner_mode overrides weren't reliably persisting/taking effect (see
# docs/TODO.md — user reported "None" reverting to "trail" even after the
# runner_cascade migration) — a stale/reverted setting was force-selling
# contracts out from under the user. That persistence bug was NEVER
# root-caused; re-enabling this does not by itself fix it.
#
# Re-enabled 2026-08-07 as a deliberate choice, after a separate problem —
# trail closing the whole runner on a single unconfirmed tick, and cascade/
# trail firing too eagerly to let a real trend develop — was fixed
# independently (see the trail-confirm/incremental-sell/TP2-midpoint-gate
# logic below). That fix addresses "fires too fast," not "runner_mode
# silently reverts" — if the 08-04 persistence bug resurfaces, this is the
# switch to flip back to True, and the underlying override-persistence path
# (ORBEngine / TradeLogger.update_exit_levels) still needs its own look.
_RUNNER_TRAIL_HARD_DISABLED = False
_CASCADE_EXIT_HARD_DISABLED = False

# Sentinel distinguishing "sl_grace_minutes not provided" (leave the current
# stop-type alone) from "sl_grace_minutes explicitly set to None" (switch to
# Hard Stop) in ExitManager.apply_overrides — None itself is a meaningful
# value here, so it can't double as the "not provided" default.
_UNSET = object()


def compute_exit_levels(entry_premium: float, profile: dict) -> tuple[float, float, float]:
    """
    Shared SL/TP1/TP2 calc — used by ExitManager.__init__ for a real position
    and by ORBEngine's pending-confirmation preview (before any order is
    placed), so the two numbers never drift apart.

    Dollar-floored TP targets: TP = max(entry × mult, entry + min_dollars).
    Prevents cheap OTM contracts from locking in noise-level gains on a
    %-only target.
    """
    hard_stop = entry_premium * (1 - profile["max_loss_pct"])
    min_tp1 = profile.get("min_tp1_dollars", 0.0)
    min_tp2 = profile.get("min_tp2_dollars", 0.0)
    tp1 = max(entry_premium * profile["tp1_mult"], entry_premium + min_tp1)
    tp2 = max(entry_premium * profile["tp2_mult"], entry_premium + min_tp2)
    return hard_stop, tp1, tp2


class ExitManager:
    def __init__(self, entry_premium: float, qty: int, fib_levels: dict,
                 direction: str, eod_close_time: str, profile: dict,
                 is_zero_dte: bool = True):
        self.entry_premium  = entry_premium
        self.qty            = qty
        self.qty_remaining  = qty
        self.fib_levels     = fib_levels
        self.direction      = direction
        self.eod_close_time = self._parse_time(eod_close_time)
        self.profile        = profile

        self.entry_time   = datetime.now(ET)

        self.hard_stop, self.tp1, self.tp2 = compute_exit_levels(entry_premium, profile)

        self.runner_trail = entry_premium

        self.tp1_hit        = False
        self.tp2_hit        = False
        self.be_stop_active = False

        # Disable TP2 when the profile explicitly opts out OR when starting with
        # ≤ 2 contracts (TP1 closes one, the other becomes a runner — no TP2 needed).
        # A 1-contract entry is a hard override, not just a default: TP1 hitting
        # always closes the entire position (see qty_tp1's max(1, ...) floor
        # below — floor(1 * any_pct) rounds to 0, then max(1, 0) closes the
        # sole contract), so there is never a runner left for TP2 or cascade to
        # apply to, regardless of what the profile says (SL_5/SL_10/OTM_RUNNER/
        # OTM_CONVICTION all explicitly set use_tp2=True, which would otherwise
        # win over the qty-based default below). 2026-07-29: manage your own
        # runner, or let the stop handle it, for a single-contract trade.
        self._use_tp2 = False if qty <= 1 else profile.get("use_tp2", qty > 2)

        self.orh = fib_levels["orh"]
        self.orl = fib_levels["orl"]

        self._runner_mode  = profile.get("runner_mode", "trail")

        # Consolidation-exit was removed entirely (2026-07-29 — closed winning
        # positions too early on a normal post-TP1 pause; SL/TP1/TP2/cascade
        # now govern exits exclusively). volume_buffer remains for the
        # separate (also currently disabled) low-volume exit.
        self.volume_buffer = deque(maxlen=6)

        # TP1 confirmation: require N consecutive ticks at/above TP1 before firing.
        # Prevents a single ask-side spike from triggering a premature partial close.
        self._tp1_ticks        = 0
        self._tp1_ticks_needed = profile.get("tp1_confirm_ticks", 2)

        # Cascade exit: after TP1, track consecutive underlying candles that
        # close AGAINST the trade (red for a CALL, green for a PUT) — judged
        # by each bar's own open vs. close, not against the previous bar's
        # close (see on_underlying_bar; 2026-07-29 fix — the old cross-bar
        # comparison could count a bearish-looking bar as "recovering" just
        # because it gapped up, or a bullish-looking bar as "against" just
        # because it closed a cent under the prior bar).
        # On N consecutive against-candles, sell cascade_close_pct of
        # non-runner contracts. Always preserves 1 runner contract regardless
        # of cascade count.
        self._cascade_down_ticks   = 0
        self._cascade_ticks_needed = profile.get("cascade_ticks", 3)
        self._cascade_close_pct    = profile.get("cascade_close_pct", 0.50)
        # Mid-trade on/off switch for cascade (see apply_overrides) — separate
        # from the qty_remaining > 1 exemption in evaluate(), which is always
        # in force regardless of this flag. Defaults on for any profile that
        # actually configures cascade.
        self._cascade_enabled      = True

        # SL confirmation: require N consecutive ticks at/below hard_stop before
        # firing — same idea as TP1's confirm-ticks, applied symmetrically so a
        # single noisy quote (wide bid/ask on a cheap OTM contract) can't force
        # an exit on its own. Applies to both the pre-TP1 hard stop and the
        # post-TP1 breakeven stop (same check, same variable — see evaluate()).
        self._sl_ticks        = 0
        self._sl_ticks_needed = profile.get("sl_confirm_ticks", 1)

        # Runner trail confirmation (2026-08-07, revised same day): the trail
        # stop originally had NO confirmation at all — one quote touching the
        # ratcheted floor closed the whole runner instantly. A first pass
        # used a raw tick counter (mirroring sl_confirm_ticks), but "ticks"
        # here means option bid/ask updates — those can arrive several times
        # a SECOND on a liquid 0DTE contract, so a small tick count gives
        # almost no real confirmation window, not meaningfully different from
        # the original bug. Bar-based (mirroring cascade's on_underlying_bar,
        # 1-min candles) would be the other conventional option, but that
        # would need new engine wiring to track option-premium OHLC per bar —
        # nothing in this system aggregates option price into bars today,
        # only the underlying. Elapsed-time is the smallest correct fix:
        # reuses the same "give it real wall-clock time, not N quotes"
        # pattern this codebase already trusts for sl_grace_seconds. Price
        # must sit at/below the ratcheted floor for runner_trail_confirm_
        # seconds of continuous wall-clock time before it fires; any tick
        # back above the floor cancels the timer immediately (see evaluate()).
        self._trail_breach_start    = None
        self._trail_confirm_seconds = profile.get("runner_trail_confirm_seconds", 60)

        # Advanced per-trade qty overrides (set via PATCH .../exits — see
        # apply_overrides) — user-chosen contract counts to sell at the
        # PRE-TP1 hard stop / TP1 / TP2, replacing the profile's fixed
        # percentages. None means "use the profile default" for that level.
        # sl_qty is deliberately partial-only: firing it once sells exactly
        # that many contracts and then _sl_override_consumed permanently
        # disables the pre-TP1 hard stop for whatever's left — the user chose
        # to let the remainder run unprotected (manage it manually, or via
        # TP1/TP2) rather than get a stop that silently keeps re-firing on
        # the same breach every subsequent tick. Never applies to the
        # post-TP1 breakeven stop, which always protects the full remaining
        # runner — see evaluate().
        self._sl_qty_override    = None
        self._tp1_qty_override   = None
        self._tp2_qty_override   = None
        self._sl_override_consumed = False

        # Pre-TP1 SL grace window (REVERSAL only, via profile flags — see
        # profiles.py for the full rationale). Once SL is confirmed hit and
        # grace is enabled, the exit doesn't fire immediately: it waits for
        # either sl_grace_bars consecutive adverse 1-min bars (real move) or
        # sl_grace_seconds of no recovery (stuck at the stop), whichever comes
        # first. sl_outer_floor_pct is an absolute worst-case stop that bypasses
        # grace (and confirm-ticks) entirely, so this can never turn into an
        # unbounded hold. Never applies once be_stop_active — that's protecting
        # already-banked TP1 profit, not giving a fresh entry room to develop.
        self._sl_grace_enabled     = profile.get("sl_grace_enabled", False)
        self._sl_grace_bars_needed = profile.get("sl_grace_bars", 0)
        self._sl_grace_seconds     = profile.get("sl_grace_seconds", 0)
        self._sl_grace_active      = False
        self._sl_grace_start       = None
        self._sl_grace_down_bars   = 0
        self._sl_grace_last_price  = None

        # Recovery-confirmation window (SL_5/SL_10 — see profiles.py): once
        # price ticks back above the hard stop mid-grace, the grace clock
        # does NOT cancel immediately — it only cancels once price has held
        # continuously above the stop for sl_grace_recovery_seconds. A single
        # tick back above the line no longer resets a 5/10-minute wait; the
        # overall grace deadline (_sl_grace_start-based) keeps counting the
        # whole time this recovery is "pending", so a bounce that never holds
        # still gets force-closed on schedule. Defaults to 0 (instant cancel
        # on any recovery tick) so REVERSAL's existing behavior is unchanged.
        self._sl_grace_recovery_seconds = profile.get("sl_grace_recovery_seconds", 0)
        self._sl_recovery_start          = None
        outer_floor_pct = profile.get("sl_outer_floor_pct")
        self._sl_outer_floor = (
            entry_premium * (1 - outer_floor_pct) if outer_floor_pct is not None else None
        )

        # NO_STOP_LOSS: fully manual, hold until sold — even past EOD. The
        # separate scheduler._eod_reset() cron backstop also checks this flag
        # (see scheduler.py); both must agree or "hold until I sell" would
        # still get silently force-closed at 15:30 ET.
        self._disable_eod_close = profile.get("disable_eod_close", False)

        # NO_STOP_LOSS: skip the TP1 auto-close branch entirely (see evaluate()),
        # rather than relying on tp1 being numerically unreachable. Decouples
        # "this profile has zero automatic exits" from "the TP1 number happens
        # to be huge" — tp1/tp2 can now be a normal, sane-looking display value
        # without ever risking an unwanted auto-sell.
        self._disable_tp1_exit = profile.get("disable_tp1_exit", False)

        # EOD_CLOSE below only makes sense for a 0DTE contract — flattening a
        # swing/LEAPS hold every single day at eod_close_time just because the
        # clock crossed that time-of-day would silently sell a multi-week
        # position out from under the user (2026-07-17 incident: an IBM Aug 21
        # and NFLX Sep 18 swing position both force-closed same-day). Defaults
        # True so any caller that doesn't pass this explicitly keeps the
        # original, safer 0DTE behavior. scheduler._eod_reset() has the same
        # gate for its own daily-cron backstop — both must agree.
        self._is_zero_dte = is_zero_dte

    def evaluate(self, current_option_price: float,
                 current_underlying_price: float = None,
                 current_volume: float = None) -> dict:
        now_et = datetime.now(ET).time()

        if self._is_zero_dte and not self._disable_eod_close and now_et >= self.eod_close_time:
            return self._action("CLOSE_ALL", self.qty_remaining, "EOD_CLOSE")

        # Absolute worst-case floor — bypasses SL confirm-ticks and the grace
        # window entirely. A breach this deep is a real breakdown, not noise;
        # this exists so the grace window below can never turn into an
        # unbounded hold while "waiting for the move."
        if self._sl_outer_floor is not None and current_option_price <= self._sl_outer_floor:
            return self._action("CLOSE_ALL", self.qty_remaining, "HARD_STOP_FLOOR",
                                current_option_price)

        # Premium-based stop. Before TP1: hard stop at entry × (1 - max_loss_pct).
        # After TP1: hard_stop is moved to entry_premium (breakeven), so the same
        # check doubles as the BE stop — labeled correctly for analytics.
        #
        # `and not (self._sl_override_consumed and not self.be_stop_active)`:
        # once a partial sl_qty override has fired pre-TP1, this whole branch
        # goes inert for whatever's left of the ORIGINAL stop — the trader
        # explicitly chose to let that remainder run unprotected (manage it
        # manually, or via TP1/TP2) rather than get stopped out again on the
        # very next tick at the same breach. Falls through to the `else`
        # below exactly as if price were back above the stop. This never
        # applies to the post-TP1 breakeven stop, which always protects the
        # full remaining runner regardless of any earlier SL-override history.
        if current_option_price <= self.hard_stop and not (self._sl_override_consumed and not self.be_stop_active):
            self._sl_ticks += 1
            if self._sl_ticks < self._sl_ticks_needed:
                return self._action("HOLD", 0, "SL_CONFIRMING")

            reason = "BREAKEVEN_STOP" if self.be_stop_active else "HARD_STOP"

            # Grace window only applies to the pre-TP1 hard stop — post-TP1 this
            # is protecting already-banked TP1 profit (breakeven), not giving a
            # fresh entry room to develop, so it exits on confirmation like normal.
            if self._sl_grace_enabled and not self.be_stop_active:
                if not self._sl_grace_active:
                    self._sl_grace_active    = True
                    self._sl_grace_start     = datetime.now(ET)
                    self._sl_grace_down_bars = 0
                # Back below the stop — any pending recovery confirmation is
                # moot, since the price didn't actually hold above the line.
                self._sl_recovery_start = None
                elapsed = (datetime.now(ET) - self._sl_grace_start).total_seconds()
                if (self._sl_grace_bars_needed > 0
                        and self._sl_grace_down_bars >= self._sl_grace_bars_needed):
                    action_type, qty = self._resolve_sl_close(reason)
                    return self._action(action_type, qty, reason, current_option_price)
                if self._sl_grace_seconds > 0 and elapsed >= self._sl_grace_seconds:
                    action_type, qty = self._resolve_sl_close(reason)
                    return self._action(action_type, qty, reason, current_option_price)
                return self._action("HOLD", 0, "SL_GRACE")

            action_type, qty = self._resolve_sl_close(reason)
            return self._action(action_type, qty, reason, current_option_price)
        else:
            self._sl_ticks = 0
            if self._sl_grace_active:
                if self._sl_grace_recovery_seconds <= 0:
                    # No recovery-confirmation window configured (e.g.
                    # REVERSAL) — a single recovery tick cancels immediately,
                    # same as always.
                    self._sl_grace_active    = False
                    self._sl_grace_down_bars = 0
                    self._sl_recovery_start  = None
                else:
                    if self._sl_recovery_start is None:
                        self._sl_recovery_start = datetime.now(ET)
                    recovery_elapsed = (datetime.now(ET) - self._sl_recovery_start).total_seconds()
                    if recovery_elapsed >= self._sl_grace_recovery_seconds:
                        # Held above the stop continuously for the full
                        # recovery window — the bounce is real, cancel the
                        # pending stop-out and resume holding normally.
                        self._sl_grace_active    = False
                        self._sl_grace_down_bars = 0
                        self._sl_recovery_start  = None
                    # else: recovery still pending — grace stays active and
                    # its own deadline (checked above, on the next tick that's
                    # back at/below the stop) keeps counting uninterrupted.

        if current_volume is not None:
            self.volume_buffer.append(current_volume)

        secs_held = (datetime.now(ET) - self.entry_time).total_seconds()

        # Minimum 3-minute hold before volume exit
        if secs_held >= 180 and self.profile.get("volume_exit", False) and self._is_low_volume() and not self.tp1_hit:
            qty_lv = max(1, self.qty_remaining // 2)
            return self._action("CLOSE_PARTIAL", qty_lv, "LOW_VOLUME_EXIT",
                                current_option_price)

        # TP1 — requires tp1_confirm_ticks consecutive ticks at/above the level.
        # Price falling back below TP1 mid-count resets the counter.
        # disable_tp1_exit (NO_STOP_LOSS) skips this branch entirely — tp1 is
        # a display-only relative number for that profile, not a real target.
        if not self._disable_tp1_exit and not self.tp1_hit:
            if current_option_price >= self.tp1:
                self._tp1_ticks += 1
                if self._tp1_ticks < self._tp1_ticks_needed:
                    return self._action("HOLD", 0, "TP1_CONFIRMING")
                self.tp1_hit        = True
                # "none" leaves the runner on its original pre-TP1 hard stop —
                # no BE floor, no trail. It only exits via TP2/cascade/EOD/manual.
                if self._runner_mode != "none":
                    self.be_stop_active = True
                    self.hard_stop      = self.entry_premium  # SL moves to breakeven
                if self._runner_mode == "trail":
                    self.runner_trail = current_option_price * (1 - self.profile["runner_trail_pct"])
                # tp1_qty override (see apply_overrides) replaces the
                # profile's fixed tp1_close_pct when set — clamped to what's
                # actually remaining as a defensive floor, though TP1 is
                # always the first exit event so qty_remaining is still the
                # full entry qty in practice.
                if self._tp1_qty_override is not None:
                    qty_tp1 = min(self._tp1_qty_override, self.qty_remaining)
                else:
                    qty_tp1 = max(1, math.floor(self.qty_remaining * self.profile["tp1_close_pct"]))
                return self._action("CLOSE_PARTIAL", qty_tp1, "TP1", current_option_price)
            else:
                self._tp1_ticks = 0

        # TP2 — runner bonus target; only fires if the full move materialises.
        if self._use_tp2 and self.tp1_hit and not self.tp2_hit and current_option_price >= self.tp2:
            self.tp2_hit = True
            # tp2_qty override replaces BOTH the profile's tp2_close_pct AND
            # its tp2_close_pct >= 1.0 full-close behavior when set.
            if self._tp2_qty_override is not None:
                qty_tp2 = min(self._tp2_qty_override, self.qty_remaining)
                if qty_tp2 >= self.qty_remaining:
                    return self._action("CLOSE_ALL", self.qty_remaining, "TP2_FULL_CLOSE",
                                        current_option_price)
                return self._action("CLOSE_PARTIAL", qty_tp2, "TP2", current_option_price)
            if self.profile["tp2_close_pct"] >= 1.0:
                return self._action("CLOSE_ALL", self.qty_remaining, "TP2_FULL_CLOSE",
                                    current_option_price)
            qty_tp2 = max(1, math.floor(self.qty_remaining * self.profile["tp2_close_pct"]))
            return self._action("CLOSE_PARTIAL", qty_tp2, "TP2", current_option_price)

        # Trail stop (trail mode only) — be_hold skips this; BE stop is the floor.
        # Sells exactly ONE contract per confirmed dip, then resets its own
        # confirm timer and keeps trailing whatever's left, same cascade-like
        # shape as the block below — it never dumps the whole runner at once
        # (2026-08-07: the old CLOSE_ALL-on-first-touch behavior cut real
        # continuations short as hard as an unconfirmed single tick did).
        # qty_remaining > 1 (not > 0) is the same "always preserve 1" floor
        # cascade uses: once only the last contract is left, trail stops
        # firing entirely and that contract exits only via TP2/BE stop/EOD/
        # manual — trail alone can never fully close a position, only the
        # (breakeven-moved) hard stop can.
        if (not _RUNNER_TRAIL_HARD_DISABLED and self._runner_mode == "trail"
                and self.tp1_hit and self.qty_remaining > 1):
            new_trail = current_option_price * (1 - self.profile["runner_trail_pct"])
            if new_trail > self.runner_trail:
                self.runner_trail = new_trail

            # TP2 hitting is real conviction the move is working — don't let
            # trail nip at the very next tick down off that high. Stay fully
            # inactive (still ratcheting the floor above, just not acting on
            # it) until price gives back enough to reach the TP1/TP2
            # midpoint — a genuine pullback signal, not the first breath —
            # then resume normal trail behavior against the floor already
            # built up. AND'd with the ratchet check below, not instead of
            # it: the midpoint is an extra floor layered under a tight
            # runner_trail_pct, not a replacement for it.
            trail_armed = True
            if self.tp2_hit:
                midpoint = (self.tp1 + self.tp2) / 2
                trail_armed = current_option_price <= midpoint

            if trail_armed and current_option_price <= self.runner_trail:
                if self._trail_breach_start is None:
                    self._trail_breach_start = datetime.now(ET)
                elapsed = (datetime.now(ET) - self._trail_breach_start).total_seconds()
                if elapsed < self._trail_confirm_seconds:
                    return self._action("HOLD", 0, "RUNNER_TRAIL_CONFIRMING")
                self._trail_breach_start = None
                return self._action("CLOSE_PARTIAL", 1, "RUNNER_TRAIL_STOP",
                                    current_option_price)
            else:
                self._trail_breach_start = None

        # Cascade exit — fires when on_underlying_bar() has accumulated enough
        # consecutive against-the-trade candles (bar cadence, not quote cadence).
        # Always preserves 1 runner contract; that runner exits only via TP2/BE/EOD/manual —
        # never cascade. This qty_remaining > 1 gate is also what makes a
        # 1-contract entry cascade-exempt entirely: it never has more than 1 to
        # begin with (in practice it never even reaches here, since TP1 already
        # closes it in full — see _use_tp2 above), so "manage your own runner,
        # or let the stop handle it" already holds for both the single-contract
        # case and the runner of any multi-contract trade.
        if (not _CASCADE_EXIT_HARD_DISABLED and self._cascade_enabled
                and self.tp1_hit and self.qty_remaining > 1):
            if self._cascade_down_ticks >= self._cascade_ticks_needed:
                self._cascade_down_ticks = 0
                sellable    = self.qty_remaining - 1
                qty_cascade = min(max(1, math.floor(sellable * self._cascade_close_pct)),
                                  sellable)
                return self._action("CLOSE_PARTIAL", qty_cascade, "CASCADE_EXIT",
                                    current_option_price)

        return self._action("HOLD", 0, "")

    def _resolve_sl_close(self, reason: str) -> tuple[str, int]:
        """
        Qty to actually close when the pre-TP1 hard stop fires, honoring an
        sl_qty override (see apply_overrides). Only ever partial for
        reason=="HARD_STOP" — BREAKEVEN_STOP always closes in full, since
        that's protecting the whole remaining runner's already-banked TP1
        profit, not a fresh entry the trader chose to partially self-insure.
        Marks the override consumed the moment it fires a genuine partial —
        see the guard in evaluate() that goes inert afterward.
        """
        if reason == "HARD_STOP" and self._sl_qty_override is not None:
            qty = min(self._sl_qty_override, self.qty_remaining)
            if qty < self.qty_remaining:
                self._sl_override_consumed = True
                return "CLOSE_PARTIAL", qty
        return "CLOSE_ALL", self.qty_remaining

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

    def on_underlying_bar(self, open_: float, close: float) -> None:
        """
        Feed one 1-minute bar into the cascade tracker (post-TP1) or the SL
        grace-window tracker (pre-TP1). Must be called from on_bar (bar
        cadence), NOT from quote-tick handlers — inter-bar quotes repeat the
        same underlying price and would reset the counter.

        Pre-TP1 (SL grace) still compares this bar's close to the PREVIOUS
        bar's close — that tracker cares about a sustained adverse drift
        while sitting at the stop, not candle shape.

        Post-TP1 (cascade) instead judges each bar by its OWN open vs. close
        — a genuinely red (bearish) candle for a CALL, green (bullish) for a
        PUT — not by comparing to the previous bar's close. The two diverge
        exactly in the noisy post-TP1 window: a bar can gap up and still
        close red while remaining above the prior bar's close (old logic
        called that "recovering"), or be green yet close a cent under the
        prior bar's close (old logic called that "against"). Neither matches
        "3 red candles in a row," which is what cascade is meant to detect
        (2026-07-29 fix — see the cascade-exit-too-eager incident). A doji
        (close == open) is no information either way, same as an equal close
        was under the old comparison — counter unchanged.
        """
        if not self.tp1_hit:
            # Pre-TP1: feed the SL grace window's consecutive-adverse-bar
            # counter (only meaningful while sl_grace_active — see evaluate()
            # — but tracked unconditionally so the count is already warm the
            # moment grace kicks in, not starting from zero on that first bar).
            if self._sl_grace_last_price is not None:
                against = (
                    close < self._sl_grace_last_price if self.direction == "CALL"
                    else close > self._sl_grace_last_price
                )
                recovering = (
                    close > self._sl_grace_last_price if self.direction == "CALL"
                    else close < self._sl_grace_last_price
                )
                if against:
                    self._sl_grace_down_bars += 1
                elif recovering:
                    self._sl_grace_down_bars = 0
            self._sl_grace_last_price = close
            return  # cascade is only relevant after TP1

        is_red   = close < open_
        is_green = close > open_
        against    = is_red   if self.direction == "CALL" else is_green
        recovering = is_green if self.direction == "CALL" else is_red
        if against:
            self._cascade_down_ticks += 1
        elif recovering:
            self._cascade_down_ticks = 0
        # doji (close == open) → leave counter unchanged

    def update_qty(self, qty_closed: int) -> None:
        """Call after executing a partial close so remaining contract count stays accurate."""
        self.qty_remaining = max(0, self.qty_remaining - qty_closed)

    def apply_overrides(self, hard_stop: float | None = None, tp1: float | None = None,
                        tp2: float | None = None, sl_qty: int | None = None,
                        tp1_qty: int | None = None, tp2_qty: int | None = None,
                        sl_grace_minutes=_UNSET,
                        runner_mode: str | None = None,
                        cascade_enabled: bool | None = None) -> dict:
        """
        Validate and apply user-supplied SL/TP1/TP2 price and/or qty overrides
        to this (already open) position. Raises ValueError with a user-facing
        message on invalid input — never partially applies a rejected field.

        sl_qty/tp1_qty/tp2_qty are the "Advanced" per-level contract counts
        (see EditExitsModal) — how many of qty_remaining to sell at that
        level, replacing the profile's fixed close percentage. Only available
        when use_tp2 (qty > 1 at entry — see __init__); a 1-contract trade has
        no runner to split, so there is nothing for these to override. sl_qty
        is a genuine partial: firing it once sells exactly that many and
        leaves the rest running unprotected (see _resolve_sl_close) — the
        trader is explicitly choosing that trade-off, not asking for a lower
        stop.

        sl_grace_minutes is the independent per-trade "stop type" choice —
        None (or omitted) means Hard Stop, 5/10/15 arms the matching grace
        window (see profiles.py's grace_fields_for_minutes) on top of
        whatever sizing profile this trade already uses, decoupled from the
        SL_5/SL_10 profile identities. Omit the kwarg entirely to leave the
        current stop type untouched — it uses a sentinel default (not None)
        specifically so "not provided" and "explicitly switch to Hard Stop"
        are distinguishable.

        runner_mode ("trail"/"be_hold"/"none") and cascade_enabled let the
        user change how the runner is managed on an OPEN position — e.g. flip
        off cascade mid-trade if they've decided to just let the runner ride.
        Neither touches qty_remaining > 1 in evaluate(), which always exempts
        a single-contract runner from both regardless of these flags.

        Shared by the mid-trade PATCH /configs/<id>/exits route and the
        confirm-entry approve path (edited fields from the confirmation modal,
        applied right after the real fill so levels are relative to the actual
        entry premium, not the pre-fill estimate shown in the modal).
        """
        if hard_stop is not None and hard_stop <= 0:
            raise ValueError("hard_stop must be > 0")
        if runner_mode is not None and runner_mode not in ("trail", "be_hold", "none"):
            raise ValueError("runner_mode must be 'trail', 'be_hold', or 'none'")
        if tp1 is not None and tp1 <= self.entry_premium:
            raise ValueError("tp1 must be above entry premium")
        for label, qty in (("Stop-loss", sl_qty), ("TP1", tp1_qty), ("TP2", tp2_qty)):
            if qty is not None and (qty < 1 or qty > self.qty_remaining):
                raise ValueError(f"{label} quantity must be between 1 and {self.qty_remaining}")
        if tp2_qty is not None and not self._use_tp2:
            raise ValueError("TP2 is not available for this position (single contract)")
        grace_fields = None
        if sl_grace_minutes is not _UNSET:
            grace_fields = grace_fields_for_minutes(sl_grace_minutes)  # raises ValueError on bad input

        changed = {}
        if hard_stop is not None:
            self.hard_stop = hard_stop
            changed["hard_stop"] = round(hard_stop, 4)
        if tp1 is not None:
            self.tp1 = tp1
            changed["tp1"] = round(tp1, 4)
        if tp2 is not None:
            self.tp2 = tp2
            changed["tp2"] = round(tp2, 4)
        if sl_qty is not None:
            self._sl_qty_override = sl_qty
            changed["sl_qty"] = sl_qty
        if tp1_qty is not None:
            self._tp1_qty_override = tp1_qty
            changed["tp1_qty"] = tp1_qty
        if tp2_qty is not None:
            self._tp2_qty_override = tp2_qty
            changed["tp2_qty"] = tp2_qty
        if grace_fields is not None:
            self._sl_grace_enabled = grace_fields["sl_grace_enabled"]
            self._sl_grace_seconds = grace_fields.get("sl_grace_seconds", 0)
            self._sl_grace_recovery_seconds = grace_fields.get("sl_grace_recovery_seconds", 0)
            outer_floor_pct = grace_fields.get("sl_outer_floor_pct")
            self._sl_outer_floor = (
                self.entry_premium * (1 - outer_floor_pct) if outer_floor_pct is not None else None
            )
            if not self._sl_grace_enabled:
                # Switching to Hard Stop cancels any grace window already in
                # progress — a pending countdown shouldn't linger after the
                # user deliberately turns the timer off.
                self._sl_grace_active    = False
                self._sl_grace_down_bars = 0
                self._sl_grace_start     = None
                self._sl_recovery_start  = None
            changed["sl_grace_minutes"] = sl_grace_minutes
        if runner_mode is not None:
            self._runner_mode = runner_mode
            changed["runner_mode"] = runner_mode
        if cascade_enabled is not None:
            self._cascade_enabled = cascade_enabled
            changed["cascade_enabled"] = cascade_enabled
        return changed

    def to_dict(self) -> dict:
        # Absolute timestamps (not durations) so a client never has to run its
        # own independent countdown clock — it just computes
        # deadline - now() every render, anchored to the same instant the
        # backend is anchored to. See the 2026-07-27 SL_5/SL_10 discussion.
        sl_grace_deadline = (
            (self._sl_grace_start + timedelta(seconds=self._sl_grace_seconds)).isoformat()
            if self._sl_grace_active and self._sl_grace_start else None
        )
        sl_recovery_deadline = (
            (self._sl_recovery_start + timedelta(seconds=self._sl_grace_recovery_seconds)).isoformat()
            if self._sl_grace_active and self._sl_recovery_start else None
        )
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
            # Whether SL/TP are actually live for this trade — explicit
            # booleans rather than making the client infer it from hard_stop
            # being near 0 or tp1 being unset, which is ambiguous for a
            # legitimately cheap contract. sl_enabled mirrors the
            # NO_STOP_LOSS convention (max_loss_pct >= 1.0 == unreachable);
            # tp_enabled mirrors disable_tp1_exit (2026-08-30 — the SL/TP
            # enable toggle, see immediate-trade route).
            "sl_enabled":          self.profile.get("max_loss_pct", 0) < 1.0,
            "tp_enabled":          not self._disable_tp1_exit,
            # Current runner/cascade CONFIGURATION for this open trade — lets
            # a client (EditExitsModal) pre-select the toggle to what's
            # actually in effect right now, not just the profile default.
            "runner_mode":         self._runner_mode,
            "cascade_enabled":     self._cascade_enabled,
            "cascade_down_ticks":  self._cascade_down_ticks,
            "tp1_confirm_ticks":   self._tp1_ticks,
            "sl_confirm_ticks":    self._sl_ticks,
            "sl_grace_active":       self._sl_grace_active,
            "sl_grace_down_bars":    self._sl_grace_down_bars,
            "sl_grace_deadline":     sl_grace_deadline,
            "sl_recovery_deadline":  sl_recovery_deadline,
            # Stop-type CONFIGURATION (not just runtime grace state) — lets a
            # client (e.g. EditExitsModal) know which tab to pre-select.
            "sl_grace_enabled":      self._sl_grace_enabled,
            "sl_grace_minutes":      (self._sl_grace_seconds // 60) if self._sl_grace_enabled else None,
            # "Advanced" per-level qty overrides — null means "profile default".
            "sl_qty":                self._sl_qty_override,
            "tp1_qty":               self._tp1_qty_override,
            "tp2_qty":               self._tp2_qty_override,
            "sl_override_consumed":  self._sl_override_consumed,
        }
