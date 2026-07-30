"""
Trading profile definitions for the TINDEX ORB strategy.

Three profiles control sizing, strike selection, and exit behavior.
All profile-dependent logic in other modules reads from here — nothing hardcoded elsewhere.

runner_mode controls what happens to remaining contracts after TP1 is hit:
  "be_hold" — runner sits at breakeven stop, rides to TP2 target then EOD. No trail noise.
  "trail"   — traditional high-water-mark trailing stop (runner_trail_pct from peak).
"""

import logging

logger = logging.getLogger(__name__)

PROFILES = {
    # ─── BULL DOG — Aggressive ───────────────────────────────────────────────────
    "BULL_DOG": {
        "qty_contracts": 10,
        "max_loss_pct": 0.40,
        "tp1_mult": 1.20,           # lowered from 1.75 — +20% is reachable; TP1 locks profit and moves SL to entry
        "tp2_mult": 2.50,
        "tp1_close_pct": 0.50,      # raised from 0.30 — close half at TP1, runner rides risk-free
        "tp1_confirm_ticks": 2,     # require 2 consecutive ticks at TP1 before firing
        "min_tp1_dollars": 0.35,    # floor: TP1 gain must be at least $0.35/share regardless of entry price
        "min_tp2_dollars": 1.00,
        "cascade_ticks": 3,         # 3 consecutive underlying down-ticks triggers a cascade sell
        "cascade_close_pct": 0.50,  # sell 50% of non-runner contracts per cascade event
        "tp2_close_pct": 0.30,
        "runner_trail_pct": 0.15,
        "runner_mode": "be_hold",   # high-qty aggressive — ride the full move, B/E protects runner
        "sl_confirm_ticks": 2,      # require 2 consecutive ticks at/below SL before firing — filters one bad quote
        "volume_exit": False,
        "volume_exit_threshold": 0.10,
        "strike_offset_min": 1.00,
        "strike_offset_max": 3.00,
        "target_delta_min": 0.28,
        "target_delta_max": 0.45,
        "eod_buffer_minutes": 20,
        "breakout_time_limit_min": 60,
        "vix_max_override": 35,
        "daily_loss_limit": 600,        # pause strategy if session P&L drops below -$600
        "re_entry_cooldown_min": 60,    # block same-direction re-entry for 60 min after a loss
    },
    # ─── THUNDER CAT — Balanced (DEFAULT) ────────────────────────────────────────
    "THUNDER_CAT": {
        "qty_contracts": 6,
        "max_loss_pct": 0.35,
        "tp1_mult": 1.20,           # lowered from 1.50 — +20% is achievable on normal breakout
        "tp2_mult": 2.00,
        "tp1_close_pct": 0.50,
        "tp1_confirm_ticks": 2,
        "min_tp1_dollars": 0.25,
        "min_tp2_dollars": 0.75,
        "cascade_ticks": 3,
        "cascade_close_pct": 0.50,
        "tp2_close_pct": 0.50,
        "runner_trail_pct": 0.22,   # loosened from 0.20 — less noise sensitivity
        "runner_mode": "trail",
        "sl_confirm_ticks": 2,
        "volume_exit": False,
        "volume_exit_threshold": 0.20,
        "strike_offset_min": 1.00,  # raised from 0.50 — confirmation entry is already past the ORH; 0.50 selects strikes that are ITM at fill
        "strike_offset_max": 2.00,
        "target_delta_min": 0.38,
        "target_delta_max": 0.58,
        "eod_buffer_minutes": 25,
        "breakout_time_limit_min": 45,
        "vix_max_override": 30,
        "daily_loss_limit": 400,
        "re_entry_cooldown_min": 45,
    },
    # ─── WOLF — Conservative ─────────────────────────────────────────────────────
    "WOLF": {
        "qty_contracts": 3,
        "max_loss_pct": 0.25,
        "tp1_mult": 1.15,           # lowered from 1.35 — conservative profile, grab +15% fast
        "tp2_mult": 1.70,
        "tp1_close_pct": 0.67,
        "tp1_confirm_ticks": 2,
        "min_tp1_dollars": 0.20,
        "min_tp2_dollars": 0.55,
        "cascade_ticks": 3,
        "cascade_close_pct": 0.50,
        "tp2_close_pct": 1.00,
        "runner_trail_pct": 0.20,   # loosened from 0.10 — 10% was firing on bid/ask spread alone
        "runner_mode": "trail",
        "sl_confirm_ticks": 3,      # low qty/conservative — a bit more noise tolerance before cutting
        "volume_exit": False,
        "volume_exit_threshold": 0.30,
        "strike_offset_min": 0.50,
        "strike_offset_max": 1.25,
        "target_delta_min": 0.42,
        "target_delta_max": 0.58,
        "eod_buffer_minutes": 30,
        "breakout_time_limit_min": 35,
        "vix_max_override": 25,
        "daily_loss_limit": 200,
        "re_entry_cooldown_min": 30,
    },
    # ─── TREND RIDER — Hold for the full move ────────────────────────────────────
    "TREND_RIDER": {
        "qty_contracts": 6,
        "max_loss_pct": 0.30,    # reduced from 0.38 — at $2+ entries, 38% = $600+ per trade; 30% caps it at $470
        "tp1_mult": 1.15,           # lowered from 1.40 — +15% fires on the initial burst; SL moves to entry, runner is risk-free
        "tp2_mult": 2.50,
        "tp1_close_pct": 0.50,      # raised from 0.15 — close half at TP1; 0.15 only closed 1/6 contracts and left too much exposed
        "tp1_confirm_ticks": 2,
        "min_tp1_dollars": 0.30,
        "min_tp2_dollars": 0.90,
        "cascade_ticks": 3,
        "cascade_close_pct": 0.50,
        "tp2_close_pct": 0.35,
        "runner_trail_pct": 0.18,   # kept for reference; ignored when runner_mode="be_hold"
        "runner_mode": "be_hold",   # designed for this — lock TP1, ride runner to TP2/EOD risk-free
        "sl_confirm_ticks": 2,
        "volume_exit": False,
        "volume_exit_threshold": 0.10,
        "strike_offset_min": 1.25,  # raised from 0.50 — BREAK entry fires after confirmation, underlying is already past ORH; force at least 1.25 OTM so we're not buying ITM at fill
        "strike_offset_max": 2.50,  # widened from 2.00 — give scorer room to find a cleaner OTM strike
        "target_delta_min": 0.30,
        "target_delta_max": 0.48,
        "eod_buffer_minutes": 15,
        "breakout_time_limit_min": 180,  # extended from 90 — with 30-min cooldown after a loss, re-entry eligible from 10:29 AM to 12:45 PM ET
        "vix_max_override": 25,
        "entry_mode": "BREAK",
        "bar_close_confirm": True,  # wait for a bar to CLOSE above ORH before entering; blocks fakeout/wick entries
        "max_retest_attempts": 1,  # re-arm once after a failed bar-close before giving up on the session
        "daily_loss_limit": 500,
        "re_entry_cooldown_min": 30,
    },
    # ─── REVERSAL — Enter the opposite contract after a scored failed breakout ───
    "REVERSAL": {
        "qty_contracts":          3,
        "force_smart_qty":        True,
        "min_smart_qty":          2,
        "use_tp2":                True,
        "max_loss_pct":           0.25,   # tightened from 0.35 — reversals are cut early; long bleeds don't recover
        "tp1_mult":               1.15,   # lowered from 1.30 — grab +15% fast; reversals can snap back
        "tp2_mult":               1.70,   # lowered from 2.30 — realistic target without full push
        "tp1_close_pct":          0.50,   # raised from 0.33 — close half at TP1; SL moves to entry for runner
        "tp1_confirm_ticks":      2,
        "min_tp1_dollars":        0.18,
        "min_tp2_dollars":        0.50,
        "cascade_ticks":          5,    # raised from 3 — 3-bar bounces are intraday noise on a trending day; 5 consecutive bars against = genuine recovery
        "cascade_close_pct":      0.50,
        "tp2_close_pct":          0.50,   # close 1 of 2 remaining at TP2, leave 1 runner
        "runner_trail_pct":       0.18,   # kept for reference; ignored in be_hold mode
        "runner_mode":            "be_hold", # trail exited within seconds on fast moves; cascade (now direction-aware) handles runner reduction
        "sl_confirm_ticks":       3,    # cheap OTM prints are noisy — require 3 consecutive ticks at/below SL, not 1
        # ── Pre-TP1 SL grace window (2026-07-24) ──────────────────────────────
        # A single quote piercing SL on a cheap ($0.10-0.30) OTM reversal contract
        # is often bid/ask noise, not a real breakdown — the 2026-07-23 SPY trade
        # was stopped out in 2m39s on exactly this. Once SL is first touched
        # (and sl_confirm_ticks above has confirmed it's not a 1-tick flicker),
        # this holds the position open a bit longer instead of closing instantly:
        #   - sl_grace_bars consecutive adverse 1-min underlying closes → exit
        #     immediately (real, sustained move against us — don't wait out
        #     the rest of the window).
        #   - otherwise, exit once sl_grace_seconds has elapsed without the
        #     price recovering back above SL (consolidating at the stop is
        #     still eventually a loser).
        #   - if price recovers above SL at any point before either fires,
        #     the grace state clears and the trade holds normally.
        # sl_outer_floor_pct is the escape hatch: an absolute worst-case stop
        # that bypasses grace (and tick-confirm) entirely, so "give it time"
        # can never turn into "ride it to zero" while waiting out the window.
        "sl_grace_enabled":       True,
        "sl_grace_bars":          3,     # ~3 consecutive 1-min bars against = genuine move, don't wait
        "sl_grace_seconds":       300,   # 5 minutes max before forcing the exit regardless
        "sl_outer_floor_pct":     0.40,  # hard floor at -40% (vs. -25% normal SL) — bypasses grace/confirm
        "volume_exit":            False,
        "volume_exit_threshold":  0.20,
        "strike_offset_min":      0.50,
        "strike_offset_max":      2.00,
        "target_delta_min":       0.38,
        "target_delta_max":       0.58,
        "eod_buffer_minutes":     25,
        "breakout_time_limit_min": 240,
        "vix_max_override":       45,
        "entry_mode":             "BREAK",
        "daily_loss_limit":       400,
        "re_entry_cooldown_min":  120,   # 2 hours — a failed reversal rarely works again same day
    },
    # ── IMMEDIATE TRADE PROFILES ──────────────────────────────────────────────────

    # ─── NO_STOP_LOSS — Fully manual, hold until sold ────────────────────────────
    # No automatic exit of any kind: hard_stop=0 never triggers on a real quote,
    # disable_tp1_exit=True makes ExitManager.evaluate() skip the TP1 branch
    # entirely (see exit_manager.py) rather than relying on an unreachable price,
    # and disable_eod_close=True skips BOTH the ExitManager.evaluate() EOD_CLOSE
    # branch AND the separate scheduler._eod_reset() 15:30 ET hard-close cron (see
    # scheduler.py) — the two are independent mechanisms and both must respect this
    # flag for "hold until I sell" to actually mean never, not just "not before 3:30".
    # tp1_mult/tp2_mult are now a normal, relative-looking target (not the old
    # 999x-entry sentinel) purely for display — disable_tp1_exit (and use_tp2
    # =False for TP2) guarantees neither can ever actually fire regardless of
    # what these numbers are, so there's no tension between "looks like a sane
    # price" and "still 100% manual" (2026-07-29: the old 999x number read as
    # an outlandish, confusing price on the position card).
    # qty_contracts=1 by design — no-stop-loss risk should default to the smallest
    # possible size; submit_manual_trade only overrides qty if the caller passes one.
    "NO_STOP_LOSS": {
        "qty_contracts":           1,
        "use_tp2":                 False,
        "disable_tp1_exit":        True,
        "max_loss_pct":            1.0,
        "tp1_mult":                1.20,
        "tp2_mult":                1.35,
        "tp1_close_pct":           0.00,
        "tp2_close_pct":           0.00,
        "runner_trail_pct":        0.00,
        "runner_mode":             "trail",
        "sl_confirm_ticks":        2,   # irrelevant in practice — max_loss_pct=1.0 means hard_stop=0, never reached
        "disable_eod_close":       True,
        "volume_exit":             False,
        "volume_exit_threshold":   0.20,
        "strike_offset_min":       0.50,
        "strike_offset_max":       2.00,
        "target_delta_min":        0.38,
        "target_delta_max":        0.58,
        "eod_buffer_minutes":      25,
        "breakout_time_limit_min": 240,
        "vix_max_override":        50,
    },
    # ─── SL_5 — Sub-$0.50 contracts, 5-min stop-loss grace timer ────────────────
    # For cheap/leveraged contracts where a normal instant stop whipsaws on
    # noise: once the premium confirms at/below the hard stop, this DOESN'T
    # sell immediately — it starts a 5-minute clock (sl_grace_seconds). Only
    # force-closes at "best price" if the premium is STILL at/below the stop
    # when the clock runs out. A recovery above the stop only cancels the
    # clock once it holds for sl_grace_recovery_seconds (60s) continuously —
    # a single tick back above the line doesn't reset anything (see
    # ExitManager.evaluate()/2026-07-27 discussion). sl_outer_floor_pct is an
    # absolute worst-case bypass so a real breakdown can't hide behind the grace
    # window. TP/sizing otherwise mirrors OTM_CONVICTION ($0.25–$0.50 band).
    "SL_5": {
        "qty_contracts":            6,
        "use_tp2":                  True,
        "max_loss_pct":             0.55,
        "tp1_mult":                 1.75,
        "tp2_mult":                 3.00,
        "tp1_close_pct":            0.33,
        "tp2_close_pct":            0.50,
        "runner_trail_pct":         0.20,
        "runner_mode":              "be_hold",
        "sl_confirm_ticks":         3,
        "sl_grace_enabled":         True,
        "sl_grace_seconds":         300,
        "sl_grace_recovery_seconds": 60,
        "sl_outer_floor_pct":       0.80,
        "volume_exit":              False,
        "volume_exit_threshold":    0.12,
        "strike_offset_min":        1.00,
        "strike_offset_max":        4.00,
        "target_delta_min":         0.10,
        "target_delta_max":         0.35,
        "eod_buffer_minutes":       15,
        "breakout_time_limit_min":  240,
        "vix_max_override":         55,
    },
    # ─── SL_10 — Sub-$0.25 contracts, 10-min stop-loss grace timer ──────────────
    # Same mechanism as SL_5, doubled to 10 minutes — for the noisiest, most
    # leveraged tier (sub-$0.25). TP/sizing mirrors OTM_RUNNER.
    "SL_10": {
        "qty_contracts":            10,
        "use_tp2":                  True,
        "max_loss_pct":             0.60,
        "tp1_mult":                 2.00,
        "tp2_mult":                 3.50,
        "tp1_close_pct":            0.25,
        "tp2_close_pct":            0.33,
        "runner_trail_pct":         0.20,
        "runner_mode":              "trail",
        "sl_confirm_ticks":         4,
        "sl_grace_enabled":         True,
        "sl_grace_seconds":         600,
        "sl_grace_recovery_seconds": 60,
        "sl_outer_floor_pct":       0.85,
        "volume_exit":              False,
        "volume_exit_threshold":    0.10,
        "strike_offset_min":        1.00,
        "strike_offset_max":        5.00,
        "target_delta_min":         0.08,
        "target_delta_max":         0.28,
        "eod_buffer_minutes":       15,
        "breakout_time_limit_min":  240,
        "vix_max_override":         60,
    },
    # ─── SCALPER — Quick locks, tight trail ──────────────────────────────────────
    "SCALPER": {
        "qty_contracts":           3,
        "max_loss_pct":            0.30,
        "tp1_mult":                1.30,
        "tp2_mult":                1.60,
        "tp1_close_pct":           0.67,
        "tp2_close_pct":           1.00,
        "runner_trail_pct":        0.25,   # intentionally tight — scalper exits fast
        "runner_mode":             "trail",
        "sl_confirm_ticks":        1,   # scalper is designed to cut fast — no added delay on the SL either
        "volume_exit":             False,
        "volume_exit_threshold":   0.25,
        "strike_offset_min":       0.50,
        "strike_offset_max":       1.50,
        "target_delta_min":        0.40,
        "target_delta_max":        0.55,
        "eod_buffer_minutes":      30,
        "breakout_time_limit_min": 240,
        "vix_max_override":        35,
    },
    # ─── PRECISION — Disciplined, ATM, tight stop ────────────────────────────────
    "PRECISION": {
        "qty_contracts":           2,
        "max_loss_pct":            0.25,
        "tp1_mult":                1.40,
        "tp2_mult":                1.80,
        "tp1_close_pct":           0.50,
        "tp2_close_pct":           1.00,
        "runner_trail_pct":        0.22,   # loosened from 0.20
        "runner_mode":             "trail",
        "sl_confirm_ticks":        2,   # disciplined/tight by design — light noise filter only
        "volume_exit":             False,
        "volume_exit_threshold":   0.20,
        "strike_offset_min":       0.50,
        "strike_offset_max":       1.50,
        "target_delta_min":        0.42,
        "target_delta_max":        0.55,
        "eod_buffer_minutes":      30,
        "breakout_time_limit_min": 240,
        "vix_max_override":        30,
    },
    # ─── MOMENTUM — Ride the move, small TP1, let runner go ─────────────────────
    "MOMENTUM": {
        "qty_contracts":           6,
        "max_loss_pct":            0.40,
        "tp1_mult":                1.20,
        "tp2_mult":                1.50,
        "tp1_close_pct":           0.25,
        "tp2_close_pct":           0.50,
        "runner_trail_pct":        0.18,   # kept for reference; ignored when runner_mode="be_hold"
        "runner_mode":             "be_hold", # small TP1 close → runner rides to TP2 then EOD
        "sl_confirm_ticks":        3,
        "volume_exit":             False,
        "volume_exit_threshold":   0.15,
        "strike_offset_min":       0.50,
        "strike_offset_max":       2.00,
        "target_delta_min":        0.35,
        "target_delta_max":        0.50,
        "eod_buffer_minutes":      20,
        "breakout_time_limit_min": 240,
        "vix_max_override":        35,
    },
    # ─── CONVICTION — High confidence, runner-focused ────────────────────────────
    "CONVICTION": {
        "qty_contracts":           6,
        "max_loss_pct":            0.45,
        "tp1_mult":                1.15,
        "tp2_mult":                1.35,
        "tp1_close_pct":           0.20,
        "tp2_close_pct":           0.35,
        "runner_trail_pct":        0.15,   # kept for reference; ignored when runner_mode="be_hold"
        "runner_mode":             "be_hold", # tiny TP1 close — almost all rides to TP2/EOD
        "sl_confirm_ticks":        3,
        "volume_exit":             False,
        "volume_exit_threshold":   0.10,
        "strike_offset_min":       0.50,
        "strike_offset_max":       2.00,
        "target_delta_min":        0.30,
        "target_delta_max":        0.48,
        "eod_buffer_minutes":      15,
        "breakout_time_limit_min": 240,
        "vix_max_override":        40,
    },
    # ─── ALL_IN — Max size, let it run until EOD ─────────────────────────────────
    "ALL_IN": {
        "qty_contracts":           8,
        "use_tp2":                 False,
        "max_loss_pct":            0.50,
        "tp1_mult":                1.10,
        "tp2_mult":                2.00,
        "tp1_close_pct":           0.50,
        "tp2_close_pct":           0.00,
        "runner_trail_pct":        0.12,   # kept for reference; ignored when runner_mode="be_hold"
        "runner_mode":             "be_hold", # close half at TP1, ride the rest to EOD or B/E
        "sl_confirm_ticks":        2,
        "volume_exit":             False,
        "volume_exit_threshold":   0.08,
        "strike_offset_min":       0.50,
        "strike_offset_max":       2.50,
        "target_delta_min":        0.28,
        "target_delta_max":        0.45,
        "eod_buffer_minutes":      10,
        "breakout_time_limit_min": 240,
        "vix_max_override":        50,
    },

    # ─── OTM_RUNNER — Sub-$0.25 contracts, large move thesis ────────────────────
    "OTM_RUNNER": {
        "qty_contracts":           10,
        "use_tp2":                 True,
        "max_loss_pct":            0.60,
        "tp1_mult":                2.00,   # +100%: only fires if underlying actually moves
        "tp2_mult":                3.50,   # +250%: full $2–$3 IWM move target
        "tp1_close_pct":           0.25,   # close 25% at TP1 to recover cost basis
        "tp2_close_pct":           0.33,   # close 33% of remainder at TP2
        "runner_trail_pct":        0.20,
        "runner_mode":             "trail",
        "sl_confirm_ticks":        4,   # sub-$0.25 contracts — noisiest quotes in the book, needs the most confirmation
        "volume_exit":             False,
        "volume_exit_threshold":   0.10,
        "strike_offset_min":       1.00,
        "strike_offset_max":       5.00,
        "target_delta_min":        0.08,
        "target_delta_max":        0.28,
        "eod_buffer_minutes":      15,
        "breakout_time_limit_min": 240,
        "vix_max_override":        60,
    },
    # ─── OTM_CONVICTION — $0.25–$0.40 contracts, higher-confidence OTM play ────
    "OTM_CONVICTION": {
        "qty_contracts":           6,
        "use_tp2":                 True,
        "max_loss_pct":            0.55,
        "tp1_mult":                1.75,   # +75%
        "tp2_mult":                3.00,   # +200%
        "tp1_close_pct":           0.33,   # close 33% at TP1
        "tp2_close_pct":           0.50,   # close 50% of remainder at TP2
        "runner_trail_pct":        0.20,
        "runner_mode":             "be_hold",
        "sl_confirm_ticks":        3,   # $0.25-0.40 contracts — noisier than a normal ATM/OTM breakout play
        "volume_exit":             False,
        "volume_exit_threshold":   0.12,
        "strike_offset_min":       1.00,
        "strike_offset_max":       4.00,
        "target_delta_min":        0.10,
        "target_delta_max":        0.35,
        "eod_buffer_minutes":      15,
        "breakout_time_limit_min": 240,
        "vix_max_override":        55,
    },
    # ─── MANUAL — User-controlled exit, only a hard stop fires automatically ─────
    # Same "unreachable TP1" pattern as NO_STOP_LOSS above (and the same fix,
    # 2026-07-29): disable_tp1_exit guarantees TP1 never auto-fires regardless
    # of the number, so tp1_mult/tp2_mult can be a normal, sane-looking target
    # instead of a 999x-entry sentinel.
    "MANUAL": {
        "qty_contracts":          2,
        "use_tp2":                False,
        "disable_tp1_exit":       True,
        "max_loss_pct":           0.30,   # default SL — overridden by user's picker selection
        "tp1_mult":               1.20,
        "tp2_mult":               1.35,
        "tp1_close_pct":          0.00,
        "tp2_close_pct":          0.00,
        "runner_trail_pct":       0.00,
        "runner_mode":            "trail",
        "sl_confirm_ticks":       2,
        "volume_exit":            False,
        "volume_exit_threshold":  0.20,
        "strike_offset_min":      0.50,
        "strike_offset_max":      2.00,
        "target_delta_min":       0.38,
        "target_delta_max":       0.58,
        "eod_buffer_minutes":     25,
        "breakout_time_limit_min": 240,
        "vix_max_override":       50,
    },
    # ─── RETESTER — Wait for price to return to the breakout level ───────────────
    "RETESTER": {
        "qty_contracts": 4,
        "max_loss_pct": 0.30,
        "tp1_mult": 1.20,           # lowered from 1.50 — retest entry is already confirmed; +20% is realistic first target
        "tp2_mult": 2.00,
        "tp1_close_pct": 0.55,
        "tp1_confirm_ticks": 2,
        "min_tp1_dollars": 0.20,
        "min_tp2_dollars": 0.65,
        "cascade_ticks": 3,
        "cascade_close_pct": 0.50,
        "tp2_close_pct": 0.35,
        "runner_trail_pct": 0.22,   # loosened from 0.15 — entered at confirmed level, give room
        "runner_mode": "trail",     # retest entry = confirmed level; protect gains dynamically
        "sl_confirm_ticks": 2,
        "volume_exit": False,
        "volume_exit_threshold": 0.20,
        "strike_offset_min": 1.00,  # raised from 0.50 — RETEST entry fires after underlying retests ORH; 0.50 selects near-ATM at fill
        "strike_offset_max": 2.00,
        "target_delta_min": 0.38,
        "target_delta_max": 0.55,
        "eod_buffer_minutes": 25,
        "breakout_time_limit_min": 90,
        "vix_max_override": 28,
        "entry_mode": "RETEST",
        "retest_window_min": 60,
        "max_retest_attempts": 1,   # re-arm once after an invalidated retest before giving up on the session
        "daily_loss_limit":       400,
        "re_entry_cooldown_min":  60,
    },
}

