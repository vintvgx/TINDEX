"""
Swing trade exit management.

Unlike ORB (same-day 0DTE), swing positions are multi-day holds.
Stop/TP logic is driven by configurable profiles stored as SWING_PROFILES.
"""

import logging
from typing import Optional

logger = logging.getLogger(__name__)

# ── Strategy profiles ─────────────────────────────────────────────────────────

SWING_PROFILES: dict = {
    "CONSERVATIVE_SWING": {
        "stop_type": "atr",          # atr | fixed_pct | swing_low | max_loss
        "stop_atr_mult": 1.5,
        "stop_fixed_pct": None,
        "tp1_pct": 0.15,             # +15% premium from entry
        "tp1_qty_pct": 0.40,         # sell 40% of position at TP1
        "tp2_pct": 0.35,             # +35% premium from entry
        "tp2_qty_pct": 0.35,
        "ratchet_be": True,          # move stop to breakeven after TP1 hits
        "runner_trail_pct": 0.10,    # trail remaining runner by 10% of premium
        "time_stop_dte": 7,          # exit all if DTE drops below this
        "max_loss_pct": 0.30,
    },
    "RUNNER": {
        "stop_type": "atr",
        "stop_atr_mult": 2.5,
        "stop_fixed_pct": None,
        "tp1_pct": 0.20,
        "tp1_qty_pct": 0.25,
        "tp2_pct": 0.60,
        "tp2_qty_pct": 0.30,
        "ratchet_be": True,
        "runner_trail_pct": 0.20,
        "time_stop_dte": 5,
        "max_loss_pct": 0.40,
    },
    "DEFINED_RISK": {
        "stop_type": "max_loss",     # max loss is baked into the spread
        "stop_atr_mult": None,
        "stop_fixed_pct": None,
        "tp1_pct": 0.50,             # 50% of max spread value
        "tp1_qty_pct": 0.50,
        "tp2_pct": 0.80,
        "tp2_qty_pct": 0.50,
        "ratchet_be": False,
        "runner_trail_pct": None,
        "time_stop_dte": 7,
        "max_loss_pct": 1.0,         # capped by spread structure
    },
    "SCALP_SWING": {
        "stop_type": "fixed_pct",
        "stop_atr_mult": None,
        "stop_fixed_pct": 0.20,
        "tp1_pct": 0.25,
        "tp1_qty_pct": 1.0,          # full close at TP1 — no runner
        "tp2_pct": None,
        "tp2_qty_pct": 0.0,
        "ratchet_be": False,
        "runner_trail_pct": None,
        "time_stop_dte": 10,
        "max_loss_pct": 0.20,
    },
}


def get_swing_profiles() -> dict:
    return SWING_PROFILES


