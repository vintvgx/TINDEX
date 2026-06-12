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
        "consol_exit": True,
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
        "consol_exit": True,
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
        "consol_exit": True,
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
        "qty_contracts": 2,
        "max_loss_pct": 0.38,
        "tp1_mult": 1.60,
        "tp2_mult": 2.50,
        "tp1_close_pct": 0.15,
        "tp2_close_pct": 0.35,
        "runner_trail_pct": 0.18,
        "consol_exit": False,
        "consol_range_pct": 0.0010,
        "consol_bars": 8,
        "volume_exit_threshold": 0.10,
        "strike_offset_min": 0.50,
        "strike_offset_max": 2.00,
        "target_delta_min": 0.30,
        "target_delta_max": 0.48,
        "eod_buffer_minutes": 15,
        "breakout_time_limit_min": 90,
        "vix_max_override": 21,
        "entry_mode": "BREAK",
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
        "consol_exit": True,
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

CUSTOM_DEFAULTS = {
    "qty_contracts":          5,
    "max_loss_pct":           0.35,
    "tp1_mult":               1.50,
    "tp2_mult":               2.00,
    "tp1_close_pct":          0.50,
    "tp2_close_pct":          0.50,
    "runner_trail_pct":       0.20,
    "consol_exit":            True,
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
    "CUSTOM":      "Custom",
}

_EMOJIS = {
    "BULL_DOG":    "🐂",
    "THUNDER_CAT": "🐱",
    "WOLF":        "🐺",
    "TREND_RIDER": "🚀",
    "RETESTER":    "🎯",
    "CUSTOM":      "⚙️",
}


def get_profile(name: str, custom_thresholds: dict = None) -> dict:
    key = name.upper().replace(" ", "_")
    if key == "CUSTOM":
        return {**CUSTOM_DEFAULTS, **(custom_thresholds or {})}
    if key not in PROFILES:
        return PROFILES["THUNDER_CAT"]
    return PROFILES[key]


def describe_profile(key: str, custom_thresholds: dict = None) -> dict:
    k = key.upper().replace(" ", "_")
    p = get_profile(k, custom_thresholds)
    risk = {"BULL_DOG": "High", "THUNDER_CAT": "Medium", "WOLF": "Low",
            "TREND_RIDER": "Medium-High", "RETESTER": "Medium"}.get(k, "Custom")
    return {
        "key": k,
        "display_name": _DISPLAY_NAMES.get(k, k),
        "emoji": _EMOJIS.get(k, ""),
        "contracts": p["qty_contracts"],
        "max_loss_pct": int(p["max_loss_pct"] * 100),
        "tp1_pct": int((p["tp1_mult"] - 1) * 100),
        "tp2_pct": int((p["tp2_mult"] - 1) * 100),
        "runner": p["tp2_close_pct"] < 1.0,
        "risk_level": risk,
        "vix_max": p["vix_max_override"],
        "breakout_limit_min": p["breakout_time_limit_min"],
        "thresholds": p,
    }
