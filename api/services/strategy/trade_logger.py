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
                "confirm_entry":          config.get("confirm_entry", False),
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

    # ── Pending trade confirmations (confirm_entry gate) ────────────────────────

    def create_pending_confirmation(self, row: dict) -> dict | None:
        """Insert a new orb_pending_confirmations row. Returns the saved row (with id)."""
        try:
            row = {**row, "id": row.get("id") or str(uuid.uuid4())}
            res = self.client.table("orb_pending_confirmations").insert(row).execute()
            return res.data[0] if res.data else None
        except Exception as e:
            logger.error("[TradeLogger] create_pending_confirmation failed: %s", e)
            return None

    def get_pending_confirmation(self, pending_id: str) -> dict | None:
        try:
            res = (
                self.client.table("orb_pending_confirmations")
                .select("*").eq("id", pending_id).limit(1).execute()
            )
            return res.data[0] if res.data else None
        except Exception as e:
            logger.error("[TradeLogger] get_pending_confirmation failed: %s", e)
            return None

    def list_open_pending_confirmations(self) -> list[dict]:
        """All confirmations still awaiting a user response, oldest first."""
        try:
            res = (
                self.client.table("orb_pending_confirmations")
                .select("*").eq("status", "PENDING").order("created_at").execute()
            )
            return res.data or []
        except Exception as e:
            logger.error("[TradeLogger] list_open_pending_confirmations failed: %s", e)
            return []

    def update_pending_confirmation(self, pending_id: str, patch: dict) -> dict | None:
        try:
            res = (
                self.client.table("orb_pending_confirmations")
                .update(patch).eq("id", pending_id).execute()
            )
            return res.data[0] if res.data else None
        except Exception as e:
            logger.error("[TradeLogger] update_pending_confirmation failed: %s", e)
            return None

    def expire_stale_pending_confirmations(self) -> int:
        """
        Bulk-expire any PENDING row whose expires_at has passed, regardless of
        whether a live in-memory ORBEngine still references it. Safety net for
        a backend restart while a confirmation was open — ORBEngine.expire_pending_if_stale()
        only catches that case if the same engine instance survives to check its
        own state; a fresh engine after a redeploy has no memory of it at all.
        """
        try:
            now_iso = datetime.utcnow().isoformat()
            res = (
                self.client.table("orb_pending_confirmations")
                .update({"status": "EXPIRED", "resolved_at": now_iso})
                .eq("status", "PENDING")
                .lt("expires_at", now_iso)
                .execute()
            )
            return len(res.data or [])
        except Exception as e:
            logger.error("[TradeLogger] expire_stale_pending_confirmations failed: %s", e)
            return 0

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

    @staticmethod
    def _fetch_equity(trading_client) -> Optional[float]:
        """Best-effort current account equity for the account behind `trading_client`.
        Never raises — a snapshot failure shouldn't block trade logging."""
        if trading_client is None:
            return None
        try:
            return float(trading_client.get_account().equity)
        except Exception as e:
            logger.warning("[TradeLogger] equity snapshot failed: %s", e)
            return None

    def log_entry(self, ticker: str, direction: str, contract: dict,
                  entry_premium: float, orh: float, orl: float,
                  fib_levels: dict, session_date, profile: str, qty: int,
                  underlying_price_entry: Optional[float] = None,
                  vix_at_entry: Optional[float] = None,
                  strategy_id: Optional[str] = None,
                  paper_mode: bool = True,
                  trade_type: str = "STRATEGY",
                  trading_client=None,
                  exit_overrides: Optional[dict] = None,
                  hard_stop_price: Optional[float] = None,
                  tp1_price: Optional[float] = None,
                  tp2_price: Optional[float] = None) -> Optional[str]:
        # Snapshot account equity right as the position opens — the baseline
        # `log_exit` compares against when the trade fully closes, so the
        # Trade Log can show this trade's real account-level impact rather
        # than just its own entry/exit premium math.
        account_balance_before = self._fetch_equity(trading_client)

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
            # Exact levels/overrides at entry — lets a restart reconstruct this
            # position's exit management precisely instead of just re-deriving
            # a named profile's *default* thresholds (which would silently
            # widen/change the stop for a manually-overridden trade). See
            # docs/incidents/2026-07-14-position-lost-on-restart.md.
            "exit_overrides":         exit_overrides,
            "hard_stop_price":        hard_stop_price,
            "tp1_price":              tp1_price,
            "tp2_price":              tp2_price,
        }
        if account_balance_before is not None:
            row["account_balance_before"] = account_balance_before

        # Several columns here require DB migrations that may not have run yet
        # (exit_stages, account_balance_before, and the recovery fields above)
        # — progressively drop whichever named group of columns triggers a
        # "column not found" style error, rather than failing the whole insert
        # (and losing the trade record) over a migration that hasn't landed.
        optional_groups = [
            ("exit_stages",),
            ("account_balance_before",),
            ("exit_overrides", "hard_stop_price", "tp1_price", "tp2_price"),
        ]
        attempt_row = dict(row, exit_stages=[])
        remaining_groups = list(optional_groups)

        while True:
            try:
                res = self.client.table("orb_trades").insert(attempt_row).execute()
                return res.data[0]["id"] if res.data else None
            except Exception as e:
                err_str = str(e)
                dropped = False
                for group in list(remaining_groups):
                    if any(col in err_str for col in group):
                        for col in group:
                            attempt_row.pop(col, None)
                        remaining_groups.remove(group)
                        dropped = True
                        logger.warning(
                            "[TradeLogger] log_entry: column(s) %s missing — "
                            "retrying without them (run Supabase migration to fix)", group,
                        )
                        break
                if not dropped:
                    logger.error("[TradeLogger] log_entry failed: %s", e)
                    return None

    def log_add_to_position(self, trade_id: str, entry_premium: float, qty_entered: int,
                            hard_stop_price: Optional[float] = None,
                            tp1_price: Optional[float] = None,
                            tp2_price: Optional[float] = None) -> bool:
        """
        Re-anchor an already-open orb_trades row after add_to_position() blends
        the entry premium/qty in the live ExitManager, so the persisted row never
        diverges from the engine's in-memory state. Without this, log_exit()
        later recomputes realized P&L from the row's original (pre-add)
        entry_premium/qty_entered, silently corrupting the Trade Log for any
        position that had contracts added to it. See docs/incidents/
        2026-07-14-position-lost-on-restart.md for why exit_overrides / the
        hard_stop / tp1 / tp2 columns exist alongside entry_premium here.

        Returns True only if the row was actually updated. The caller (engine
        add_to_position()) surfaces a False return as a loud debug-tab error —
        previously a failed write here was only ever a server-log line, so the
        DB row could silently drift from Alpaca's real position and nothing
        would catch it until the next restart re-applied the stale qty. See
        the 2026-07-17 "8 contracts added, showed 2 after restart" incident.
        """
        update = {
            "entry_premium": entry_premium,
            "qty_entered":   qty_entered,
        }
        if hard_stop_price is not None:
            update["hard_stop_price"] = hard_stop_price
        if tp1_price is not None:
            update["tp1_price"] = tp1_price
        if tp2_price is not None:
            update["tp2_price"] = tp2_price

        try:
            res = self.client.table("orb_trades").update(update).eq("id", trade_id).execute()
            # A zero-row match (e.g. a stale/wrong trade_id) doesn't raise —
            # treat it as a failure too, since it means nothing was persisted.
            return bool(res.data)
        except Exception as e:
            err_str = str(e)
            # hard_stop_price/tp1_price/tp2_price require a DB migration that may
            # not have run yet — fall back to just entry_premium/qty_entered so
            # the P&L-critical fields still persist even if the recovery-level
            # columns aren't available.
            if any(col in err_str for col in ("hard_stop_price", "tp1_price", "tp2_price")):
                logger.warning(
                    "[TradeLogger] log_add_to_position: recovery column(s) missing — "
                    "retrying with entry_premium/qty_entered only (run Supabase migration to fix)"
                )
                try:
                    res2 = self.client.table("orb_trades").update({
                        "entry_premium": entry_premium,
                        "qty_entered":   qty_entered,
                    }).eq("id", trade_id).execute()
                    return bool(res2.data)
                except Exception as e2:
                    logger.error("[TradeLogger] log_add_to_position failed: %s", e2)
                    return False
            else:
                logger.error("[TradeLogger] log_add_to_position failed: %s", e)
                return False

    def log_exit(self, contract_symbol: str, exit_reason: str,
                 exit_premium: Optional[float], qty_closed: int, profile: str,
                 strategy_id: str = None,
                 underlying_price_exit: Optional[float] = None,
                 trading_client=None,
                 trade_id: Optional[str] = None) -> bool:
        """
        Returns True only if a row was actually found and updated.

        trade_id: the exact orb_trades row to close out. Always pass this when
        the caller already knows it (self.active_trade_id / row["id"] — every
        call site does). Without it, this used to fall back to "whichever row
        for this contract_symbol has the most recent entry_time" — harmless
        when a symbol trades once a day, but silently wrong the moment two
        rows ever share a symbol (e.g. a stuck/duplicate "still open" row that
        keeps getting reconciled): the exit would land on some OTHER row
        instead of the one that actually triggered it, corrupting that
        unrelated trade's pnl/qty_exited/account_balance_after while the real
        stale row never gets its exit_time set — so it re-triggers the exact
        same bogus "reconcile" on every future restart. See the 2026-07-17
        IWM $296C incident (duplicate "Reconciled from Alpaca" stages and a
        nonsense account-balance swing from a mismatched trading_client).
        """
        try:
            # Fetch the open trade — do NOT filter by exit_time so that partial
            # exits after TP1 (which already set exit_time) are still found.
            # `account_balance_before` may not exist yet pre-migration — fall
            # back to the column set that's guaranteed to be there.
            cols = "id, entry_premium, qty_entered, qty_exited, pnl, exit_stages, account_balance_before"
            cols_fallback = "id, entry_premium, qty_entered, qty_exited, pnl, exit_stages"
            try:
                q = self.client.table("orb_trades").select(cols)
                q = q.eq("id", trade_id) if trade_id else q.eq("contract_symbol", contract_symbol)
                res = q.order("entry_time", desc=True).limit(1).execute()
            except Exception:
                q = self.client.table("orb_trades").select(cols_fallback)
                q = q.eq("id", trade_id) if trade_id else q.eq("contract_symbol", contract_symbol)
                res = q.order("entry_time", desc=True).limit(1).execute()
            if not res.data:
                return False

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

                # Real account-level impact of this trade's full life, not just
                # its own premium math — only possible for trades that captured
                # a `account_balance_before` snapshot at entry (i.e. going forward).
                account_balance_before = row.get("account_balance_before")
                if account_balance_before is not None:
                    account_balance_after = self._fetch_equity(trading_client)
                    if account_balance_after is not None:
                        update["account_balance_after"]  = round(account_balance_after, 2)
                        update["account_balance_change"] = round(account_balance_after - account_balance_before, 2)

            # account_balance_after/change require a DB migration — try with them
            # first, fall back to the base update if the columns don't exist yet.
            try:
                self.client.table("orb_trades").update(update).eq("id", row["id"]).execute()
            except Exception as e:
                if "account_balance_after" not in str(e) and "account_balance_change" not in str(e):
                    raise
                stripped = {k: v for k, v in update.items()
                            if k not in ("account_balance_after", "account_balance_change")}
                logger.warning("[TradeLogger] log_exit: account_balance columns missing — "
                               "retrying without them (run Supabase migration to fix)")
                self.client.table("orb_trades").update(stripped).eq("id", row["id"]).execute()

            q = self.client.table("orb_session").update({"trade_taken": True}).eq(
                "session_date", str(date.today())
            )
            if strategy_id:
                q = q.eq("strategy_id", strategy_id)
            q.execute()
            return True
        except Exception as e:
            logger.error("[TradeLogger] log_exit failed: %s", e)
            return False

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

    def get_open_trades(self) -> list[dict]:
        """
        Every orb_trades row with no exit_time yet — i.e. still open at the
        broker. Scanned once at boot to reattach exit-management state to
        whatever's actually still open, so a restart can never again leave a
        real position invisible and unmonitored in this app while it's still
        live at Alpaca. See docs/incidents/2026-07-14-position-lost-on-restart.md.
        """
        try:
            res = (
                self.client.table("orb_trades")
                .select("*")
                .is_("exit_time", "null")
                .order("entry_time")
                .execute()
            )
            return res.data or []
        except Exception as e:
            logger.error("[TradeLogger] get_open_trades failed: %s", e)
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
