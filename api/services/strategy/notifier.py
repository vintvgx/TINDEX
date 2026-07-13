"""
Priority-queued push-notification layer for the ORB strategy engine.

Sends Expo push notifications for all significant trading events:
skip, entry, exit (stop/TP1/TP2/EOD), 30-minute trade update,
capital-insufficient skip, and no-contract-found skip.

Notifications are dispatched through a single-worker priority queue so
they always arrive on-device in importance order regardless of which
engine events fire simultaneously. Priority tiers:

  0 — TRADE_EXIT   (HARD_STOP / TP1 / TP2 / EOD close — money moved)
  1 — TRADE_ENTRY  (order placed — position open)
  2 — OPERATIONAL  (stream failure / no contract / capital warning)
  3 — MARKET       (retest armed / 30-min timer update / flow blocked)
  4 — INFO         (session armed / skip / no trade / service start)

Within the same tier, notifications are delivered in chronological order
(FIFO). The worker thread is a daemon so it stops cleanly on shutdown.
"""

import re
import time
import queue
import logging
import threading
import requests
from datetime import date as _date

logger = logging.getLogger(__name__)

# Priority tier constants — lower = delivered first
P_TRADE_EXIT   = 0
P_TRADE_ENTRY  = 1
P_OPERATIONAL  = 2
P_MARKET       = 3
P_INFO         = 4

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"

_MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]

def _fmt_contract(symbol: str) -> str:
    """
    Converts OCC symbol to human-readable label.
    "QQQ260611C00699000" → "QQQ $699C 0DTE"  (or "QQQ $699C Jun 11")
    """
    m = re.match(r'^([A-Z]+)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$', symbol)
    if not m:
        return symbol
    ticker, yy, mm, dd, opt, strike_raw = m.groups()
    year   = 2000 + int(yy)
    month  = int(mm)
    day    = int(dd)
    strike = int(strike_raw) / 1000
    strike_str = f"${strike:.0f}" if strike == int(strike) else f"${strike:.2f}".rstrip('0')

    today = _date.today()
    is_0dte = (year == today.year and month == today.month and day == today.day)
    if is_0dte:
        date_str = "0DTE"
    elif year != today.year:
        date_str = f"{_MONTHS[month-1]} {day}, {year}"
    else:
        date_str = f"{_MONTHS[month-1]} {day}"

    return f"{ticker} {strike_str}{opt} {date_str}"