# Smart-contracts tiers: qty scales inversely with ask premium so that
# live accounts with limited capital still get meaningful exposure without
# overspending on a single expensive contract.
SMART_CONTRACT_TIERS: list[tuple[float, int]] = [
    (1.50, 1),
    (1.00, 2),
    (0.00, 6),
]


def smart_qty(ask: float) -> int:
    """Return the smart-contracts qty for the given ask price."""
    for threshold, qty in SMART_CONTRACT_TIERS:
        if ask >= threshold:
            return qty
    return 1


CUSTOM_DEFAULTS = {
    "qty_contracts":          5,
    "max_loss_pct":           0.35,
    "tp1_mult":               1.20,
    "tp2_mult":               2.00,
    "tp1_close_pct":          0.50,
    "tp2_close_pct":          0.50,
    "runner_trail_pct":       0.20,
    "runner_mode":            "trail",
    "sl_confirm_ticks":       2,
    "volume_exit":            False,
    "volume_exit_threshold":  0.20,
    "strike_offset_min":      0.50,
    "strike_offset_max":      2.00,
    "target_delta_min":       0.38,
    "target_delta_max":       0.58,
    "eod_buffer_minutes":     25,
    "breakout_time_limit_min": 45,
    "vix_max_override":       30,
}

_DISPLAY_NAMES = {
    "BULL_DOG":    "Bull Dog",
    "THUNDER_CAT": "Thunder Cat",
    "WOLF":        "Wolf",
    "TREND_RIDER": "Trend Rider",
    "RETESTER":    "Retester",
    "REVERSAL":    "Reversal",
    "CUSTOM":      "Custom",
    "SCALPER":    "Scalper",
    "PRECISION":  "Precision",
    "MOMENTUM":   "Momentum",
    "CONVICTION": "Conviction",
    "ALL_IN":     "All In",
    "OTM_RUNNER":     "OTM Runner",
    "OTM_CONVICTION": "OTM Conviction",
    "MANUAL":         "Manual",
    "NO_STOP_LOSS":   "No Stop Loss",
    "SL_5":           "SL-5",
    "SL_10":          "SL-10",
}

