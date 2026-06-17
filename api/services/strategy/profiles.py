"""
Trading profile definitions for the TINDEX ORB strategy.

Three profiles control sizing, strike selection, and exit behavior.
All profile-dependent logic in other modules reads from here — nothing hardcoded elsewhere.
"""

PROFILES = {
    # ─── BULL DOG — Aggressive ───────────────────────────────────────────────────
    "BULL_DOG": {
        "qty_contracts": 10,
        "max_loss_pct": 0.40,
        "tp1_mult": 1.75,
        "tp2_mult": 2.50,
        "tp1_close_pct": 0.30,
        "tp2_close_pct": 0.30,
        "runner_trail_pct": 0.15,
        "consol_exit": False,
        "volume_exit": False,
        "consol_range_pct": 0.0005,
        "consol_bars": 6,
        "volume_exit_threshold": 0.10,
        "strike_offset_min": 1.00,
        "strike_offset_max": 3.00,
        "target_delta_min": 0.28,
        "target_delta_max": 0.45,
        "eod_buffer_minutes": 20,
        "breakout_time_limit_min": 60,
        "vix_max_override": 35,
    },
    # ─── THUNDER CAT — Balanced (DEFAULT) ────────────────────────────────────────
    "THUNDER_CAT": {
        "qty_contracts": 6,
        "max_loss_pct": 0.35,
        "tp1_mult": 1.50,
        "tp2_mult": 2.00,
        "tp1_close_pct": 0.50,
        "tp2_close_pct": 0.50,
        "runner_trail_pct": 0.20,
        "consol_exit": False,
        "volume_exit": False,
        "consol_range_pct": 0.0008,
        "consol_bars": 4,
        "volume_exit_threshold": 0.20,
        "strike_offset_min": 0.50,
        "strike_offset_max": 2.00,
        "target_delta_min": 0.38,
        "target_delta_max": 0.58,
        "eod_buffer_minutes": 25,
        "breakout_time_limit_min": 45,
        "vix_max_override": 30,
    },
    # ─── WOLF — Conservative ─────────────────────────────────────────────────────
    "WOLF": {
        "qty_contracts": 3,
        "max_loss_pct": 0.25,
        "tp1_mult": 1.35,
        "tp2_mult": 1.70,
        "tp1_close_pct": 0.67,
        "tp2_close_pct": 1.00,
        "runner_trail_pct": 0.10,
        "consol_exit": False,
        "volume_exit": False,
        "consol_range_pct": 0.0012,
        "consol_bars": 3,
        "volume_exit_threshold": 0.30,
        "strike_offset_min": 0.50,
        "strike_offset_max": 1.25,
        "target_delta_min": 0.42,
        "target_delta_max": 0.58,
        "eod_buffer_minutes": 30,
        "breakout_time_limit_min": 35,
        "vix_max_override": 25,
    },
    # ─── TREND RIDER — Hold for the full move ────────────────────────────────────
    "TREND_RIDER": {
        "qty_contracts": 4,
        "max_loss_pct": 0.38,
        "tp1_mult": 1.60,
        "tp2_mult": 2.50,
        "tp1_close_pct": 0.15,
        "tp2_close_pct": 0.35,
        "runner_trail_pct": 0.18,
        "consol_exit": False,
        "volume_exit": False,
        "consol_range_pct": 0.0010,
        "consol_bars": 8,
        "volume_exit_threshold": 0.10,
        "strike_offset_min": 0.50,
        "strike_offset_max": 2.00,
        "target_delta_min": 0.30,
        "target_delta_max": 0.48,
        "eod_buffer_minutes": 15,
        "breakout_time_limit_min": 90,
        "vix_max_override": 25,
        "entry_mode": "BREAK",
    },
    # ─── REVERSAL — Enter the opposite contract after a scored failed breakout ───
    # Requires the engine to subscribe to the hub's reversal channel (not the
    # regular breakout channel). OrbService scores each bar after a confirmed
    # breakout and publishes a reversal signal when confidence reaches 3/5.
    "REVERSAL": {
        # Sizing: always use smart contracts (enforced in engine), floor at 2.
        # TP1 closes 50 % (1 of the 2 minimum contracts); the second runs.
        # use_tp2 is False: after TP1 only the runner trail + breakeven stop apply.
        "qty_contracts":          2,
        "force_smart_qty":        True,   # engine ignores config smart_contracts flag
        "min_smart_qty":          2,      # smart_qty result is floored here
        "use_tp2":                False,  # skip TP2; runner trail manages the rest
        "max_loss_pct":           0.35,
        "tp1_mult":               1.55,
        "tp2_mult":               2.30,   # kept for profile completeness, never hit
        "tp1_close_pct":          0.50,
        "tp2_close_pct":          0.00,   # irrelevant (use_tp2=False)
        "runner_trail_pct":       0.14,
        "consol_exit":            False,
        "volume_exit":            False,
        "consol_range_pct":       0.0008,
        "consol_bars":            4,
        "volume_exit_threshold":  0.20,
        "strike_offset_min":      0.50,
        "strike_offset_max":      2.00,
        "target_delta_min":       0.38,
        "target_delta_max":       0.58,
        "eod_buffer_minutes":     25,
        "breakout_time_limit_min": 240,   # reversals can happen well after the open
        "vix_max_override":       45,
        "entry_mode":             "BREAK",
    },
    # ── IMMEDIATE TRADE PROFILES ──────────────────────────────────────────────────
    # These five profiles are purpose-built for conviction / immediate trades.
    # They skip the ORB breakout window entirely (breakout_time_limit_min=240),
    # have tighter EOD buffers, and are tuned for direction-already-chosen entries.
    # Ordered left-to-right on the slider: risk-conscious → profit-maximising.

    # ─── SCALPER — Quick locks, tight trail ──────────────────────────────────────
    "SCALPER": {
        "qty_contracts":           3,
        "max_loss_pct":            0.30,
        "tp1_mult":                1.30,
        "tp2_mult":                1.60,
        "tp1_close_pct":           0.67,    # lock 2/3 at TP1
        "tp2_close_pct":           1.00,    # close all at TP2
        "runner_trail_pct":        0.25,    # tight trail on the runner
        "consol_exit":             False,
        "volume_exit":             False,
        "consol_range_pct":        0.0006,
        "consol_bars":             4,
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
        "runner_trail_pct":        0.20,
        "consol_exit":             False,
        "volume_exit":             False,
        "consol_range_pct":        0.0008,
        "consol_bars":             4,
        "volume_exit_threshold":   0.20,
        "strike_offset_min":       0.50,
        "strike_offset_max":       1.50,
        "target_delta_min":        0.42,
        "target_delta_max":        0.55,
        "eod_buffer_minutes":      30,
        "breakout_time_limit_min": 240,
        "vix_max_override":        30,
    },
    # ─── MOMENTUM — Ride the move, small TP1, let runner go (DEFAULT) ───────────
    "MOMENTUM": {
        "qty_contracts":           4,
        "max_loss_pct":            0.40,
        "tp1_mult":                1.20,
        "tp2_mult":                1.50,
        "tp1_close_pct":           0.25,    # small close — mostly keep running
        "tp2_close_pct":           0.50,
        "runner_trail_pct":        0.18,
        "consol_exit":             False,
        "volume_exit":             False,
        "consol_range_pct":        0.0010,
        "consol_bars":             6,
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
        "qty_contracts":           5,
        "max_loss_pct":            0.45,
        "tp1_mult":                1.15,
        "tp2_mult":                1.35,
        "tp1_close_pct":           0.20,    # tiny close — almost all runs
        "tp2_close_pct":           0.35,
        "runner_trail_pct":        0.15,    # looser trail, let it breathe
        "consol_exit":             False,
        "volume_exit":             False,
        "consol_range_pct":        0.0012,
        "consol_bars":             8,
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
        "use_tp2":                 False,   # skip TP2; pure runner trail
        "max_loss_pct":            0.50,
        "tp1_mult":                1.10,
        "tp2_mult":                2.00,    # kept for completeness, never hit
        "tp1_close_pct":           0.50,
        "tp2_close_pct":           0.00,    # irrelevant (use_tp2=False)
        "runner_trail_pct":        0.12,    # very loose — ride the full trend
        "consol_exit":             False,
        "volume_exit":             False,
        "consol_range_pct":        0.0015,
        "consol_bars":             10,
        "volume_exit_threshold":   0.08,
        "strike_offset_min":       0.50,
        "strike_offset_max":       2.50,
        "target_delta_min":        0.28,
        "target_delta_max":        0.45,
        "eod_buffer_minutes":      10,
        "breakout_time_limit_min": 240,
        "vix_max_override":        50,
    },

    # ─── RETESTER — Wait for price to return to the breakout level ───────────────
    "RETESTER": {
        "qty_contracts": 4,
        "max_loss_pct": 0.30,
        "tp1_mult": 1.50,
        "tp2_mult": 2.00,
        "tp1_close_pct": 0.55,
        "tp2_close_pct": 0.35,
        "runner_trail_pct": 0.15,
        "consol_exit": False,
        "volume_exit": False,
        "consol_range_pct": 0.0008,
        "consol_bars": 4,
        "volume_exit_threshold": 0.20,
        "strike_offset_min": 0.50,
        "strike_offset_max": 2.00,
        "target_delta_min": 0.38,
        "target_delta_max": 0.55,
        "eod_buffer_minutes": 25,
        "breakout_time_limit_min": 90,
        "vix_max_override": 28,
        "entry_mode": "RETEST",
        "retest_window_min": 60,
    },
}

