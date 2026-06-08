"""
Synchronous push-notification layer for the ORB strategy engine.

Sends Expo push notifications for all significant trading events:
skip, entry, exit (stop/TP1/TP2/EOD), 30-minute trade update,
capital-insufficient skip, and no-contract-found skip.

Notifications are sent in a background thread so they never block
the APScheduler job threads that drive the engine.
"""

import os
import logging
import threading
import requests

logger = logging.getLogger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"


class StrategyNotifier:
    """
    Wraps Expo push delivery for ORB strategy events.
    Constructed with a live Supabase client so it shares the connection
    already held by TradeLogger.

    NOTE: All public methods are called synchronously from ORBEngine but
    dispatch HTTP requests on a daemon thread to avoid blocking.
    """

    def __init__(self, supabase_client):
        self._sb = supabase_client

    # ── Public event methods ────────────────────────────────────────────────────
    def notify_start(self, provider: str):
        """ORB service and strategy engine confirmed running."""
        self._dispatch(
            title="ORB Service + Engine started",
            body=f"Monitoring active via {provider.upper()} streaming.",
            data={"screen": "tradelog"},
        )

    def notify_skip(self, ticker: str, reason: str):
        """Session skipped before ORB could be evaluated."""
        readable = {
            "NOT_TRADE_DAY":             "not a scheduled trade day",
            "STRATEGY_DISABLED":         "strategy is disabled",
            "NO_DATA":                   "no price data available",
            "ORB_RANGE_TOO_TIGHT":       "ORB range too tight",
            "VIX_TOO_LOW":               "VIX too low",
            "VIX_TOO_HIGH":              "VIX too high",
            "MACRO_EVENT":               "macro event today",
            "BREAKOUT_TIME_LIMIT_EXCEEDED": "breakout window expired",
        }.get(reason, reason)

        self._dispatch(
            title=f"No trade — {ticker}",
            body=f"Session skipped: {readable}.",
            data={"screen": "tradelog", "reason": reason},
        )

    def notify_no_contract(self, ticker: str):
        """No suitable options contract was found for the breakout."""
        self._dispatch(
            title=f"{ticker} — No contract",
            body="No suitable contract found for this breakout. Skipping entry.",
            data={"screen": "tradelog"},
        )

    def notify_insufficient_capital(self, ticker: str, required: float, available: float):
        """Buying power too low to enter even one contract."""
        self._dispatch(
            title=f"{ticker} — Insufficient capital",
            body=(
                f"Need ${required:,.0f} but only ${available:,.0f} available. "
                "No contracts entered."
            ),
            data={"screen": "tradelog"},
        )

    def notify_entry(
        self,
        ticker: str,
        direction: str,
        contract: dict,
        qty: int,
        entry_premium: float,
        trade_id: str | None,
        profile_key: str,
        macro_event: bool = False,
    ):
        """A market order was successfully submitted."""
        opt_type = "C" if direction == "CALL" else "P"
        strike   = contract.get("strike", "")
        symbol   = contract.get("symbol", "")
        cost     = entry_premium * qty * 100
        macro_warn = "  ⚠ Macro event today" if macro_event else ""

        self._dispatch(
            title=f"{ticker} {strike}{opt_type} entered  [{profile_key}]",
            body=f"@ ${entry_premium:.2f} × {qty} contracts  (${cost:,.0f} total){macro_warn}",
            data={
                "screen":      "position",
                "trade_id":    trade_id,
                "symbol":      symbol,
                "macro_event": macro_event,
            },
        )

    def notify_exit(
        self,
        ticker: str,
        contract_symbol: str,
        exit_reason: str,
        pnl: float,
        qty: int,
        profile_key: str,
    ):
        """One or more contracts were closed (stop, TP1, TP2, EOD, etc.)."""
        sign  = "+" if pnl >= 0 else ""
        emoji = "✅" if pnl >= 0 else "🛑"

        labels = {
            "HARD_STOP":          "Stopped out",
            "TP1":                "TP1 hit — partial close",
            "TP2":                "TP2 hit — partial close",
            "TP2_FULL_CLOSE":     "TP2 hit — full close",
            "RUNNER_TRAIL_STOP":  "Runner trailing stop",
            "EOD_CLOSE":          "EOD close",
            "EOD_HARD_CLOSE":     "EOD hard close",
            "BREAKEVEN_STOP":     "Breakeven stop hit",
            "CONSOLIDATION":      "Consolidation exit",
            "LOW_VOLUME_EXIT":    "Low-volume exit",
            "MANUAL_CLOSE":       "Manually closed",
            "FORCE_CLOSE":        "Force-closed",
        }
        label = labels.get(exit_reason, exit_reason)

        self._dispatch(
            title=f"{emoji} {ticker} — {label}  [{profile_key}]",
            body=f"{contract_symbol}  {qty} contracts  P&L: {sign}${pnl:,.2f}",
            data={
                "screen":      "tradelog",
                "symbol":      contract_symbol,
                "exit_reason": exit_reason,
            },
        )

    def notify_timer_update(
        self,
        ticker: str,
        contract_symbol: str,
        current_pnl: float,
        entry_premium: float,
        current_premium: float,
    ):
        """30-minute mark: P&L update while trade is live."""
        sign  = "+" if current_pnl >= 0 else ""
        arrow = "↑" if current_pnl >= 0 else "↓"
        chg   = current_premium - entry_premium

        self._dispatch(
            title=f"{ticker} trade update (30 min)",
            body=(
                f"{contract_symbol} {arrow} ${current_premium:.2f}  "
                f"({sign}${chg:.2f}/contract)  "
                f"Total: {sign}${current_pnl:,.2f}"
            ),
            data={
                "screen": "position",
                "symbol": contract_symbol,
            },
        )

    def notify_stream_failed(self, ticker: str, contract_symbol: str):
        """Option stream could not be verified — trade skipped."""
        self._dispatch(
            title=f"{ticker} — Stream unavailable",
            body=(
                f"Could not stream real-time quotes for {contract_symbol}. "
                "Trade skipped to avoid blind entry."
            ),
            data={"screen": "tradelog", "symbol": contract_symbol},
        )

    def notify_re_entry(
        self,
        ticker: str,
        direction: str,
        contract: dict,
        qty: int,
        entry_premium: float,
        profile_key: str,
    ):
        """A second entry was taken after a partial exit (runner re-entered)."""
        opt_type = "C" if direction == "CALL" else "P"
        strike   = contract.get("strike", "")

        self._dispatch(
            title=f"{ticker} {strike}{opt_type} re-entered  [{profile_key}]",
            body=f"@ ${entry_premium:.2f} × {qty} contracts",
            data={
                "screen": "position",
                "symbol": contract.get("symbol"),
                "re_entry": True,
            },
        )

    # ── Internal helpers ────────────────────────────────────────────────────────

    def _dispatch(self, title: str, body: str, data: dict | None = None):
        """Fire-and-forget: send on a daemon thread so the engine is never blocked."""
        t = threading.Thread(
            target=self._send_all,
            args=(title, body, data or {}),
            daemon=True,
        )
        t.start()

    def _send_all(self, title: str, body: str, data: dict):
        tokens = self._fetch_tokens()
        if not tokens:
            return
        for token in tokens:
            try:
                resp = requests.post(
                    EXPO_PUSH_URL,
                    json={
                        "to":    token,
                        "title": title,
                        "body":  body,
                        "data":  data,
                        "sound": "default",
                    },
                    headers={
                        "Accept":          "application/json",
                        "Accept-Encoding": "gzip, deflate",
                        "Content-Type":    "application/json",
                    },
                    timeout=8,
                )
                if resp.status_code != 200:
                    logger.warning("[StrategyNotifier] Expo %s → %s", token, resp.text[:120])
            except Exception as e:
                logger.warning("[StrategyNotifier] send failed: %s", e)

    def _fetch_tokens(self) -> list[str]:
        """Return all enabled Expo push tokens from user_profiles."""
        try:
            res = (
                self._sb.table("user_profiles")
                .select("expo_push_token, notification_preferences")
                .neq("expo_push_token", "null")
                .neq("expo_push_token", "")
                .execute()
            )
            tokens = []
            for row in (res.data or []):
                prefs = row.get("notification_preferences") or {}
                if not prefs.get("enabled", True):
                    continue
                tok = row.get("expo_push_token")
                if tok:
                    tokens.append(tok)
            return tokens
        except Exception as e:
            logger.warning("[StrategyNotifier] token fetch failed: %s", e)
            return []
