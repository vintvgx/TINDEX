"""
Logs trades, sessions, and skips to Supabase.
Reads config back from strategy_config table.
"""

import os
import uuid
import logging
from datetime import datetime, date
from typing import Optional

from supabase import create_client, Client

logger = logging.getLogger(__name__)


class TradeLogger:
    def __init__(self):
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        if not url or not key:
            raise ValueError("Supabase credentials not set")
        self.client: Client = create_client(url, key)

    # ── Multi-strategy config (strategy_configs table) ──────────────────────────

    def load_configs(self) -> list[dict]:
        """Return all rows from strategy_configs, ordered by created_at."""
        try:
            res = self.client.table("strategy_configs").select("*").order("created_at").execute()
            return res.data or []
        except Exception as e:
            logger.error("[TradeLogger] load_configs failed: %s", e)
            return []

    def save_strategy_config(self, config: dict) -> dict | None:
        """
        Upsert a row in strategy_configs.  If config has an 'id' key the row is
        updated; otherwise a new row is inserted and the returned dict includes
        the generated UUID.
        """
        try:
            row = {
                "ticker":                 config.get("ticker", "IWM"),
                "orb_minutes":            config.get("orb_minutes", 10),
                "paper_mode":             config.get("paper_mode", True),
                "active":                 config.get("active", True),
                "profile":                config.get("profile", "THUNDER_CAT"),
                "trade_days":             config.get("trade_days", [0, 2, 4]),
                "strategy_name":          config.get("strategy_name", ""),
                "capital_limit":          config.get("capital_limit"),
                "bypass_breakout_window": config.get("bypass_breakout_window", False),
                "custom_thresholds":      config.get("custom_thresholds"),
                "budget_otm_mode":        config.get("budget_otm_mode", False),
                "otm_fib_level":          config.get("otm_fib_level", "1.0"),
                "updated_at":             datetime.utcnow().isoformat(),
            }
            if "id" in config and config["id"]:
                row["id"] = config["id"]
            else:
                row["id"] = str(uuid.uuid4())
            res = self.client.table("strategy_configs").upsert(row, on_conflict="id").execute()
            return res.data[0] if res.data else row
        except Exception as e:
            logger.error("[TradeLogger] save_strategy_config failed: %s", e)
            return None

    def delete_strategy_config(self, strategy_id: str):
        try:
            self.client.table("strategy_configs").delete().eq("id", strategy_id).execute()
        except Exception as e:
            logger.error("[TradeLogger] delete_strategy_config failed: %s", e)

    # ── Session logging ─────────────────────────────────────────────────────────

    def log_session(self, ticker: str, session_date, orh: float, orl: float,
                    orb_range: float, vix: float, sentiment: str, profile: str,
                    strategy_id: str = None):
        try:
            self.client.table("orb_session").upsert({
                "session_date": str(session_date),
                "strategy_id": strategy_id,
                "ticker":      ticker,
                "profile":     profile,
                "orh":         orh,
                "orl":         orl,
                "orb_range":   orb_range,
                "vix":         vix,
                "sentiment":   sentiment,
                "trade_taken": False,
            }, on_conflict="session_date,strategy_id").execute()
        except Exception as e:
            logger.error("[TradeLogger] log_session failed: %s", e)

    def log_skip(self, ticker: str, reason: str, session_date, profile: str,
                 strategy_id: str = None):
        try:
            self.client.table("orb_session").upsert({
                "session_date": str(session_date),
                "strategy_id": strategy_id,
                "ticker":      ticker,
                "profile":     profile,
                "trade_taken": False,
                "skip_reason": reason,
            }, on_conflict="session_date,strategy_id").execute()
        except Exception as e:
            logger.error("[TradeLogger] log_skip failed: %s", e)

    # ── Trade logging ───────────────────────────────────────────────────────────

    def log_entry(self, ticker: str, direction: str, contract: dict,
                  entry_premium: float, orh: float, orl: float,
                  fib_levels: dict, session_date, profile: str, qty: int) -> Optional[str]:
        try:
            res = self.client.table("orb_trades").insert({
                "trade_date":     str(session_date),
                "ticker":         ticker,
                "profile":        profile,
                "direction":      direction,
                "contract_symbol": contract["symbol"],
                "strike":         contract["strike"],
                "expiry":         str(contract["expiry"]),
                "entry_premium":  entry_premium,
                "qty_entered":    qty,
                "qty_exited":     0,
                "entry_time":     datetime.utcnow().isoformat(),
                "orh":            orh,
                "orl":            orl,
                "fib_targets":    fib_levels,
                "flow_confirmed": True,
            }).execute()
            if res.data:
                return res.data[0]["id"]
            return None
        except Exception as e:
            logger.error("[TradeLogger] log_entry failed: %s", e)
            return None

    def log_exit(self, contract_symbol: str, exit_reason: str,
                 exit_premium: Optional[float], qty_closed: int, profile: str,
                 strategy_id: str = None):
        try:
            # Fetch the open trade — do NOT filter by exit_time so that partial
            # exits after TP1 (which already set exit_time) are still found.
            res = (
                self.client.table("orb_trades")
                .select("id, entry_premium, qty_entered, qty_exited, pnl")
                .eq("contract_symbol", contract_symbol)
                .order("entry_time", desc=True)
                .limit(1)
                .execute()
            )
            if not res.data:
                return

            row = res.data[0]
            entry_p      = row["entry_premium"] or 0
            exit_p       = exit_premium or 0
            this_pnl     = (exit_p - entry_p) * qty_closed * 100
            total_pnl    = (row.get("pnl") or 0) + this_pnl
            qty_after    = row["qty_exited"] + qty_closed
            is_fully_closed = qty_after >= row["qty_entered"]
            # pnl_pct is relative to total entry cost so it stays meaningful
            total_cost = entry_p * row["qty_entered"] * 100
            total_pnl_pct = (total_pnl / total_cost * 100) if total_cost else 0

            update: dict = {
                "exit_premium": exit_p if exit_premium is not None else None,
                "qty_exited":   qty_after,
                "pnl":          round(total_pnl, 2),
                "pnl_pct":      round(total_pnl_pct, 2),
                "exit_reason":  exit_reason,
            }
            # Only stamp exit_time when the position is fully closed so that
            # subsequent partial exit calls can still find the row.
            if is_fully_closed:
                update["exit_time"] = datetime.utcnow().isoformat()

            self.client.table("orb_trades").update(update).eq("id", row["id"]).execute()

            q = self.client.table("orb_session").update({"trade_taken": True}).eq(
                "session_date", str(date.today())
            )
            if strategy_id:
                q = q.eq("strategy_id", strategy_id)
            q.execute()
        except Exception as e:
            logger.error("[TradeLogger] log_exit failed: %s", e)

    # ── Reads ───────────────────────────────────────────────────────────────────

    def get_trades(self, limit: int = 20, ticker: str = None, profile: str = None) -> list:
        try:
            q = self.client.table("orb_trades").select("*").order("entry_time", desc=True).limit(limit)
            if ticker:
                q = q.eq("ticker", ticker)
            if profile:
                q = q.eq("profile", profile)
            return q.execute().data or []
        except Exception as e:
            logger.error("[TradeLogger] get_trades failed: %s", e)
            return []

    def get_stats(self, profile: str = None) -> dict:
        try:
            q = self.client.table("orb_trades").select("pnl, pnl_pct, exit_reason")
            if profile:
                q = q.eq("profile", profile)
            rows = q.execute().data or []
            if not rows:
                return self._empty_stats()
            wins      = [r for r in rows if (r.get("pnl") or 0) > 0]
            losses    = [r for r in rows if (r.get("pnl") or 0) < 0]
            total_pnl = sum(r.get("pnl") or 0 for r in rows)
            win_rate  = len(wins) / len(rows) * 100 if rows else 0
            avg_win   = sum(r.get("pnl") or 0 for r in wins) / len(wins) if wins else 0
            avg_loss  = sum(r.get("pnl") or 0 for r in losses) / len(losses) if losses else 0
            return {
                "total_trades": len(rows),
                "wins":         len(wins),
                "losses":       len(losses),
                "win_rate_pct": round(win_rate, 1),
                "total_pnl":    round(total_pnl, 2),
                "avg_winner":   round(avg_win, 2),
                "avg_loser":    round(avg_loss, 2),
            }
        except Exception as e:
            logger.error("[TradeLogger] get_stats failed: %s", e)
            return self._empty_stats()

    def get_stats_by_profile(self) -> list:
        from services.strategy.profiles import PROFILES
        return [self.get_stats(profile=k) | {"profile": k} for k in PROFILES]

    @staticmethod
    def _empty_stats() -> dict:
        return {
            "total_trades": 0, "wins": 0, "losses": 0,
            "win_rate_pct": 0, "total_pnl": 0,
            "avg_winner": 0, "avg_loser": 0,
        }