# Smart-contracts tiers: qty scales inversely with ask premium so that
# live accounts with limited capital still get meaningful exposure without
# overspending on a single expensive contract.
# Order matters — first threshold that ask >= wins.
# The existing capital_limit and buying_power checks still apply after,
# so these are a starting point, not a bypass of those guards.
SMART_CONTRACT_TIERS: list[tuple[float, int]] = [
    (1.50, 1),   # ask >= $1.50  → 1 contract
    (1.00, 2),   # ask >= $1.00  → 2 contracts
    (0.00, 4),   # ask <  $1.00  → 4 contracts
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
    "tp1_mult":               1.50,
    "tp2_mult":               2.00,
    "tp1_close_pct":          0.50,
    "tp2_close_pct":          0.50,
    "runner_trail_pct":       0.20,
    "consol_exit":            False,
    "volume_exit":            False,
    "consol_range_pct":       0.0008,
    "consol_bars":            4,
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
    # Immediate trade profiles
    "SCALPER":    "Scalper",
    "PRECISION":  "Precision",
    "MOMENTUM":   "Momentum",
    "CONVICTION": "Conviction",
    "ALL_IN":     "All In",
}

_EMOJIS = {
    "BULL_DOG":    "🐂",
    "THUNDER_CAT": "🐱",
    "WOLF":        "🐺",
    "TREND_RIDER": "🚀",
    "RETESTER":    "🎯",
    "REVERSAL":    "🔄",
    "CUSTOM":      "⚙️",
    # Immediate trade profiles
    "SCALPER":    "⚡",
    "PRECISION":  "🎯",
    "MOMENTUM":   "📈",
    "CONVICTION": "💎",
    "ALL_IN":     "🔥",
}


def get_profile(name: str, custom_thresholds: dict = None) -> dict:
    key = name.upper().replace(" ", "_")
    if key == "CUSTOM":
        return {**CUSTOM_DEFAULTS, **(custom_thresholds or {})}
    if key not in PROFILES:
        return PROFILES["THUNDER_CAT"]
    base = dict(PROFILES[key])
    if custom_thresholds:
        for k in ("consol_exit", "volume_exit"):
            if k in custom_thresholds:
                base[k] = custom_thresholds[k]
    return base


def describe_profile(key: str, custom_thresholds: dict = None) -> dict:
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
        "ALL_IN":      "High",
    }.get(k, "Custom")
    # A runner exists when TP2 is disabled (remaining contracts trail) OR when
    # TP2 only closes a fraction (tp2_close_pct < 1.0).
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
        "use_tp2": p.get("use_tp2", True),
        "risk_level": risk,
        "vix_max": p["vix_max_override"],
        "breakout_limit_min": p["breakout_time_limit_min"],
        "thresholds": p,
    }