class StrategyNotifier:
    """
    Wraps Expo push delivery for ORB strategy events.
    Constructed with a live Supabase client so it shares the connection
    already held by TradeLogger.

    NOTE: All public methods are called synchronously from ORBEngine but
    dispatch HTTP requests on a daemon thread to avoid blocking.
    """

    def __init__(self, supabase_client):
        self._sb  = supabase_client

        # Priority queue: items are (priority, seq, (title, body, data)).
        # seq is a monotonically increasing counter that keeps same-priority
        # items in arrival order (PriorityQueue needs a fully orderable tuple).
        self._queue    = queue.PriorityQueue()
        self._seq      = 0
        self._seq_lock = threading.Lock()

        # Single daemon thread drains the queue so notifications are serialized
        # and arrive on-device in priority order.
        self._worker = threading.Thread(target=self._drain, daemon=True, name="notifier-drain")
        self._worker.start()

    # ── Public event methods ────────────────────────────────────────────────────
    def notify_flow_blocked(self, ticker: str, direction: str):
        """Entry blocked by Unusual Whales flow confirmation."""
        self._dispatch(
            title=f"{ticker} — Flow mismatch",
            body=f"Breakout detected ({direction}) but options flow disagrees. Entry skipped.",
            data={"screen": "tradelog"},
            priority=P_MARKET,
        )

    def notify_start(self, provider: str):
        """ORB service and strategy engine confirmed running."""
        self._dispatch(
            title="ORB Service + Engine started",
            body=f"Monitoring active via {provider.upper()} streaming.",
            data={"screen": "tradelog"},
            priority=P_INFO,
        )

    def notify_session_armed(self, ticker: str, orh: float, orl: float, profile_key: str):
        """ORB calculated — engine is now watching for a breakout."""
        orb_range = round(orh - orl, 2)
        self._dispatch(
            title=f"{ticker} — Watching for breakout  [{profile_key}]",
            body=f"ORH ${orh:.2f}  ORL ${orl:.2f}  Range ${orb_range:.2f}",
            data={"screen": "strategy"},
            priority=P_INFO,
        )

    def notify_retest_watching(self, ticker: str, direction: str, level: float,
                                breakout_price: float, profile_key: str):
        """Fired when the Retester profile detects a breakout and arms the retest watch."""
        dir_emoji = "📈" if direction == "CALL" else "📉"
        level_label = "ORH" if direction == "CALL" else "ORL"
        self._dispatch(
            title=f"{dir_emoji} {ticker} Retest Watch Armed",
            body=(f"Breakout @ ${breakout_price:.2f} — waiting for {level_label} "
                  f"retest at ${level:.2f}"),
            data={"type": "retest_watching", "ticker": ticker,
                  "profile": profile_key, "level": level},
            priority=P_MARKET,
        )

    def notify_no_trade_eod(self, ticker: str, profile_key: str, orh: float, orl: float):
        """Session closed at EOD with no entry taken."""
        self._dispatch(
            title=f"{ticker} — No trade today  [{profile_key}]",
            body=f"Watched ORH ${orh:.2f} / ORL ${orl:.2f} — no breakout triggered.",
            data={"screen": "tradelog"},
            priority=P_INFO,
        )

    def notify_skip(self, ticker: str, reason: str):
        """Session skipped before ORB could be evaluated."""
        # For dynamic reasons (e.g. "RE_ENTRY_COOLDOWN (CALL — 32m remaining)"),
        # check prefix first so the detail is preserved in the body.
        _prefix_map = {
            "RE_ENTRY_COOLDOWN":  "re-entry cooldown active",
            "DAILY_LOSS_LIMIT":   "daily loss limit reached — session halted",
        }
        _exact_map = {
            "NOT_TRADE_DAY":                "not a scheduled trade day",
            "STRATEGY_DISABLED":            "strategy is disabled",
            "NO_DATA":                      "no price data available",
            "ORB_RANGE_TOO_TIGHT":          "ORB range too tight",
            "VIX_TOO_LOW":                  "VIX too low",
            "VIX_TOO_HIGH":                 "VIX too high",
            "MACRO_EVENT":                  "macro event today",
            "BREAKOUT_TIME_LIMIT_EXCEEDED": "breakout window expired",
            "RETEST_TIMEOUT":               "retest timed out",
            "RETEST_INVALIDATED":           "retest invalidated — price crossed level",
        }
        prefix_hit = next((v for k, v in _prefix_map.items() if reason.startswith(k)), None)
        readable = prefix_hit or _exact_map.get(reason, reason)

        self._dispatch(
            title=f"No trade — {ticker}",
            body=f"Session skipped: {readable}.",
            data={"screen": "tradelog", "reason": reason},
            priority=P_INFO,
        )

    def notify_no_contract(self, ticker: str):
        """No suitable options contract was found for the breakout."""
        self._dispatch(
            title=f"{ticker} — No contract",
            body="No suitable contract found for this breakout. Skipping entry.",
            data={"screen": "tradelog"},
            priority=P_OPERATIONAL,
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
            priority=P_OPERATIONAL,
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
        symbol     = contract.get("symbol", "")
        label      = _fmt_contract(symbol) if symbol else f"{ticker} option"
        cost       = entry_premium * qty * 100
        macro_warn = "  ⚠ Macro event today" if macro_event else ""

        self._dispatch(
            title=f"{label} entered  [{profile_key}]",
            body=f"@ ${entry_premium:.2f} × {qty} contracts  (${cost:,.0f} total){macro_warn}",
            data={
                "screen":      "position",
                "trade_id":    trade_id,
                "symbol":      symbol,
                "macro_event": macro_event,
            },
            priority=P_TRADE_ENTRY,
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

        readable = _fmt_contract(contract_symbol)
        self._dispatch(
            title=f"{emoji} {readable} — {label}  [{profile_key}]",
            body=f"{qty} contracts  P&L: {sign}${pnl:,.2f}",
            data={
                "screen":      "tradelog",
                "symbol":      contract_symbol,
                "exit_reason": exit_reason,
            },
            priority=P_TRADE_EXIT,
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

        readable = _fmt_contract(contract_symbol)
        self._dispatch(
            title=f"{readable} update (30 min)",
            body=(
                f"{arrow} ${current_premium:.2f}  "
                f"({sign}${chg:.2f}/contract)  "
                f"Total: {sign}${current_pnl:,.2f}"
            ),
            data={
                "screen": "position",
                "symbol": contract_symbol,
            },
            priority=P_MARKET,
        )

    def notify_stream_failed(self, ticker: str, contract_symbol: str):
        """Option stream could not be verified — trade skipped."""
        self._dispatch(
            title=f"{_fmt_contract(contract_symbol)} — Stream unavailable",
            body="Could not stream real-time quotes. Trade skipped to avoid blind entry.",
            data={"screen": "tradelog", "symbol": contract_symbol},
            priority=P_OPERATIONAL,
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
        symbol  = contract.get("symbol", "")
        label   = _fmt_contract(symbol) if symbol else f"{ticker} option"

        self._dispatch(
            title=f"{label} re-entered  [{profile_key}]",
            body=f"@ ${entry_premium:.2f} × {qty} contracts",
            data={
                "screen": "position",
                "symbol": contract.get("symbol"),
                "re_entry": True,
            },
            priority=P_TRADE_ENTRY,
        )

    def notify_confirm_entry(
        self,
        ticker: str,
        direction: str,
        profile_key: str,
        confidence: float,
        contract: dict,
        pending_id: str,
        expires_in_min: int,
    ):
        """
        confirm_entry gate: a breakout/reversal was confirmed and a contract was
        selected, but the strategy is configured to wait for user approval before
        the order is actually submitted. Tapping this opens the in-app
        Enter/Skip confirmation modal (the modal itself is also shown from
        foregrounding the app while a confirmation is open, not only from the tap).
        """
        symbol = contract.get("symbol", "")
        label  = _fmt_contract(symbol) if symbol else f"{ticker} option"
        self._dispatch(
            title=f"Confirm {ticker} Trade",
            body=(
                f"{label}  [{profile_key}]  ·  Confidence {confidence:.0f}/100  ·  "
                f"expires in {expires_in_min} min"
            ),
            data={
                "screen":     "strategy",
                "type":       "confirm_entry",
                "pending_id": pending_id,
                "symbol":     symbol,
            },
            priority=P_TRADE_ENTRY,
        )

    def notify_social_signal(self, handle: str, contract_symbol: str, ticker: str,
                              option_type: str, strike: float, tweet_text: str,
                              tweet_url: str):
        """A watched X/Twitter account called out an options contract."""
        contract_label = _fmt_contract(contract_symbol)
        snippet = tweet_text if len(tweet_text) <= 100 else tweet_text[:97] + "..."
        self._dispatch(
            title=f"🔥 @{handle}: {contract_label}",
            body=snippet,
            data={
                "screen": "options",
                "type": "social_signal",
                "handle": handle,
                "contract_symbol": contract_symbol,
                "ticker": ticker,
                "option_type": option_type,
                "strike": strike,
                "tweet_url": tweet_url,
            },
            priority=P_MARKET,
            pref_key="flow_signals",
        )

    def notify_review_ready(self, review_date: str, trade_count: int, net_pnl: float,
                             paper_mode: bool = True):
        """Daily performance review finished generating and saving."""
        pnl_emoji = "📈" if net_pnl >= 0 else "📉"
        label = "Paper" if paper_mode else "Live"
        self._dispatch(
            title=f"{pnl_emoji} {label} Daily Review ready — {review_date}",
            body=f"{trade_count} trade(s) · Net P&L {'+' if net_pnl >= 0 else '-'}${abs(net_pnl):,.2f}",
            data={"screen": "daily_review", "review_date": review_date, "paper_mode": paper_mode},
            priority=P_INFO,
        )

    # ── Internal helpers ────────────────────────────────────────────────────────

    def _dispatch(self, title: str, body: str, data: dict | None = None,
                  priority: int = P_INFO, pref_key: str | None = None):
        """
        Enqueue a notification. The worker thread drains in (priority, seq) order,
        so lower priority values always arrive on-device first. Items at the same
        priority are delivered in the order they were enqueued (FIFO via seq).

        `pref_key`, if given, additionally gates delivery on
        `notification_preferences[pref_key]` (defaults to True for users who
        haven't set it) — on top of the always-checked global `enabled` flag.
        """
        with self._seq_lock:
            seq = self._seq
            self._seq += 1
        self._queue.put((priority, seq, (title, body, data or {}, pref_key)))

    # Seconds to wait between consecutive notifications. Gives iOS enough time to
    # deliver each banner individually so none are silently collapsed by the system.
    INTER_NOTIFICATION_DELAY = 5

    def _drain(self):
        """
        Single worker thread. Blocks on the priority queue and sends each
        notification in order. Serialising through one thread guarantees delivery
        order — multiple concurrent daemon threads would race to Expo's API and
        arrive out of order.

        A 5-second sleep between sends lets iOS surface each banner individually
        so they don't all arrive in the same delivery batch.
        Trade-critical exits (priority 0) skip the delay so stops/TPs land immediately.
        """
        last_sent_priority = None
        while True:
            try:
                priority, seq, (title, body, data, pref_key) = self._queue.get()
                # Skip the inter-notification delay for trade exits — stops and TPs
                # are time-critical and should arrive as fast as possible.
                if last_sent_priority is not None and priority != P_TRADE_EXIT:
                    time.sleep(self.INTER_NOTIFICATION_DELAY)
                self._send_all(title, body, data, pref_key)
                last_sent_priority = priority
                self._queue.task_done()
            except Exception as e:
                logger.error("[StrategyNotifier] drain error: %s", e)

    def _send_all(self, title: str, body: str, data: dict, pref_key: str | None = None):
        tokens = self._fetch_tokens(pref_key)
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

    def _fetch_tokens(self, pref_key: str | None = None) -> list[str]:
        """Return all enabled Expo push tokens from user_profiles. `pref_key`,
        if given, additionally requires notification_preferences[pref_key] to
        be truthy (defaults to True — an unset key doesn't opt a user out)."""
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
                if pref_key and not prefs.get(pref_key, True):
                    continue
                tok = row.get("expo_push_token")
                if tok:
                    tokens.append(tok)
            return tokens
        except Exception as e:
            logger.warning("[StrategyNotifier] token fetch failed: %s", e)
            return []
