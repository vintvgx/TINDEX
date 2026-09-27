"""
Watches user-defined key price levels (self-identified or confirmed by a
Discord options-flow admin) against live 1-minute bars, and once a bar
CLOSES through the level, scores contract suggestions and notifies.

Decoupled from the ORB opening-range-breakout strategy — this isn't a
trading engine, it never submits orders — but it reuses the exact same live
bar feed (OrbDataHub, published by OrbService) and the same bar-close
confirmation rule ORBEngine uses for ORH/ORL breakouts
(`bar.close > level` / `bar.close < level`, see orb_engine.py's
`_bar_confirm_pending` handling). See docs discussion 2026-08-23.

IMPORTANT: OrbDataHub only publishes bars for tickers with
user_stock_follows.orb_enabled = True (OrbService.load_followed_stocks).
The price-level route ensures this by calling SupabaseService.follow_stock()
whenever a level is created — same flag the ticker-detail-sheet ORB star
toggles. This only turns on bar streaming + ORB range calc for the ticker;
it does not start automated trading (that requires a separate strategy
config).

Confirmation work (options chain fetch + AI scoring) runs on a background
thread, never inline in the bar callback — that callback executes
synchronously on OrbService's asyncio-loop thread (see OrbDataHub.publish_bar
docstring), and every other ticker's bar processing would stall behind a
multi-second Claude round trip if this blocked there.
"""

import asyncio
import logging
import threading
from datetime import datetime, timedelta, timezone
from typing import Optional

from services.utils.orb_data_hub import OrbBar, get_orb_data_hub

logger = logging.getLogger(__name__)

# Contract-scoring prompt kept local rather than importing from
# routes/agent_routes.py — routes import services, not the other way around.
LEVEL_SCORE_SYSTEM_PROMPT = (
    "You are TINDEX, an expert AI financial assistant specializing in options trading "
    "and market analysis. Provide data-driven, actionable insights. Always include the "
    "disclaimer: \"Not financial advice. Always do your own research.\""
)

# How many strikes (per side) to fetch/score candidates from — bounded so a
# confirmation never fires more than this many Claude calls.
MAX_SCORED_CANDIDATES = 3
# Short-dated by default (matches the Discord flow examples: 0DTE-ish to a
# couple weeks out) — a level can always be re-added with different bounds
# if a longer-dated play is wanted.
SUGGESTION_EXPIRY_WINDOW_DAYS = 14


def _run_async(coro):
    loop = asyncio.new_event_loop()
    try:
        asyncio.set_event_loop(loop)
        return loop.run_until_complete(coro)
    finally:
        loop.close()