_EMOJIS = {
    "BULL_DOG":    "🐂",
    "THUNDER_CAT": "🐱",
    "WOLF":        "🐺",
    "TREND_RIDER": "🚀",
    "RETESTER":    "🎯",
    "REVERSAL":    "🔄",
    "CUSTOM":      "⚙️",
    "SCALPER":    "⚡",
    "PRECISION":  "🎯",
    "MOMENTUM":   "📈",
    "CONVICTION": "💎",
    "ALL_IN":     "🔥",
    "OTM_RUNNER":     "🚀",
    "OTM_CONVICTION": "🎯",
    "MANUAL":         "✋",
    "NO_STOP_LOSS":   "🧗",
    "SL_5":           "⏱️",
    "SL_10":          "⏳",
}


def get_profile(name: str, custom_thresholds: dict | None = None) -> dict:
    key = name.upper().replace(" ", "_")
    if key == "CUSTOM":
        return {**CUSTOM_DEFAULTS, **(custom_thresholds or {})}
    if key not in PROFILES:
        return PROFILES["THUNDER_CAT"]
    base = dict(PROFILES[key])
    if custom_thresholds:
        for k, v in custom_thresholds.items():
            if k in base:
                base[k] = v
            else:
                logger.warning(
                    "[profiles] Ignoring unknown override key %r for profile %s "
                    "(not a field on the base profile)", k, key,
                )
    return base


