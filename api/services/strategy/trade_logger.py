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
                "paper_mode":             config.get("paper_mode", True),
                "active":                 config.get("active", True),
                "profile":                config.get("profile", "THUNDER_CAT"),
                "trade_days":             config.get("trade_days", [0, 2, 4]),
                "strategy_name":          config.get("strategy_name", ""),
                "capital_limit":          config.get("capital_limit"),
                "bypass_breakout_window": config.get("bypass_breakout_window", False),
                "custom_thresholds":      config.get("custom_thresholds"),
                "exit_overrides":         config.get("exit_overrides"),
                "budget_otm_mode":        config.get("budget_otm_mode", False),
                "otm_fib_level":          config.get("otm_fib_level", "1.0"),
                "debug_mode":             config.get("debug_mode", False),
                "smart_contracts":        config.get("smart_contracts", False),
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
            # Nullify strategy_id in dependent tables first so any FK constraint
            # (added via the Supabase dashboard) doesn't block the delete.
            for table in ("orb_trades", "orb_session", "orb_debug_logs"):
                try:
                    self.client.table(table).update({"strategy_id": None}).eq("strategy_id", strategy_id).execute()
                except Exception:
                    pass  # table may not have strategy_id column — safe to ignore
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
                  fib_levels: dict, session_date, profile: str, qty: int,
                  underlying_price_entry: Optional[float] = None,
                  vix_at_entry: Optional[float] = None,
                  strategy_id: Optional[str] = None,
                  paper_mode: bool = True,
                  trade_type: str = "STRATEGY") -> Optional[str]:
        row = {
            "trade_date":             str(session_date),
            "ticker":                 ticker,
            "profile":                profile,
            "direction":              direction,
            "contract_symbol":        contract["symbol"],
            "strike":                 contract["strike"],
            "expiry":                 str(contract["expiry"]),
            "entry_premium":          entry_premium,
            "qty_entered":            qty,
            "qty_exited":             0,
            "entry_time":             datetime.utcnow().isoformat(),
            "orh":                    orh,
            "orl":                    orl,
            "fib_targets":            fib_levels,
            "flow_confirmed":         True,
            "underlying_price_entry": underlying_price_entry,
            "vix_at_entry":           vix_at_entry,
            "strategy_id":            strategy_id,
            "paper_mode":             paper_mode,
            "trade_type":             trade_type,
        }
        # exit_stages requires a DB migration — try first, fall back to insert without it
        # if the column doesn't exist yet (pre-migration safety net).
        for attempt_row in (dict(row, exit_stages=[]), row):
            try:
                res = self.client.table("orb_trades").insert(attempt_row).execute()
                if res.data:
                    return res.data[0]["id"]
                return None
            except Exception as e:
                err_str = str(e)
                if attempt_row is row or "exit_stages" not in err_str:
                    logger.error("[TradeLogger] log_entry failed: %s", e)
                    return None
                logger.warning("[TradeLogger] log_entry: exit_stages column missing — "
                               "retrying without it (run Supabase migration to fix)")
        return None

    def log_exit(self, contract_symbol: str, exit_reason: str,
                 exit_premium: Optional[float], qty_closed: int, profile: str,
                 strategy_id: str = None,
                 underlying_price_exit: Optional[float] = None):
        try:
            # Fetch the open trade — do NOT filter by exit_time so that partial
            # exits after TP1 (which already set exit_time) are still found.
            res = (
                self.client.table("orb_trades")
                .select("id, entry_premium, qty_entered, qty_exited, pnl, exit_stages")
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
            stage_pnl    = (exit_p - entry_p) * qty_closed * 100
            total_pnl    = (row.get("pnl") or 0) + stage_pnl
            qty_after    = min(row["qty_exited"] + qty_closed, row["qty_entered"])
            is_fully_closed = qty_after >= row["qty_entered"]
            # pnl_pct is relative to total entry cost so it stays meaningful
            total_cost = entry_p * row["qty_entered"] * 100
            total_pnl_pct = (total_pnl / total_cost * 100) if total_cost else 0

            # Build the stage record for this exit event
            stage = {
                "reason":  exit_reason,
                "qty":     qty_closed,
                "premium": round(exit_p, 4),
                "pnl":     round(stage_pnl, 2),
                "time":    datetime.utcnow().isoformat(),
            }
            current_stages = row.get("exit_stages") or []
            new_stages = list(current_stages) + [stage]

            update: dict = {
                "exit_premium":          exit_p if exit_premium is not None else None,
                "qty_exited":            qty_after,
                "pnl":                   round(total_pnl, 2),
                "pnl_pct":               round(total_pnl_pct, 2),
                "exit_reason":           exit_reason,
                "underlying_price_exit": underlying_price_exit,
                "exit_stages":           new_stages,
            }

            # Populate dedicated TP1 / TP2 columns for easy querying and display
            if exit_reason == "TP1":
                update["tp1_premium"] = round(exit_p, 4)
                update["tp1_qty"]     = qty_closed
                update["tp1_pnl"]     = round(stage_pnl, 2)
            elif exit_reason in ("TP2", "TP2_FULL_CLOSE"):
                update["tp2_premium"] = round(exit_p, 4)
                update["tp2_qty"]     = qty_closed
                update["tp2_pnl"]     = round(stage_pnl, 2)

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

    def get_trades(self, limit: int = 20, ticker: str = None, profile: str = None,
                   trade_date: str = None) -> list:
        try:
            q = self.client.table("orb_trades").select("*").order("entry_time", desc=True).limit(limit)
            if ticker:
                q = q.eq("ticker", ticker)
            if profile:
                q = q.eq("profile", profile)
            if trade_date:
                q = q.eq("trade_date", trade_date)
            return q.execute().data or []
        except Exception as e:
            logger.error("[TradeLogger] get_trades failed: %s", e)
            return []

    def reconcile_orphaned_trades(self):
        """
        Close any orb_trades rows that are still open (exit_time IS NULL) but
        whose expiry date is in the past. This catches trades that were never
        properly closed due to a crash or redeploy.
        """
        try:
            today = date.today().isoformat()
            res = (
                self.client.table("orb_trades")
                .select("id, contract_symbol, entry_premium, expiry")
                .is_("exit_time", "null")
                .lt("expiry", today)
                .execute()
            )
            rows = res.data or []
            if not rows:
                return
            now = datetime.utcnow().isoformat()
            for row in rows:
                self.client.table("orb_trades").update({
                    "exit_time":    now,
                    "exit_premium": row.get("entry_premium"),
                    "exit_reason":  "EOD_HARD_CLOSE",
                    "pnl":          0.0,
                    "pnl_pct":      0.0,
                    "qty_exited":   0,
                }).eq("id", row["id"]).execute()
                logger.warning(
                    "[TradeLogger] Orphaned trade reconciled: %s (id=%s)",
                    row.get("contract_symbol"), row["id"],
                )
            logger.info("[TradeLogger] Reconciled %d orphaned trade(s)", len(rows))
        except Exception as e:
            logger.error("[TradeLogger] reconcile_orphaned_trades failed: %s", e)

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

    def get_performance(self) -> dict:
        """
        Returns overall + per-strategy + per-profile performance ratings (0–100).
        Queries orb_trades joined with strategy_configs for per-strategy breakdowns.
        """
        try:
            # Overall
            all_stats = self.get_stats()
            overall = {**all_stats, **self.compute_rating(all_stats)}

            # Per-strategy: group by strategy_id
            res = (
                self.client.table("orb_trades")
                .select("strategy_id, pnl, pnl_pct, exit_reason")
                .execute()
            )
            rows = res.data or []

            # Load config names
            configs = {c["id"]: c for c in (self.load_configs() or [])}

            from collections import defaultdict
            buckets: dict = defaultdict(list)
            for r in rows:
                key = r.get("strategy_id") or "__unknown__"
                buckets[key].append(r)

            by_strategy = []
            for sid, trades in buckets.items():
                s = self._compute_stats_from_rows(trades)
                cfg = configs.get(sid, {})
                by_strategy.append({
                    **s,
                    **self.compute_rating(s),
                    "strategy_id":   sid,
                    "strategy_name": cfg.get("strategy_name", "Unknown"),
                    "ticker":        cfg.get("ticker", ""),
                    "profile":       cfg.get("profile", ""),
                })
            by_strategy.sort(key=lambda x: x["score"], reverse=True)

            # Per-profile
            from services.strategy.profiles import PROFILES
            by_profile = []
            for pk in PROFILES:
                s = self.get_stats(profile=pk)
                by_profile.append({**s, **self.compute_rating(s), "profile": pk})

            return {
                "overall":     overall,
                "by_strategy": by_strategy,
                "by_profile":  by_profile,
            }
        except Exception as e:
            logger.error("[TradeLogger] get_performance failed: %s", e)
            empty = {**self._empty_stats(), **self.compute_rating(self._empty_stats())}
            return {"overall": empty, "by_strategy": [], "by_profile": []}

    # ── Rating ───────────────────────────────────────────────────────────────────

    @staticmethod
    def compute_rating(stats: dict) -> dict:
        """
        Score a strategy's performance 0–100 across four components:
          Win Rate (25 pts) · Profit Factor (35 pts) · Reward:Risk (25 pts) · Sample size (15 pts)
        """
        n = stats.get("total_trades", 0)
        if n == 0:
            return {
                "score": 0, "grade": "N/A", "label": "No Trades",
                "profit_factor": 0,
                "breakdown": {
                    "win_rate":      {"score": 0, "max": 25, "value": 0,   "label": "Win Rate"},
                    "profit_factor": {"score": 0, "max": 35, "value": 0,   "label": "Profit Factor"},
                    "reward_risk":   {"score": 0, "max": 25, "value": 0,   "label": "Avg Win / Avg Loss"},
                    "sample_size":   {"score": 0, "max": 15, "value": 0,   "label": "Trade Count"},
                },
            }

        wins     = stats.get("wins", 0)
        losses   = stats.get("losses", 0)
        win_rate = stats.get("win_rate_pct", 0)
        avg_win  = stats.get("avg_winner", 0)
        avg_loss = stats.get("avg_loser", 0)   # negative number

        # Component 1 — Win Rate (0–25)
        wr_score = win_rate / 100 * 25

        # Component 2 — Profit Factor (0–35): total_gains / total_losses
        total_gains  = avg_win  * wins  if wins   > 0 else 0
        total_losses = abs(avg_loss) * losses if losses > 0 else 0
        if total_losses == 0:
            pf = 10.0 if total_gains > 0 else 1.0
        else:
            pf = total_gains / total_losses
        pf_score = min(35.0, (min(pf, 3.0) / 3.0) * 35)

        # Component 3 — Reward:Risk (0–25): avg_winner / |avg_loser|
        if avg_loss != 0:
            rr = avg_win / abs(avg_loss)
        else:
            rr = avg_win if avg_win > 0 else 1.0
        rr_score = min(25.0, (min(rr, 3.0) / 3.0) * 25)

        # Component 4 — Sample size (0–15)
        if   n >= 30: ss_score = 15
        elif n >= 20: ss_score = 12
        elif n >= 10: ss_score = 8
        elif n >= 5:  ss_score = 5
        else:         ss_score = 2

        total = round(wr_score + pf_score + rr_score + ss_score)
        total = max(0, min(100, total))

        if   total >= 85: grade, label = "A", "Excellent"
        elif total >= 70: grade, label = "B", "Good"
        elif total >= 55: grade, label = "C", "Average"
        elif total >= 40: grade, label = "D", "Below Average"
        else:             grade, label = "F", "Poor"

        return {
            "score":          total,
            "grade":          grade,
            "label":          label,
            "profit_factor":  round(pf, 2),
            "breakdown": {
                "win_rate":      {"score": round(wr_score), "max": 25, "value": round(win_rate, 1), "label": "Win Rate"},
                "profit_factor": {"score": round(pf_score), "max": 35, "value": round(pf, 2),       "label": "Profit Factor"},
                "reward_risk":   {"score": round(rr_score), "max": 25, "value": round(rr, 2),        "label": "Avg Win / Avg Loss"},
                "sample_size":   {"score": ss_score,        "max": 15, "value": n,                  "label": "Trade Count"},
            },
        }

    def _compute_stats_from_rows(self, rows: list) -> dict:
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

    @staticmethod
    def _empty_stats() -> dict:
        return {
            "total_trades": 0, "wins": 0, "losses": 0,
            "win_rate_pct": 0, "total_pnl": 0,
            "avg_winner": 0, "avg_loser": 0,
        }