class KeyLevelWatcher:
    """Process-wide singleton. In-memory watch state is rebuilt from
    watched_price_levels on start() — a redeploy loses no watching levels,
    it just re-subscribes them."""

    def __init__(self):
        self._lock = threading.RLock()
        # ticker -> {level_id: level_row}
        self._watching: dict[str, dict[str, dict]] = {}
        # ticker -> True once we've called OrbDataHub.subscribe_bar for it
        self._subscribed_tickers: set[str] = set()

    # ── Lifecycle ────────────────────────────────────────────────────────────

    def start(self):
        """Load every currently-watching level from the DB and subscribe.
        Call once at process startup."""
        try:
            from services.supabase.supabase_service import get_supabase_service
            sb = get_supabase_service().client
            rows = (
                sb.table("watched_price_levels")
                .select("*")
                .eq("status", "watching")
                .execute()
                .data or []
            )
            for row in rows:
                self.watch_level(row)
            logger.info("[KeyLevelWatcher] started — %d level(s) reloaded", len(rows))
        except Exception as e:
            logger.error("[KeyLevelWatcher] start failed: %s", e, exc_info=True)

    # ── Public API (called from price_level_routes.py) ─────────────────────

    def watch_level(self, level: dict) -> None:
        """Register a level for watching. Idempotent — safe to call again
        for a level already being watched (e.g. on restart)."""
        ticker = level["ticker"]
        with self._lock:
            self._watching.setdefault(ticker, {})[level["id"]] = level
            if ticker not in self._subscribed_tickers:
                get_orb_data_hub().subscribe_bar(ticker, self._make_bar_handler(ticker))
                self._subscribed_tickers.add(ticker)
        logger.info("[KeyLevelWatcher] watching %s %s $%.2f-$%.2f (%s)",
                    ticker, level["direction"], level["level_low"], level["level_high"], level["id"])

    def cancel_level(self, level_id: str) -> None:
        """Stop watching a level (user deleted it). Leaves the ticker's bar
        subscription in place — cheap, and another level may still need it."""
        with self._lock:
            for ticker, levels in self._watching.items():
                if level_id in levels:
                    del levels[level_id]
                    logger.info("[KeyLevelWatcher] cancelled %s (%s)", level_id, ticker)
                    return

    # ── Bar handling ─────────────────────────────────────────────────────────

    def _make_bar_handler(self, ticker: str):
        def handler(bar: OrbBar):
            self._on_bar(ticker, bar)
        return handler

    def _on_bar(self, ticker: str, bar: OrbBar) -> None:
        if bar.close is None:
            return
        with self._lock:
            levels = list(self._watching.get(ticker, {}).values())
        if not levels:
            return

        for level in levels:
            direction = level["direction"]
            level_low = float(level["level_low"])
            level_high = float(level["level_high"])

            # 'either' watches BOTH sides at once — a two-sided technical
            # setup (e.g. "holds = bullish continuation, breaks = bearish
            # breakdown") shouldn't have to pick just one direction to watch
            # and silently miss the other. Whichever side breaks first wins;
            # the level's stored direction gets overwritten with that
            # concrete outcome once confirmed (see _process_confirmation).
            if direction == "bullish":
                confirmed, triggered_direction = bar.close > level_high, "bullish"
            elif direction == "bearish":
                confirmed, triggered_direction = bar.close < level_low, "bearish"
            else:
                if bar.close > level_high:
                    confirmed, triggered_direction = True, "bullish"
                elif bar.close < level_low:
                    confirmed, triggered_direction = True, "bearish"
                else:
                    confirmed, triggered_direction = False, None
            if not confirmed:
                continue

            # Remove immediately (under lock) so a rapid run of bars can't
            # fire this level twice while the background thread is still
            # working through the chain fetch + scoring.
            with self._lock:
                self._watching.get(ticker, {}).pop(level["id"], None)

            logger.info("[KeyLevelWatcher] %s %s level %s confirmed @ %.2f (watch was %s)",
                        ticker, triggered_direction, level["id"], bar.close, direction)
            threading.Thread(
                target=self._process_confirmation,
                args=(level, bar.close, triggered_direction),
                daemon=True,
                name=f"key-level-confirm-{level['id'][:8]}",
            ).start()

    # ── Confirmation processing (background thread) ─────────────────────────

    def _process_confirmation(self, level: dict, confirmed_price: float, direction: str) -> None:
        ticker = level["ticker"]
        try:
            suggestions = self._build_suggestions(level, confirmed_price, direction)
        except Exception as e:
            logger.error("[KeyLevelWatcher] suggestion build failed for %s: %s",
                         level["id"], e, exc_info=True)
            suggestions = []

        try:
            from services.supabase.supabase_service import get_supabase_service
            sb = get_supabase_service().client
            sb.table("watched_price_levels").update({
                "status": "confirmed",
                # Overwrite 'either' (or re-confirm bullish/bearish as-is)
                # with the concrete side that actually triggered — nothing
                # downstream (mobile rendering, notifications) needs to know
                # about 'either' once a level is past 'watching'.
                "direction": direction,
                "confirmed_at": datetime.now(timezone.utc).isoformat(),
                "confirmed_price": confirmed_price,
                "suggested_contracts": suggestions,
            }).eq("id", level["id"]).execute()

            from services.strategy.notifier import StrategyNotifier
            StrategyNotifier(sb).notify_level_confirmed(
                ticker=ticker,
                direction=direction,
                level_low=float(level["level_low"]),
                level_high=float(level["level_high"]),
                price=confirmed_price,
                level_id=level["id"],
                contract_count=len(suggestions),
            )
        except Exception as e:
            logger.error("[KeyLevelWatcher] confirmation save/notify failed for %s: %s",
                         level["id"], e, exc_info=True)

    def _build_suggestions(self, level: dict, confirmed_price: float, direction: str) -> list[dict]:
        ticker = level["ticker"]
        named_contracts = level.get("named_contracts") or []

        from services.alpaca.alpaca_option_service import get_alpaca_option_service
        option_service = get_alpaca_option_service()

        today = datetime.now().date()
        chain = _run_async(option_service.get_options(
            ticker=ticker,
            limit=200,
            expiration_date_gte=today.isoformat(),
            expiration_date_lte=(today + timedelta(days=SUGGESTION_EXPIRY_WINDOW_DAYS)).isoformat(),
            current_price=confirmed_price,
        ))
        side_key = "calls" if direction == "bullish" else "puts"
        candidates = chain.get(side_key) or []
        if not candidates:
            return []

        # Named contracts (typed in at level-creation time) are pinned to
        # the front regardless of score — match by strike+expiry+type
        # against the live chain so they carry real pricing/greeks, not just
        # the bare numbers the user typed.
        def _matches_named(c: dict, named: dict) -> bool:
            return (
                c.get("option_type") == named.get("option_type")
                and float(c.get("strike", -1)) == float(named.get("strike", -2))
                and c.get("expiration") == named.get("expiration_date")
            )

        pinned: list[dict] = []
        remaining = list(candidates)
        for named in named_contracts:
            match = next((c for c in remaining if _matches_named(c, named)), None)
            if match:
                pinned.append(match)
                remaining.remove(match)

        # Nearest-to-spot candidates on the correct side (OTM/ATM in the
        # confirmed direction), filling up to MAX_SCORED_CANDIDATES total
        # including any pinned ones already selected.
        remaining.sort(key=lambda c: abs(float(c.get("strike", 0)) - confirmed_price))
        slots_left = max(0, MAX_SCORED_CANDIDATES - len(pinned))
        ranked = pinned + remaining[:slots_left]

        from services.anthropic.anthropic_service import anthropic_service
        suggestions: list[dict] = []
        for i, contract in enumerate(ranked):
            is_pinned = i < len(pinned)
            try:
                result = anthropic_service.score_contract(ticker, contract, LEVEL_SCORE_SYSTEM_PROMPT)
            except Exception as e:
                logger.warning("[KeyLevelWatcher] scoring failed for %s: %s",
                               contract.get("symbol"), e)
                result = {"score": None, "signal": None, "reasoning": None}
            suggestions.append({
                "contract": contract,
                "score": result.get("score"),
                "signal": result.get("signal"),
                "reasoning": result.get("reasoning"),
                "pinned": is_pinned,
            })

        # Pinned first (already at the front), then by score desc among the rest.
        suggestions.sort(key=lambda s: (not s["pinned"], -(s["score"] or 0)))
        return suggestions


_watcher_singleton: Optional[KeyLevelWatcher] = None
_watcher_lock = threading.Lock()


def get_key_level_watcher() -> KeyLevelWatcher:
    global _watcher_singleton
    if _watcher_singleton is None:
        with _watcher_lock:
            if _watcher_singleton is None:
                _watcher_singleton = KeyLevelWatcher()
    return _watcher_singleton