def describe_profile(key: str, custom_thresholds: dict | None = None) -> dict:
    k = key.upper().replace(" ", "_")
    p = get_profile(k, custom_thresholds)
    risk = {
        "BULL_DOG":    "High",
        "THUNDER_CAT": "Medium",
        "WOLF":        "Low",
        "TREND_RIDER": "Medium-High",
        "RETESTER":    "Medium",
        "REVERSAL":    "Medium-High",
        "SCALPER":     "Low",
        "PRECISION":   "Low-Med",
        "MOMENTUM":    "Medium",
        "CONVICTION":  "Med-High",
        "ALL_IN":          "High",
        "OTM_RUNNER":      "High",
        "OTM_CONVICTION":  "Med-High",
        "NO_STOP_LOSS":    "Unbounded",
        "SL_5":            "High (5-min grace stop)",
        "SL_10":           "High (10-min grace stop)",
    }.get(k, "Custom")
    has_runner = (not p.get("use_tp2", True)) or p["tp2_close_pct"] < 1.0
    return {
        "key": k,
        "display_name": _DISPLAY_NAMES.get(k, k),
        "emoji": _EMOJIS.get(k, ""),
        "contracts": p["qty_contracts"],
        "max_loss_pct": int(p["max_loss_pct"] * 100),
        "tp1_pct": int((p["tp1_mult"] - 1) * 100),
        "tp2_pct": int((p["tp2_mult"] - 1) * 100),
        "runner": has_runner,
        "runner_mode": p.get("runner_mode", "trail"),
        "use_tp2": p.get("use_tp2", True),
        "risk_level": risk,
        "vix_max": p["vix_max_override"],
        "breakout_limit_min": p["breakout_time_limit_min"],
        "thresholds": p,
    }
