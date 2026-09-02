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
  3 — MARKET       (retest armed / 30-min timer update / social signal)
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


def _account_tag(paper_mode: bool) -> str:
    return "PAPER" if paper_mode else "LIVE"


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
    def notify_position_recovered(self, ticker: str, contract_symbol: str, direction: str,
                                   qty: int, entry_premium: float, paper_mode: bool = True):
        """
        A restart happened while this position was open, and its exit
        management (stop-loss/TP monitoring) has just been reattached —
        added after a restart on 2026-07-13 silently dropped an open IWM put
        with no notification at all, leaving it unmonitored until the user
        noticed and closed it manually through Alpaca directly. This fires
        at P_TRADE_ENTRY priority specifically so it's impossible to miss —
        confirms the position is visible and protected again, not just that
        something recovered somewhere.
        """
        tag = _account_tag(paper_mode)
        readable = _fmt_contract(contract_symbol)
        self._dispatch(
            title=f"🔄 [{tag}] {readable} — position recovered",
            body=f"{direction} qty={qty} @ ${entry_premium:.2f} — stop-loss monitoring resumed after restart.",
            data={"screen": "position", "symbol": contract_symbol, "paper_mode": paper_mode},
            priority=P_TRADE_ENTRY,
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
            data={"screen": "strategy", "type": "retest_watching", "ticker": ticker,
                  "profile": profile_key, "level": level},
            priority=P_MARKET,
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
        paper_mode: bool = True,
    ):
        """A market order was successfully submitted."""
        tag        = _account_tag(paper_mode)
        symbol     = contract.get("symbol", "")
        label      = _fmt_contract(symbol) if symbol else f"{ticker} option"
        cost       = entry_premium * qty * 100
        macro_warn = "  ⚠ Macro event today" if macro_event else ""

        self._dispatch(
            title=f"[{tag}] {label} entered  [{profile_key}]",
            body=f"@ ${entry_premium:.2f} × {qty} contracts  (${cost:,.0f} total){macro_warn}",
            data={
                "screen":      "position",
                "trade_id":    trade_id,
                "symbol":      symbol,
                "macro_event": macro_event,
                "paper_mode":  paper_mode,
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
        exit_premium: float | None = None,
        paper_mode: bool = True,
        strategy_id: str | None = None,
    ):
        """One or more contracts were closed (stop, TP1, TP2, EOD, etc.).

        exit_premium — the actual fill price. Added so a priced exit (TP1/TP2/
        manual sell now sample the bid and/or use a limit order rather than
        firing an instant market order — see ORBEngine._execute_priced_exit)
        can show the user what price it actually sold at, not just the P&L.

        strategy_id/qty/exit_premium/pnl in `data` (2026-08-11): this push is
        dispatched from a background queue independent of the HTTP response
        for whatever request triggered the exit (see _dispatch — a plain
        queue.put(), already enqueued before the route even builds its JSON
        response). A manual sell's REST response can be lost — dropped
        connection, app backgrounded mid-request — while this notification
        still lands, since it never depended on that response arriving.
        Structured `data` lets the client's notification-received listener
        resolve the mobile ticker tape's "Selling…" status to "Sold…" off
        THIS delivery instead of the fragile HTTP round-trip — see
        useNotifications.ts's foreground listener and useSellStatus's
        markSoldByStrategyId. strategy_id is the correlation key; the
        client's own SellStatus.id is generated locally and unknown here.
        """
        tag   = _account_tag(paper_mode)
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
            "LOW_VOLUME_EXIT":    "Low-volume exit",
            "MANUAL_CLOSE":       "Manually closed",
            "MANUAL_EXIT":        "Manually sold",
            "FORCE_CLOSE":        "Force-closed",
        }
        label = labels.get(exit_reason, exit_reason)
        price_str = f" @ ${exit_premium:.2f}" if exit_premium is not None else ""

        readable = _fmt_contract(contract_symbol)
        self._dispatch(
            title=f"{emoji} [{tag}] {readable} — {label}  [{profile_key}]",
            body=f"{qty} contracts{price_str}  P&L: {sign}${pnl:,.2f}",
            data={
                "screen":       "tradelog",
                "symbol":       contract_symbol,
                "exit_reason":  exit_reason,
                "paper_mode":   paper_mode,
                "strategy_id":  strategy_id,
                "qty":          qty,
                "exit_premium": exit_premium,
                "pnl":          round(pnl, 2),
            },
            priority=P_TRADE_EXIT,
        )

    def notify_sl_grace_started(
        self,
        ticker: str,
        contract_symbol: str,
        current_premium: float,
        hard_stop: float,
        grace_seconds: int,
        paper_mode: bool = True,
    ):
        """
        The premium just confirmed at/below the hard stop, but this profile
        (SL_5/SL_10 — or REVERSAL's bars-based grace) doesn't exit instantly:
        it's now waiting out a grace window before force-closing. This is the
        user's window to intervene manually (close it themselves, or just
        let it ride) if they disagree with the pending auto-exit — fires
        once per breach, not on every tick. See ORBEngine._process_tick.
        """
        tag = _account_tag(paper_mode)
        readable = _fmt_contract(contract_symbol)
        mins = grace_seconds // 60
        self._dispatch(
            title=f"⏱️ [{tag}] {readable} — SL breach, {mins}-min grace started",
            body=f"@ ${current_premium:.2f} (stop ${hard_stop:.2f}) — will sell at best price if still below in {mins} min.",
            data={
                "screen":      "position",
                "symbol":      contract_symbol,
                "type":        "sl_grace_started",
                "paper_mode":  paper_mode,
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
        paper_mode: bool = True,
    ):
        """30-minute mark: P&L update while trade is live."""
        tag   = _account_tag(paper_mode)
        sign  = "+" if current_pnl >= 0 else ""
        arrow = "↑" if current_pnl >= 0 else "↓"
        chg   = current_premium - entry_premium

        readable = _fmt_contract(contract_symbol)
        self._dispatch(
            title=f"[{tag}] {readable} update (30 min)",
            body=(
                f"{arrow} ${current_premium:.2f}  "
                f"({sign}${chg:.2f}/contract)  "
                f"Total: {sign}${current_pnl:,.2f}"
            ),
            data={
                "screen": "position",
                "symbol": contract_symbol,
                "paper_mode": paper_mode,
            },
            priority=P_MARKET,
        )

    def notify_expiry_reminder(self, contract_symbol: str, days_to_expiry: int,
                                milestone: str, qty: int, direction: str,
                                paper_mode: bool = True):
        """
        Heads-up that an open (typically swing/LEAPS) position is approaching
        its own expiration — purely informational, no automatic action taken.
        Added after EOD auto-close was scoped to 0DTE-only (2026-07-17): the
        app no longer force-closes a multi-day hold, so this is the
        replacement safety net — a reminder, not a forced exit.
        """
        tag = _account_tag(paper_mode)
        milestone_label = {
            "week":     "expires this week",
            "two_day":  "expires in 2 days",
            "one_day":  "expires tomorrow",
        }.get(milestone, f"expires in {days_to_expiry}d")
        readable = _fmt_contract(contract_symbol)
        self._dispatch(
            title=f"⏳ [{tag}] {readable} — {milestone_label}",
            body=f"{direction} · {qty} contract(s) · {days_to_expiry} day(s) to expiration.",
            data={"screen": "position", "symbol": contract_symbol, "type": "expiry_reminder",
                  "paper_mode": paper_mode},
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
        paper_mode: bool = True,
    ):
        """A second entry was taken after a partial exit (runner re-entered)."""
        tag     = _account_tag(paper_mode)
        symbol  = contract.get("symbol", "")
        label   = _fmt_contract(symbol) if symbol else f"{ticker} option"

        self._dispatch(
            title=f"[{tag}] {label} re-entered  [{profile_key}]",
            body=f"@ ${entry_premium:.2f} × {qty} contracts",
            data={
                "screen": "position",
                "symbol": contract.get("symbol"),
                "re_entry": True,
                "paper_mode": paper_mode,
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
        paper_mode: bool = True,
        conflict_context: dict | None = None,
    ):
        """
        A breakout/reversal was confirmed and a contract was selected, but
        entry is paused for user approval instead of being submitted —
        either because the strategy has confirm_entry enabled, or because
        conflict_context is set (another engine already holds this same
        ticker+direction open — see ORBEngine._find_ticker_conflict).
        Tapping this opens the Dashboard, where every pending confirmation
        shows as its own card (Edit/Skip/Enter) — see dashboard.tsx and
        TickerTape's "Awaiting Trade Confirmation" banner, both of which
        already surface this independent of the tap (2026-07-29 redesign:
        this used to be a blocking full-screen modal that could stack two
        deep and lock up the UI).
        """
        tag    = _account_tag(paper_mode)
        symbol = contract.get("symbol", "")
        label  = _fmt_contract(symbol) if symbol else f"{ticker} option"
        if conflict_context:
            conflict_tag = _account_tag(conflict_context.get("paper_mode", True))
            title = f"[{tag}] {ticker} Already Open — Confirm?"
            body = (
                f"{label}  [{profile_key}]  ·  You already have an open "
                f"{conflict_context.get('profile', 'position')} {direction} on "
                f"{ticker} ({conflict_tag})  ·  expires in {expires_in_min} min"
            )
        else:
            title = f"[{tag}] Confirm {ticker} Trade"
            body = (
                f"{label}  [{profile_key}]  ·  Confidence {confidence:.0f}/100  ·  "
                f"expires in {expires_in_min} min"
            )
        self._dispatch(
            title=title,
            body=body,
            data={
                "screen":     "dashboard",
                "type":       "confirm_entry",
                "pending_id": pending_id,
                "symbol":     symbol,
                "paper_mode": paper_mode,
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

    def notify_level_confirmed(self, ticker: str, direction: str, level_low: float,
                                level_high: float, price: float, level_id: str,
                                contract_count: int = 0):
        """
        A user-watched key level (self-identified or from a Discord flow
        call — see watched_price_levels / KeyLevelWatcher) just had a
        1-minute bar close through it. Suggested contracts have already
        been scored and attached to the row by the time this fires.
        """
        emoji = "📈" if direction == "bullish" else "📉"
        side = "above" if direction == "bullish" else "below"
        level_label = (
            f"${level_low:.2f}" if level_low == level_high
            else f"${level_low:.2f}-${level_high:.2f}"
        )
        suggestion_note = f" · {contract_count} suggestion(s) ready" if contract_count else ""
        self._dispatch(
            title=f"{emoji} {ticker} Key Level Confirmed",
            body=f"Closed {side} {level_label} @ ${price:.2f}{suggestion_note}",
            data={
                "screen": "options",
                "type": "level_confirmed",
                "ticker": ticker,
                "level_id": level_id,
            },
            priority=P_MARKET,
            pref_key="flow_signals",
        )

    def notify_review_ready(self, review_date: str, trade_count: int, net_pnl: float,
                             paper_mode: bool = True):
        """Daily performance review finished generating and saving for ONE account.
        Used only for manual single-account regeneration — the scheduled path
        calls notify_review_ready_combined instead so only one push goes out
        per day covering both accounts."""
        pnl_emoji = "📈" if net_pnl >= 0 else "📉"
        label = "Paper" if paper_mode else "Live"
        self._dispatch(
            title=f"{pnl_emoji} {label} Daily Review ready — {review_date}",
            body=f"{trade_count} trade(s) · Net P&L {'+' if net_pnl >= 0 else '-'}${abs(net_pnl):,.2f}",
            data={"screen": "daily_review", "review_date": review_date, "paper_mode": paper_mode},
            priority=P_INFO,
        )

    def notify_review_ready_combined(self, review_date: str, total_trade_count: int,
                                      total_net_pnl: float):
        """
        Both accounts' daily reviews finished — one notification covering
        both, not one per account. See /strategy/review/generate.
        """
        pnl_emoji = "📈" if total_net_pnl >= 0 else "📉"
        self._dispatch(
            title=f"{pnl_emoji} Daily Review ready — {review_date}",
            body=f"{total_trade_count} trade(s) · Net P&L {'+' if total_net_pnl >= 0 else '-'}${abs(total_net_pnl):,.2f}",
            data={"screen": "daily_review", "review_date": review_date},
            priority=P_INFO,
        )

    def notify_market_digest_ready(self, digest_date: str):
        """
        Pre-market Market Digest finished generating and saving — fires
        ~8:30 AM ET on trade days (see the pg_cron migration) so it's
        already on-device by the 9 AM read-by target. Tapping it opens the
        full-screen digest modal on Home — see NotificationNavigationService.
        """
        self._dispatch(
            title="☀️ Market Digest ready",
            body=f"Pre-market setup, headlines, and your levels for {digest_date} — tap to view.",
            data={"screen": "market_digest", "digest_date": digest_date},
            priority=P_INFO,
        )

    def notify_test(self, title: str, body: str):
        """
        Free-form push with no domain fields — used only by the Profile >
        Simulator screen's "Send Test Push" action (see
        POST /strategy/debug/test-push) to verify a device actually receives
        pushes without needing a real or simulated trade first.
        """
        self._dispatch(title=title, body=body, priority=P_INFO)

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