class SwingExitManager:
    """
    Evaluates exit conditions for a single open swing position.

    Usage:
        mgr = SwingExitManager(position_data, "CONSERVATIVE_SWING")
        result = mgr.check_exit(current_premium=2.80, current_underlying_price=415.0, atr=3.5, dte_remaining=22)
        if result["should_exit"]:
            # act on result["exit_type"], result["qty_to_close"], result["reason"]
    """

    def __init__(self, position_data: dict, profile_name: str):
        if profile_name not in SWING_PROFILES:
            raise ValueError(f"Unknown swing profile: {profile_name}. Valid: {list(SWING_PROFILES)}")
        self.profile = SWING_PROFILES[profile_name]
        self.profile_name = profile_name

        self.entry_price: float = float(position_data.get("entry_price") or 0)
        self.entry_underlying_price: float = float(position_data.get("entry_underlying_price") or 0)
        self.qty_total: int = int(position_data.get("qty") or 0)
        self.qty_remaining: int = int(position_data.get("qty_remaining", self.qty_total))
        self.tp1_hit: bool = bool(position_data.get("tp1_hit", False))
        self.tp2_hit: bool = bool(position_data.get("tp2_hit", False))
        self.be_ratcheted: bool = bool(position_data.get("be_ratcheted", False))
        self.effective_stop: Optional[float] = position_data.get("effective_stop")  # updated after BE ratchet

    def check_exit(
        self,
        current_premium: float,
        current_underlying_price: float,
        atr: float,
        dte_remaining: int,
    ) -> dict:
        """
        Returns a dict describing whether and how to exit.
        Evaluation order: time stop → hard stop → TP1 → TP2 → runner trail → BE stop → hold.
        """
        if self.entry_price <= 0 or self.qty_remaining <= 0:
            return self._no_exit("no open position")

        # ── Time stop ────────────────────────────────────────────────────────
        time_stop_dte = self.profile.get("time_stop_dte")
        if time_stop_dte is not None and dte_remaining <= time_stop_dte:
            return self._exit(
                exit_type="TIME_STOP",
                qty=self.qty_remaining,
                reason=f"DTE {dte_remaining} ≤ time_stop threshold {time_stop_dte}",
            )

        # ── Hard stop check ──────────────────────────────────────────────────
        stop_result = self._check_stop(current_premium, atr, current_underlying_price)
        if stop_result:
            return stop_result

        # ── BE stop (post-TP1 ratchet) ───────────────────────────────────────
        if self.be_ratcheted and self.effective_stop is not None:
            if current_premium <= self.effective_stop:
                return self._exit(
                    exit_type="BE_STOP",
                    qty=self.qty_remaining,
                    reason=f"Runner hit breakeven stop @ ${self.effective_stop:.4f}",
                )

        # ── Take profit ───────────────────────────────────────────────────────
        tp_result = self._check_tp(current_premium, self.qty_remaining)
        if tp_result:
            return tp_result

        # ── Runner trail (post TP1, if applicable) ────────────────────────────
        if self.tp1_hit and not self.tp2_hit:
            trail_pct = self.profile.get("runner_trail_pct")
            if trail_pct and current_premium <= current_premium * (1 - trail_pct):
                return self._exit(
                    exit_type="RUNNER_TRAIL",
                    qty=self.qty_remaining,
                    reason=f"Runner trail stop hit ({trail_pct*100:.0f}% pullback from ${current_premium:.4f})",
                )

        return self._no_exit("hold")

    def _check_stop(self, current_premium: float, atr: float, underlying: float) -> Optional[dict]:
        stop_type = self.profile.get("stop_type")
        max_loss_pct = self.profile.get("max_loss_pct", 0.30)

        # Max loss always applies as a safety net
        loss_pct = (self.entry_price - current_premium) / self.entry_price if self.entry_price > 0 else 0
        if loss_pct >= max_loss_pct:
            return self._exit(
                exit_type="HARD_STOP",
                qty=self.qty_remaining,
                reason=f"Max loss {max_loss_pct*100:.0f}% hit — premium dropped {loss_pct*100:.1f}%",
            )

        if stop_type == "atr":
            mult = self.profile.get("stop_atr_mult", 2.0)
            # Stop fires when the UNDERLYING drops mult×ATR below entry underlying price.
            # Comparing option premium to ATR directly is meaningless — ATR lives on the
            # stock price scale, not the option premium scale.
            if self.entry_underlying_price > 0 and atr > 0:
                underlying_stop = self.entry_underlying_price - (atr * mult)
                if underlying <= underlying_stop:
                    return self._exit(
                        exit_type="HARD_STOP",
                        qty=self.qty_remaining,
                        reason=(
                            f"ATR stop hit: underlying ${underlying:.2f} <= "
                            f"${underlying_stop:.2f} (entry ${self.entry_underlying_price:.2f} − {mult}×ATR ${atr:.2f})"
                        ),
                    )

        elif stop_type == "fixed_pct":
            pct = self.profile.get("stop_fixed_pct", 0.20)
            stop_level = self.entry_price * (1 - pct)
            if current_premium <= stop_level:
                return self._exit(
                    exit_type="HARD_STOP",
                    qty=self.qty_remaining,
                    reason=f"Fixed % stop hit: premium ${current_premium:.4f} ≤ ${stop_level:.4f} ({pct*100:.0f}%)",
                )

        return None

    def _check_tp(self, current_premium: float, qty_remaining: int) -> Optional[dict]:
        # TP2
        tp2_pct = self.profile.get("tp2_pct")
        tp2_qty_pct = self.profile.get("tp2_qty_pct", 0.0)
        if not self.tp2_hit and self.tp1_hit and tp2_pct and tp2_qty_pct > 0:
            tp2_level = self.entry_price * (1 + tp2_pct)
            if current_premium >= tp2_level:
                qty = max(1, round(self.qty_total * tp2_qty_pct))
                return self._exit(
                    exit_type="TP2",
                    qty=min(qty, qty_remaining),
                    reason=f"TP2 hit: premium ${current_premium:.4f} ≥ ${tp2_level:.4f} (+{tp2_pct*100:.0f}%)",
                )

        # TP1
        tp1_pct = self.profile.get("tp1_pct", 0.15)
        tp1_qty_pct = self.profile.get("tp1_qty_pct", 0.40)
        if not self.tp1_hit:
            tp1_level = self.entry_price * (1 + tp1_pct)
            if current_premium >= tp1_level:
                qty = max(1, round(self.qty_total * tp1_qty_pct))
                return self._exit(
                    exit_type="TP1",
                    qty=min(qty, qty_remaining),
                    reason=f"TP1 hit: premium ${current_premium:.4f} ≥ ${tp1_level:.4f} (+{tp1_pct*100:.0f}%)",
                )

        return None

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _exit(self, exit_type: str, qty: int, reason: str) -> dict:
        return {
            "should_exit": True,
            "exit_type": exit_type,
            "qty_to_close": qty,
            "reason": reason,
            "profile": self.profile_name,
        }

    def _no_exit(self, reason: str = "hold") -> dict:
        return {
            "should_exit": False,
            "exit_type": None,
            "qty_to_close": 0,
            "reason": reason,
            "profile": self.profile_name,
        }
