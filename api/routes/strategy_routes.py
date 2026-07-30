"""
Flask blueprint for ORB strategy endpoints.

Multi-strategy: _engines is a dict keyed by strategy UUID.
Legacy single-engine endpoints (/strategy/config, /strategy/position, etc.)
operate on the first engine for backwards compatibility with old clients.
"""

import logging
import concurrent.futures
from datetime import date, datetime

from flask import Blueprint, jsonify, request
from services.strategy.trade_logger import TradeLogger, enrich_open_trades_with_live_pnl
from services.strategy.profiles import PROFILES, describe_profile
from services.strategy.scheduler import reschedule_jobs, schedule_eod_close
from services.strategy.orb_engine import ORBEngine, STRATEGY_DEFAULTS

logger = logging.getLogger(__name__)

strategy_bp = Blueprint("strategy", __name__, url_prefix="/strategy")

logger_svc    = TradeLogger()
_engines:      dict[str, ORBEngine] = {}   # strategy_id -> ORBEngine
_stream_manager = None                     # OptionStreamManager — set by init_routes

# Bounds how long an immediate-trade request can take. submit_manual_trade()
# already has its own internal guards (8s stream verify, etc), but this is a
# hard backstop: if anything downstream hangs (a wedged lock, a slow broker
# call), the HTTP request still returns within IMMEDIATE_TRADE_TIMEOUT_S
# instead of leaving the mobile client spinning forever.
IMMEDIATE_TRADE_TIMEOUT_S = 15.0
_trade_executor = concurrent.futures.ThreadPoolExecutor(
    max_workers=4, thread_name_prefix="immediate-trade",
)


def _submit_manual_trade_bounded(engine: ORBEngine, **kwargs) -> dict:
    """
    Run engine.submit_manual_trade(**kwargs) with a hard wall-clock timeout.
    On timeout, logs to both the server log and the engine's Supabase-backed
    debug log (so it's visible in the Debug tab) and returns an error payload
    instead of leaving the caller to hang indefinitely.
    """
    future = _trade_executor.submit(engine.submit_manual_trade, **kwargs)
    try:
        return future.result(timeout=IMMEDIATE_TRADE_TIMEOUT_S)
    except concurrent.futures.TimeoutError:
        msg = (f"Manual trade timed out after {IMMEDIATE_TRADE_TIMEOUT_S:.0f}s — "
               f"backend call did not return (possible stream/broker hang)")
        logger.error("[strategy] %s — ticker=%s", msg, getattr(engine, "ticker", "?"))
        try:
            engine.debug.emit("ERROR", msg)
        except Exception:
            pass
        return {"status": "error", "message": msg}

# Immediate-trade engines for ad-hoc, any-ticker conviction trades that aren't tied
# to a saved strategy. Keyed by "TICKER:paper|live"; created lazily on first trade.
# They never auto-trade (active=False, no trade_days) but DO manage exits + EOD close.
_immediate_engines: dict[str, ORBEngine] = {}

# Global debug switch. Stays ON until explicitly turned off; newly-created immediate
# engines inherit it so their decision logs show up in the Debug tab too.
_debug_all = False


def init_routes(engines: dict[str, ORBEngine], stream_manager=None):
    global _engines, _stream_manager, _debug_all
    _engines        = engines
    _stream_manager = stream_manager
    # Restore the global debug switch from persisted config so it stays ON across
    # restarts (and new immediate engines inherit it).
    _debug_all = any(e.config.get("debug_mode") for e in engines.values())


def _all_engines():
    """Every live engine — saved strategies + ad-hoc immediate-trade engines."""
    yield from _engines.items()
    for eng in _immediate_engines.values():
        yield getattr(eng, "strategy_id", None) or "immediate", eng


def _first_engine() -> ORBEngine | None:
    """Return the first engine, used by legacy single-engine endpoints."""
    return next(iter(_engines.values()), None)


def _immediate_key(ticker: str, paper_mode: bool) -> str:
    # Hyphen (not ':') so the synthetic engine id is clean in the live-WS URL path.
    return f"{ticker.upper()}-{'paper' if paper_mode else 'live'}"


def get_immediate_engine(strategy_id: str) -> ORBEngine | None:
    """Look up an immediate engine by its synthetic id (used by the live-P&L WS)."""
    for eng in _immediate_engines.values():
        if getattr(eng, "strategy_id", None) == strategy_id:
            return eng
    return None


def _resolve_any_engine(strategy_id: str) -> ORBEngine | None:
    """Find an engine by id across saved strategies AND immediate-trade engines."""
    return _engines.get(strategy_id) or get_immediate_engine(strategy_id)


def _sync_paired_strategy(sid: str, new_pair_id, old_pair_id) -> None:
    """
    Keep paired_strategy_id symmetric: if A.paired_strategy_id == B.id then
    B.paired_strategy_id must equal A.id (or both are None). Call this
    whenever sid's own pairing changes (create/update/delete) — it only
    touches the OTHER side(s) of the link, since sid's own row is saved by
    the caller. A stale partner pointer would make ORBEngine._find_ticker_conflict
    silently stop excluding a pair that still thinks it's linked.
    """
    new_pair_id = new_pair_id or None
    old_pair_id = old_pair_id or None
    if new_pair_id == old_pair_id:
        return

    def _set_pair(target_id: str, value):
        eng = _engines.get(target_id)
        if eng:
            eng.config["paired_strategy_id"] = value
            eng.reload_config(eng.config)
            logger_svc.save_strategy_config(eng.config)
        else:
            configs = logger_svc.load_configs()
            base = next((c for c in configs if c.get("id") == target_id), None)
            if base:
                base["paired_strategy_id"] = value
                logger_svc.save_strategy_config(base)

    # Unlink the old partner — it no longer points back to sid.
    if old_pair_id and old_pair_id != new_pair_id:
        _set_pair(old_pair_id, None)

    if new_pair_id:
        # Steal the new partner away from whatever it previously pointed at,
        # so the relationship stays strictly one-to-one.
        eng = _engines.get(new_pair_id)
        if eng:
            prev = eng.config.get("paired_strategy_id")
        else:
            configs = logger_svc.load_configs()
            base = next((c for c in configs if c.get("id") == new_pair_id), None)
            prev = base.get("paired_strategy_id") if base else None
        if prev and prev != sid:
            _set_pair(prev, None)
        _set_pair(new_pair_id, sid)


def _get_or_create_immediate_engine(ticker: str, paper_mode: bool) -> ORBEngine:
    """
    Return a free immediate engine for (ticker, paper/live) — reusing the base
    slot if it exists and its prior position has closed (trade_taken=False),
    otherwise spinning up an additional slot (base key + "-2", "-3", ...).

    Immediate trades must NEVER be blocked just because another one is
    already open on the same ticker+mode (2026-07-29 — a user hedging a live
    IWM call with a put got refused entirely, which defeats the entire point
    of an ad-hoc/manual trade: the user is deliberately overriding the
    system's usual same-ticket caution). One ORBEngine can only track a
    single open position at a time, so a genuinely concurrent second
    position (a hedge, or scaling into a second contract) needs its own
    engine instance rather than reusing a busy one.
    """
    base_key = _immediate_key(ticker, paper_mode)
    key = base_key
    suffix = 1
    while True:
        eng = _immediate_engines.get(key)
        if eng is None or not eng.trade_taken:
            break
        suffix += 1
        key = f"{base_key}-{suffix}"

    if eng is None:
        cfg = {
            **STRATEGY_DEFAULTS.copy(),
            "ticker":        ticker.upper(),
            "paper_mode":    paper_mode,
            "active":        False,            # never auto-trades
            "trade_days":    [],               # no ORB schedule
            "strategy_name": f"Immediate {ticker.upper()}",
            "id":            f"immediate-{key}",
            "debug_mode":    _debug_all,
        }
        eng = ORBEngine(cfg, stream_manager=_stream_manager)
        eng.debug_enabled = _debug_all         # inherit the global debug switch
        _immediate_engines[key] = eng
        schedule_eod_close(eng)                # EOD backstop so 0DTE positions flatten
        logger.info("[strategy] Created immediate engine %s", key)
    return eng


def recover_open_positions():
    """
    Scan for any position still open at the broker (orb_trades with no
    exit_time) and reattach exit management to it — called once at boot,
    after init_routes() so _engines/_stream_manager are ready.

    Before this existed, every ORBEngine/ExitManager was pure in-memory
    state with no way to reconstruct itself: a restart mid-position (a
    redeploy, a crash, anything) silently wiped out both the "is this
    position even displayed" state AND the "is anything watching this
    position's stop-loss" state, while the real position sat untouched at
    the broker. That's what happened on 2026-07-13 — an open IWM put with a
    stop that should have fired never got the chance to, because the engine
    managing it no longer existed after a restart, and had to be closed
    manually through Alpaca directly. See
    docs/incidents/2026-07-14-position-lost-on-restart.md. This function is
    the fix: nothing here is optional or best-effort — every open position
    found gets its exit management reattached before this function returns.

    IMPORTANT: every candidate row is cross-checked against Alpaca before
    recovery. A stale DB row (exit_time still NULL from a previous session
    that crashed, or an option that expired/closed outside the app) must NOT
    be recovered — doing so sets trade_taken=True for a dead contract, which
    simultaneously (a) prevents the engine from entering any new trade that
    day and (b) causes /strategy/positions to call get_open_position() for a
    contract that no longer exists, making every UI poll return active=False
    and the position invisible on every screen (Home, Live Positions, Strategy).
    """
    # Close expired-option rows first so they don't appear in get_open_trades()
    # and never trigger an unnecessary broker lookup below.
    try:
        logger_svc.reconcile_orphaned_trades()
    except Exception as e:
        logger.warning("[strategy] Position recovery: reconcile_orphaned_trades failed: %s", e)

    rows = logger_svc.get_open_trades()
    if not rows:
        logger.info("[strategy] Position recovery: no open positions found")
        return

    logger.warning("[strategy] Position recovery: %d open position(s) found — verifying with broker", len(rows))
    recovered = 0
    for row in rows:
        try:
            strategy_id = row.get("strategy_id")
            if strategy_id and strategy_id in _engines:
                engine = _engines[strategy_id]
            else:
                # No saved-strategy match (immediate/manual trade, or a
                # strategy that's since been deleted) — recover it into an
                # immediate engine keyed the same way a live one would be.
                engine = _get_or_create_immediate_engine(row["ticker"], bool(row["paper_mode"]))

            # Verify the position actually exists at Alpaca before touching
            # engine state. A stale row (crashed/missed exit, option closed at
            # the broker directly, or a prior-day row whose expiry isn't in the
            # past yet) must be reconciled (DB row closed), NOT recovered —
            # otherwise trade_taken=True is set for a dead contract, new
            # breakouts are silently blocked, and every /strategy/positions
            # poll returns active=False, making the position invisible on all
            # three UI screens (Home, Live Positions, Strategy).
            broker_result = _reconcile_trade_with_broker(row, engine)
            if broker_result["status"] != "still_open":
                logger.warning(
                    "[strategy] Position recovery: %s not found at broker "
                    "(status=%s) — stale DB row closed, skipping recovery",
                    row.get("contract_symbol"), broker_result["status"],
                )
                continue

            if engine.trade_taken:
                # Engine already has a live position recorded (e.g. it was
                # created moments ago by this same recovery pass for another
                # row, or somehow already re-entered) — never clobber it.
                logger.warning(
                    "[strategy] Position recovery: engine for %s already has an "
                    "active trade — skipping row %s to avoid overwriting live state",
                    row.get("ticker"), row.get("id"),
                )
                continue

            if engine.recover_position(
                row,
                broker_qty=broker_result.get("broker_qty"),
                broker_avg_entry_price=broker_result.get("broker_avg_entry_price"),
            ):
                recovered += 1
        except Exception as e:
            logger.error(
                "[strategy] Position recovery FAILED for %s %s (id=%s): %s — "
                "this position is still open at the broker but is NOT being "
                "monitored by this app. Check it manually.",
                row.get("ticker"), row.get("contract_symbol"), row.get("id"), e,
                exc_info=True,
            )

    logger.warning("[strategy] Position recovery complete: %d/%d reattached", recovered, len(rows))


def _reconcile_trade_with_broker(row: dict, engine: ORBEngine) -> dict:
    """
    Cross-reference one still-open orb_trades row against Alpaca's actual
    position state for the contract. Handles the case this app has no other
    way to detect: a position closed directly on Alpaca (bypassing this app
    entirely), which otherwise leaves the row stuck "open" forever with no
    exit data, and — worse — leaves engine.exit_manager still armed and
    evaluating stop/TP against live quotes for a position that no longer
    exists. See docs/incidents/2026-07-14-position-lost-on-restart.md; this
    closes the other half of that gap (broker-truth, not just restart-truth).
    """
    symbol = row.get("contract_symbol")
    try:
        position = engine.trading_client.get_open_position(symbol)
        # Return the broker's actual qty/avg-entry-price too — not just proof
        # the position exists. recover_position() uses these as ground truth
        # over the DB row, since qty_entered/entry_premium can silently drift
        # from what's really at the broker (e.g. an add_to_position() DB write
        # that failed after the order itself already filled).
        return {
            "contract_symbol":        symbol,
            "status":                 "still_open",
            "broker_qty":             float(position.qty),
            "broker_avg_entry_price": float(position.avg_entry_price),
        }
    except Exception:
        pass  # not found at the broker -> already closed there

    qty_remaining = max(int(row["qty_entered"]) - int(row.get("qty_exited") or 0), 0)
    if qty_remaining <= 0:
        # qty_exited already accounts for the full position (e.g. a partial-
        # exit write that landed twice, or a prior interrupted close) but
        # exit_time was never stamped — this row came from get_open_trades(),
        # i.e. exit_time IS NULL, so without this it stays "open" forever with
        # every future reconcile pass silently no-op'ing on it (nothing left
        # to exit, by qty). Stamp exit_time now so it stops appearing open;
        # don't touch pnl/qty_exited since they're already accounted for.
        try:
            logger_svc.client.table("orb_trades").update({
                "exit_time": datetime.utcnow().isoformat(),
                "exit_reason": row.get("exit_reason") or "RECONCILED — QTY ALREADY ZERO",
            }).eq("id", row["id"]).execute()
        except Exception as e:
            logger.error("[reconcile] failed to stamp exit_time for zero-qty row %s: %s",
                         row.get("id"), e)
        return {"contract_symbol": symbol, "status": "already_closed"}

    exit_price = None
    exit_reason = "UNKNOWN — RECONCILED FROM ALPACA"
    try:
        from alpaca.trading.requests import GetOrdersRequest
        from alpaca.trading.enums import QueryOrderStatus, OrderSide

        orders = engine.trading_client.get_orders(GetOrdersRequest(
            symbols=[symbol], status=QueryOrderStatus.CLOSED, side=OrderSide.SELL, limit=10,
        ))
        filled = [o for o in orders if getattr(o, "filled_avg_price", None) is not None]
        filled.sort(key=lambda o: o.filled_at or datetime.min, reverse=True)
        if filled:
            exit_price = float(filled[0].filled_avg_price)
            exit_reason = "RECONCILED FROM ALPACA"
    except Exception as e:
        logger.warning("[reconcile] order lookup failed for %s: %s", symbol, e)

    # No sell fill found. If the contract's expiry has passed, the broker
    # having no position AND no sell order overwhelmingly means it expired
    # worthless — record the real loss (exit_premium=0), not a fictitious
    # breakeven. Previously this always fell back to entry_premium (pnl=0)
    # regardless of expiry, which silently turned every unmonitored expired
    # contract into a fake $0 close (and hid it from win/loss stats, since
    # pnl=0 counts as neither). Only genuinely unexplained closures (not yet
    # expired, no fill found) still fall back to entry_premium — we don't
    # know what happened there, so we don't guess a loss that may not have
    # occurred. NOTE: doesn't cover ITM auto-exercise (Alpaca converts to a
    # stock position rather than the contract vanishing) — a real edge case
    # this heuristic can't distinguish from a plain worthless expiration.
    expiry = row.get("expiry")
    is_expired = bool(expiry) and expiry <= date.today().isoformat()
    if exit_price is None and is_expired:
        exit_price = 0.0
        exit_reason = "EXPIRED_WORTHLESS"
    exit_price_final = exit_price if exit_price is not None else row.get("entry_premium")

    exit_persisted = logger_svc.log_exit(
        symbol, exit_reason,
        exit_price_final,
        qty_remaining, row.get("profile"),
        strategy_id=row.get("strategy_id"), trading_client=engine.trading_client,
        trade_id=row.get("id"),
    )
    if not exit_persisted:
        logger.error(
            "[reconcile] log_exit did not persist for %s (id=%s) — this row will "
            "still show as open next time and re-trigger reconciliation",
            symbol, row.get("id"),
        )

    if engine.contract_symbol == symbol:
        try:
            engine.reset_session()
        except Exception:
            logger.warning("[reconcile] engine.reset_session() failed for %s", symbol, exc_info=True)

    return {
        "contract_symbol": symbol,
        "status": "reconciled" if exit_persisted else "reconcile_failed",
        "exit_reason": exit_reason,
        "exit_premium": exit_price,
    }


def _verify_closed_trade_with_broker(row: dict, engine: ORBEngine) -> dict:
    """
    Sanity-check a trade orb_trades already marked closed today: confirm the
    broker agrees nothing is open for that contract anymore. Unlike
    _reconcile_trade_with_broker, this never writes anything — a closed row's
    qty/pnl math can't be safely rewritten after the fact (e.g. a same-day
    re-entry into the same contract would make "is there an open position for
    this symbol" ambiguous as to which trade it belongs to). A mismatch here
    just means "look at this one manually," not "let me fix it for you."
    """
    symbol = row.get("contract_symbol")
    try:
        engine.trading_client.get_open_position(symbol)
        return {
            "contract_symbol": symbol,
            "status": "mismatch",
            "detail": "marked closed here but broker still shows an open position for this contract",
        }
    except Exception:
        return {"contract_symbol": symbol, "status": "verified_closed"}


def _resolve_engine_for_row(row: dict) -> ORBEngine:
    strategy_id = row.get("strategy_id")
    if strategy_id and strategy_id in _engines:
        return _engines[strategy_id]
    return _get_or_create_immediate_engine(row["ticker"], bool(row["paper_mode"]))


@strategy_bp.route("/trades/reconcile", methods=["POST"])
def reconcile_trades():
    """
    Pull-to-refresh reconciliation for the Trade Log screen.

    Two passes:
      1. Every orb_trades row still marked open gets cross-referenced against
         Alpaca's real position state and closed out here if the broker
         disagrees (_reconcile_trade_with_broker) — covers a position closed
         directly on Alpaca, bypassing this app entirely.
      2. Every OTHER trade from today (already marked closed) gets spot-
         checked the other direction: is the broker still showing an open
         position for it? That would mean this app's "closed" record is
         wrong. Read-only — flagged as a mismatch for manual review, never
         auto-modified (see _verify_closed_trade_with_broker for why).
    """
    open_rows = logger_svc.get_open_trades()
    todays_rows = logger_svc.get_trades(limit=500, trade_date=date.today().isoformat())
    open_ids = {r["id"] for r in open_rows}
    closed_today_rows = [r for r in todays_rows if r.get("exit_time") and r["id"] not in open_ids]

    results = []
    for row in open_rows:
        try:
            engine = _resolve_engine_for_row(row)
            results.append(_reconcile_trade_with_broker(row, engine))
        except Exception as e:
            logger.error(
                "[reconcile] failed for %s (id=%s): %s",
                row.get("contract_symbol"), row.get("id"), e, exc_info=True,
            )
            results.append({"contract_symbol": row.get("contract_symbol"), "status": "error", "error": str(e)})

    verify_results = []
    for row in closed_today_rows:
        try:
            engine = _resolve_engine_for_row(row)
            verify_results.append(_verify_closed_trade_with_broker(row, engine))
        except Exception as e:
            logger.error(
                "[reconcile] verify failed for %s (id=%s): %s",
                row.get("contract_symbol"), row.get("id"), e, exc_info=True,
            )
            verify_results.append({"contract_symbol": row.get("contract_symbol"), "status": "error", "error": str(e)})

    return jsonify({
        "success": True,
        "checked_open": len(open_rows),
        "checked_closed_today": len(closed_today_rows),
        "reconciled": [r for r in results if r["status"] == "reconciled"],
        "still_open": [r for r in results if r["status"] == "still_open"],
        "mismatches": [r for r in verify_results if r["status"] == "mismatch"],
        "errors": [r for r in results + verify_results if r["status"] == "error"],
    })


# ── Multi-strategy CRUD ────────────────────────────────────────────────────────

@strategy_bp.route("/configs", methods=["GET"])
def list_configs():
    """Return all strategy configs enriched with live position status."""
    result = []
    configs = logger_svc.load_configs()
    for cfg in configs:
        sid = cfg["id"]
        eng = _engines.get(sid)
        has_pos = bool(eng and eng.trade_taken and eng.contract_symbol)
        result.append({
            **cfg,
            "has_position":  has_pos,
            "qty_remaining": (eng.exit_manager.qty_remaining
                              if has_pos and eng and eng.exit_manager else None),
        })
    return jsonify(result)


@strategy_bp.route("/configs", methods=["POST"])
def create_config():
    """Create a new strategy and start its engine."""
    data = request.get_json() or {}
    config = {**STRATEGY_DEFAULTS.copy(), **{
        k: data[k] for k in (
            "ticker", "paper_mode", "active",
            "profile", "trade_days", "strategy_name", "capital_limit",
            "bypass_breakout_window", "custom_thresholds", "exit_overrides",
            "budget_otm_mode", "otm_fib_level", "debug_mode", "smart_contracts",
            "confirm_entry", "paired_strategy_id",
        ) if k in data
    }}
    config.pop("id", None)   # force new UUID

    saved = logger_svc.save_strategy_config(config)
    if not saved:
        return jsonify({"error": "Failed to save strategy"}), 500

    sid = saved["id"]
    saved_config = {**config, "id": sid}
    engine = ORBEngine(saved_config, stream_manager=_stream_manager)
    _engines[sid] = engine
    reschedule_jobs(engine, strategy_id=sid)
    _sync_paired_strategy(sid, saved_config.get("paired_strategy_id"), None)

    return jsonify(saved), 201


@strategy_bp.route("/configs/<strategy_id>", methods=["PATCH"])
def update_config(strategy_id: str):
    """Patch an existing strategy config and hot-reload its engine."""
    data = request.get_json() or {}

    # If the engine is missing (e.g. server just restarted), rebuild it from
    # Supabase so we can still apply the patch rather than failing with 404.
    if strategy_id not in _engines:
        configs = logger_svc.load_configs()
        base = next((c for c in configs if c.get("id") == strategy_id), None)
        if not base:
            return jsonify({"error": "Strategy not found"}), 404
        engine = ORBEngine(base, stream_manager=_stream_manager)
        _engines[strategy_id] = engine
        reschedule_jobs(engine, strategy_id=strategy_id)
        logger.info("[strategy] Rebuilt missing engine for %s during PATCH", strategy_id)

    engine = _engines[strategy_id]
    old_pair_id = engine.config.get("paired_strategy_id")
    allowed = {"ticker", "paper_mode", "active",
               "profile", "trade_days", "strategy_name", "capital_limit",
               "bypass_breakout_window", "custom_thresholds", "exit_overrides",
               "budget_otm_mode", "otm_fib_level", "debug_mode", "smart_contracts",
               "confirm_entry", "paired_strategy_id"}
    for key in allowed:
        if key in data:
            engine.config[key] = data[key]
    engine.config["id"] = strategy_id

    engine.reload_config(engine.config)
    reschedule_jobs(engine, strategy_id=strategy_id)

    saved = logger_svc.save_strategy_config(engine.config)
    if not saved:
        return jsonify({"error": "Config updated in memory but failed to persist to database"}), 500

    if "paired_strategy_id" in data:
        _sync_paired_strategy(strategy_id, engine.config.get("paired_strategy_id"), old_pair_id)

    return jsonify({"status": "ok", "config": engine.config})


@strategy_bp.route("/configs/<strategy_id>", methods=["DELETE"])
def delete_config(strategy_id: str):
    """Stop and remove a strategy."""
    engine = _engines.get(strategy_id)
    if engine and engine.trade_taken and engine.contract_symbol:
        # Refuse to delete until the open position is closed — prevents orphaned orders.
        # Sell only the qty this engine owns (not close_position which would wipe
        # sibling engines trading the same contract on the same account).
        try:
            from alpaca.trading.requests import MarketOrderRequest
            from alpaca.trading.enums import OrderSide, TimeInForce
            em  = engine.exit_manager
            qty = em.qty_remaining if em else 0
            if qty > 0:
                engine.trading_client.submit_order(MarketOrderRequest(
                    symbol=engine.contract_symbol,
                    qty=qty,
                    side=OrderSide.SELL,
                    time_in_force=TimeInForce.DAY,
                ))
        except Exception as e:
            return jsonify({
                "status": "error",
                "message": f"Cannot delete strategy with active position that failed to close: {e}",
            }), 409

    # Safe to remove now — position is closed (or never existed)
    _engines.pop(strategy_id, None)
    if engine:
        # Detach from the hub bar feed so no stale callback is retained.
        try:
            engine.unsubscribe_data()
        except Exception as e:
            logger.warning("[strategy] unsubscribe_data failed for %s: %s", strategy_id, e)
        from services.strategy.scheduler import get_scheduler
        sched = get_scheduler()
        if sched:
            for suffix in ("orb_calc", "price_poll", "eod_reset"):
                try:
                    sched.remove_job(f"job_{strategy_id}_{suffix}")
                except Exception:
                    pass

    old_pair_id = engine.config.get("paired_strategy_id") if engine else None
    if old_pair_id is None and engine is None:
        configs = logger_svc.load_configs()
        base = next((c for c in configs if c.get("id") == strategy_id), None)
        old_pair_id = base.get("paired_strategy_id") if base else None
    _sync_paired_strategy(strategy_id, None, old_pair_id)

    logger_svc.delete_strategy_config(strategy_id)
    return jsonify({"status": "ok"})


@strategy_bp.route("/configs/<strategy_id>/reset-session", methods=["POST"])
def reset_strategy_session(strategy_id: str):
    engine = _engines.get(strategy_id)
    if not engine:
        return jsonify({"error": "Strategy not found"}), 404
    engine.reset_session()
    return jsonify({"status": "ok"})


@strategy_bp.route("/configs/<strategy_id>/force-close", methods=["POST"])
def force_close_strategy(strategy_id: str):
    engine = _engines.get(strategy_id)
    if not engine:
        return jsonify({"error": "Strategy not found"}), 404
    if not engine.trade_taken or not engine.contract_symbol:
        return jsonify({"status": "ok", "message": "No active position"})
    try:
        from alpaca.trading.requests import MarketOrderRequest
        from alpaca.trading.enums import OrderSide, TimeInForce
        em  = engine.exit_manager
        qty = em.qty_remaining if em else 0
        engine.trading_client.submit_order(MarketOrderRequest(
            symbol=engine.contract_symbol,
            qty=qty,
            side=OrderSide.SELL,
            time_in_force=TimeInForce.DAY,
        ))
        exit_price  = engine._get_option_price()
        entry_p     = em.entry_premium if em else 0
        pnl         = ((exit_price or 0) - entry_p) * qty * 100
        engine.logger.log_exit(
            engine.contract_symbol, "MANUAL_CLOSE", exit_price,
            qty, engine.profile_key,
            strategy_id=engine.strategy_id,
            trading_client=engine.trading_client,
            trade_id=engine.active_trade_id,
        )
        engine.notifier.notify_exit(
            ticker=engine.ticker,
            contract_symbol=engine.contract_symbol,
            exit_reason="MANUAL_CLOSE",
            pnl=pnl,
            qty=qty,
            profile_key=engine.profile_key,
            exit_premium=exit_price,
            paper_mode=engine.paper,
        )
        engine.debug.emit("SUCCESS",
            f"Force-closed {engine.contract_symbol} qty={qty} "
            f"exit=${(exit_price or 0):.2f} pnl=${pnl:.2f}")
        engine.reset_session()
        return jsonify({"status": "ok"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@strategy_bp.route("/positions/<strategy_id>/sell", methods=["POST"])
def sell_position(strategy_id: str):
    """
    Manually sell contracts of an open position. Works for both saved strategies
    and ad-hoc immediate-trade engines (resolved by id). Body: {qty?, limit_price?}
    — omit qty to sell the entire remaining position; omit limit_price to let
    the engine seek a good price itself (sample the bid, try a limit order,
    fall back to market after ~10s — see ORBEngine._execute_priced_exit), or
    supply one to use that exact price instead.

    NOTE: this request can legitimately take up to ~10s to return — the
    gunicorn worker timeout (120s, see Procfile) and the mobile client both
    need to tolerate that; this isn't a hang.
    """
    engine = _resolve_any_engine(strategy_id)
    if not engine:
        return jsonify({"status": "error", "message": "Position not found"}), 404
    data = request.get_json() or {}
    qty = data.get("qty")
    limit_price = data.get("limit_price")
    try:
        limit_price = float(limit_price) if limit_price is not None else None
    except (TypeError, ValueError):
        return jsonify({"status": "error", "message": "limit_price must be a number"}), 400
    result = engine.submit_manual_exit(int(qty) if qty is not None else None, limit_price)
    code = 200 if result.get("status") == "ok" else 409
    return jsonify(result), code


@strategy_bp.route("/positions/<strategy_id>/add", methods=["POST"])
def add_to_position(strategy_id: str):
    """
    Buy more of the currently-open contract to average down/up. Works for both
    saved strategies and ad-hoc immediate-trade engines (resolved by id), live
    or paper. Body: {qty} — required, >= 1.
    """
    engine = _resolve_any_engine(strategy_id)
    if not engine:
        return jsonify({"status": "error", "message": "Position not found"}), 404
    data = request.get_json() or {}
    qty = data.get("qty")
    if qty is None:
        return jsonify({"status": "error", "message": "qty is required"}), 400
    try:
        qty = int(qty)
    except (TypeError, ValueError):
        return jsonify({"status": "error", "message": "qty must be an integer"}), 400
    result = engine.add_to_position(qty)
    code = 200 if result.get("status") == "ok" else 409
    return jsonify(result), code


@strategy_bp.route("/configs/<strategy_id>/exits", methods=["PATCH"])
def update_strategy_exits(strategy_id: str):
    """
    Update the live ExitManager's stop-loss and/or TP levels mid-trade.
    Body: { hard_stop?, tp1?, tp2?, sl_qty?, tp1_qty?, tp2_qty? } — all
    optional, only provided fields are changed. sl_qty/tp1_qty/tp2_qty are
    the "Advanced" per-level contract counts (see ExitManager.apply_overrides).
    Returns the updated exit state so the client can confirm the new levels.
    """
    engine = _resolve_any_engine(strategy_id)
    if not engine:
        return jsonify({"status": "error", "message": "Engine not found"}), 404
    em = engine.exit_manager
    if not em:
        return jsonify({"status": "error", "message": "No active position — nothing to update"}), 409

    data = request.get_json() or {}
    try:
        changed = em.apply_overrides(
            hard_stop=float(data["hard_stop"]) if "hard_stop" in data else None,
            tp1=float(data["tp1"]) if "tp1" in data else None,
            tp2=float(data["tp2"]) if "tp2" in data else None,
            sl_qty=int(data["sl_qty"]) if "sl_qty" in data else None,
            tp1_qty=int(data["tp1_qty"]) if "tp1_qty" in data else None,
            tp2_qty=int(data["tp2_qty"]) if "tp2_qty" in data else None,
        )
    except ValueError as e:
        return jsonify({"status": "error", "message": str(e)}), 400

    if not changed:
        return jsonify({"status": "noop", "message": "No fields provided"}), 400

    logger.info("[strategy] Updated exits for %s: %s", strategy_id, changed)
    return jsonify({
        "status": "ok",
        "updated": changed,
        "exit_state": em.to_dict(),
    })


@strategy_bp.route("/pending-confirmations", methods=["GET"])
def list_pending_confirmations():
    """All trade confirmations currently awaiting a user response, oldest first."""
    return jsonify(logger_svc.list_open_pending_confirmations())


@strategy_bp.route("/pending-confirmations/sweep", methods=["POST"])
def sweep_pending_confirmations():
    """
    Periodic cleanup — called every minute by a Supabase pg_cron job (see
    supabase/migrations/20260707_confirm_entry_sweep_cron.sql), same pattern as
    the daily-review/0DTE-scan jobs migrated off in-process APScheduler.

    Expires any pending confirmation whose expires_at has passed: first via
    each live in-memory engine (so its preview price stream is unsubscribed
    cleanly), then a DB-level bulk expiry as a safety net for confirmations
    left behind by an engine that no longer exists (e.g. after a redeploy).
    """
    engine_expired = 0
    for sid, eng in _all_engines():
        try:
            if eng.expire_pending_if_stale():
                engine_expired += 1
        except Exception as e:
            logger.error("[strategy] Confirmation sweep failed for %s: %s", sid, e)
    bulk_expired = logger_svc.expire_stale_pending_confirmations()
    return jsonify({"status": "ok", "engine_expired": engine_expired, "bulk_expired": bulk_expired})


@strategy_bp.route("/configs/<strategy_id>/pending/<pending_id>/approve", methods=["POST"])
def approve_pending_confirmation(strategy_id: str, pending_id: str):
    """Body: { hard_stop?, tp1?, tp2?, qty? } — optional user-edited overrides."""
    engine = _resolve_any_engine(strategy_id)
    if not engine:
        # No live engine to ask (e.g. the strategy was deleted after the
        # confirmation was created) — resolve the row directly so it doesn't
        # sit as PENDING until the periodic sweep's 5-minute TTL catches it.
        logger_svc.update_pending_confirmation(pending_id, {
            "status": "EXPIRED", "resolved_at": datetime.utcnow().isoformat(),
        })
        return jsonify({"status": "error", "message": "Engine not found"}), 404

    data = request.get_json() or {}
    overrides = {
        key: float(data[key]) for key in ("hard_stop", "tp1", "tp2")
        if data.get(key) is not None
    }
    if data.get("qty") is not None:
        overrides["qty"] = int(data["qty"])
    try:
        result = engine.approve_pending_entry(pending_id, overrides or None)
    except Exception as e:
        logger.error("[strategy] approve_pending_entry failed for %s/%s: %s", strategy_id, pending_id, e)
        return jsonify({"status": "error", "message": f"Order submission failed: {e}"}), 500
    code = 200 if result.get("status") == "ok" else 400
    return jsonify(result), code


@strategy_bp.route("/configs/<strategy_id>/pending/<pending_id>/skip", methods=["POST"])
def skip_pending_confirmation(strategy_id: str, pending_id: str):
    engine = _resolve_any_engine(strategy_id)
    if not engine:
        # Same rationale as approve above — the user's intent was explicitly
        # to skip, so resolve as SKIPPED rather than waiting on the sweep.
        logger_svc.update_pending_confirmation(pending_id, {
            "status": "SKIPPED", "resolved_at": datetime.utcnow().isoformat(),
        })
        return jsonify({"status": "error", "message": "Engine not found"}), 404

    result = engine.skip_pending_entry(pending_id)
    code = 200 if result.get("status") == "ok" else 400
    return jsonify(result), code


@strategy_bp.route("/configs/<strategy_id>/position", methods=["GET"])
def get_strategy_position(strategy_id: str):
    engine = _engines.get(strategy_id)
    if not engine:
        return jsonify({"error": "Strategy not found"}), 404
    return _engine_position_response(engine)


@strategy_bp.route("/debug", methods=["GET"])
def debug_all_engines():
    """Full session state for every engine — use to diagnose silent entry failures."""
    return jsonify({sid: eng.session_state() for sid, eng in _engines.items()})


@strategy_bp.route("/configs/<strategy_id>/debug", methods=["GET"])
def debug_engine(strategy_id: str):
    engine = _engines.get(strategy_id)
    if not engine:
        return jsonify({"error": "Strategy not found"}), 404
    return jsonify(engine.session_state())


# ── Debug logs (frontend Debug tab) ─────────────────────────────────────────────

@strategy_bp.route("/debug-logs", methods=["GET"])
def get_debug_logs():
    """
    Return persisted ORB engine debug logs from Supabase (service-role key bypasses
    RLS so the frontend receives rows regardless of auth state). Falls back to the
    in-memory buffers if the DB read fails, to handle startup before the first write.
    """
    limit = min(int(request.args.get("limit", 500)), 1000)
    rows: list = []
    try:
        # Order DESC + limit to get the MOST RECENT rows (the table accumulates
        # indefinitely — an ASC order here would return the oldest N rows ever
        # written and today's logs would never surface once the table grew past
        # `limit`). Reverse after fetching so the response stays oldest-first.
        res = logger_svc.client.table("orb_debug_logs") \
            .select("id,ts,level,message,data,strategy_id,ticker,strategy_name") \
            .order("ts", desc=True) \
            .limit(limit) \
            .execute()
        rows = list(reversed(res.data or []))
    except Exception as e:
        logger.warning("[strategy] debug-logs DB read failed — falling back to memory: %s", e)
        for sid, engine in _all_engines():
            buf = getattr(engine, "debug", None)
            if not buf:
                continue
            for rec in buf.snapshot(since_id=0):
                rows.append({
                    **rec,
                    "strategy_id":   sid,
                    "ticker":        getattr(engine, "ticker", ""),
                    "strategy_name": getattr(engine, "strategy_name", ""),
                })
        rows.sort(key=lambda r: r["ts"])
        rows = rows[-limit:]

    any_debug_on = _debug_all or any(
        getattr(eng, "debug_enabled", False) for _, eng in _all_engines()
    )
    return jsonify({"debug_enabled": any_debug_on, "logs": rows})


@strategy_bp.route("/debug-logs/clear", methods=["POST"])
def clear_debug_logs():
    """Clear every engine's in-memory buffer AND purge the persisted Supabase log."""
    for _sid, engine in _all_engines():
        buf = getattr(engine, "debug", None)
        if buf:
            buf.clear()
    try:
        logger_svc.client.table("orb_debug_logs").delete().neq("id", -1).execute()
    except Exception as e:
        logger.warning("[strategy] failed to purge orb_debug_logs: %s", e)
    return jsonify({"status": "ok"})


@strategy_bp.route("/debug-mode", methods=["POST"])
def set_debug_mode():
    """
    Global debug switch. Turns engine decision-logging ON/OFF for EVERY engine
    (saved strategies + ad-hoc immediate engines) and keeps it that way — new
    immediate engines inherit the flag. Persists debug_mode on saved configs so it
    survives a restart. Body: {enabled: bool}.
    """
    global _debug_all
    data = request.get_json() or {}
    enabled = bool(data.get("enabled", True))
    _debug_all = enabled

    for _sid, engine in _all_engines():
        engine.debug_enabled = enabled
        engine.config["debug_mode"] = enabled

    # Persist on saved strategies only (immediate engines have no DB row).
    for sid in _engines:
        try:
            logger_svc.save_strategy_config(_engines[sid].config)
        except Exception as e:
            logger.warning("[strategy] debug-mode persist failed for %s: %s", sid, e)

    logger.info("[strategy] Debug mode set to %s for all engines", enabled)
    return jsonify({"status": "ok", "debug_enabled": enabled})


# ── Immediate / conviction trade ────────────────────────────────────────────────

@strategy_bp.route("/configs/<strategy_id>/immediate-trade", methods=["POST"])
def immediate_trade(strategy_id: str):
    """
    Submit a manual conviction trade for a user-chosen 0DTE contract, skipping the
    breakout wait / sentiment filters. Body:
      {direction: "CALL"|"PUT", contract_symbol, qty?, profile?}
    """
    engine = _engines.get(strategy_id)
    if not engine:
        return jsonify({"error": "Strategy not found"}), 404
    data = request.get_json() or {}
    contract_symbol = data.get("contract_symbol")
    direction = data.get("direction")
    if not contract_symbol or not direction:
        return jsonify({"status": "error",
                        "message": "direction and contract_symbol are required"}), 400

    exit_overrides_cfg = {}
    if "max_loss_pct" in data:
        val = float(data["max_loss_pct"])
        if 0.05 <= val <= 0.95:
            exit_overrides_cfg["max_loss_pct"] = val

    result = _submit_manual_trade_bounded(
        engine,
        direction=direction,
        contract_symbol=contract_symbol,
        qty=data.get("qty"),
        profile_key=data.get("profile"),
        exit_overrides=exit_overrides_cfg if exit_overrides_cfg else None,
    )
    code = 200 if result.get("status") == "ok" else 409
    return jsonify(result), code


@strategy_bp.route("/immediate-trade", methods=["POST"])
def immediate_trade_by_ticker():
    """
    Submit an immediate / conviction trade for ANY ticker, independent of a saved
    strategy. A dedicated immediate engine for (ticker, paper/live) is created on
    demand and manages the exits (TP/SL/EOD). Body:
      {ticker, direction: "CALL"|"PUT", contract_symbol, qty?, profile?, paper_mode?}
    """
    data            = request.get_json() or {}
    ticker          = (data.get("ticker") or "").upper()
    contract_symbol = data.get("contract_symbol")
    direction       = data.get("direction")
    paper_mode      = bool(data.get("paper_mode", True))
    if not ticker or not contract_symbol or not direction:
        return jsonify({"status": "error",
                        "message": "ticker, direction and contract_symbol are required"}), 400

    profile_key = data.get("profile")
    is_no_stop_loss = (profile_key or "").upper() == "NO_STOP_LOSS"

    exit_overrides = {}
    # NO_STOP_LOSS means NO automatic exit of any kind — volume exit and
    # max_loss_pct overrides are intentionally ignored for it rather than
    # merged in, so a client can't accidentally (or a stale UI can't) partially
    # re-enable an automatic close on a position the user explicitly chose to
    # hold with zero automatic exits.
    if not is_no_stop_loss:
        if "volume_exit" in data:
            exit_overrides["volume_exit"] = bool(data["volume_exit"])
        if "max_loss_pct" in data:
            val = float(data["max_loss_pct"])
            if 0.05 <= val <= 0.95:   # sanity clamp: 5%–95%
                exit_overrides["max_loss_pct"] = val

    engine = _get_or_create_immediate_engine(ticker, paper_mode)
    result = _submit_manual_trade_bounded(
        engine,
        direction=direction,
        contract_symbol=contract_symbol,
        qty=data.get("qty"),
        profile_key=data.get("profile"),
        exit_overrides=exit_overrides or None,
    )
    # Surface the engine id so the client can stream live P&L over the WS.
    result["strategy_id"] = engine.strategy_id
    code = 200 if result.get("status") == "ok" else 409
    return jsonify(result), code


@strategy_bp.route("/immediate-positions", methods=["GET"])
def immediate_positions():
    """
    Open positions across all immediate-trade engines, for the "Immediate Trades"
    section AND the Live Positions tab (which merges this with /positions so
    ad-hoc trades are editable/exitable there too — see position.tsx).

    Reuses _engine_position_response() — the same builder /positions uses — so
    the shape (hard_stop, tp1, tp2, active, qty_total, fib_levels, ...) matches
    saved-strategy positions exactly; EditExitsButton/ExitTradeModal need those
    fields and previously only got them for saved strategies. pnl/pnl_pct/
    mid_price are also kept as aliases of unrealized_pnl/unrealized_pnl_pct/
    current_price for the existing "Immediate Trades" dashboard card, which
    reads the old field names.
    """
    out = []
    for eng in _immediate_engines.values():
        if not eng.trade_taken or not eng.contract_symbol:
            continue
        try:
            pos = _engine_position_response(eng).get_json()
        except Exception:
            continue
        pos["strategy_id"]   = eng.strategy_id
        pos["strategy_name"] = getattr(eng, "strategy_name", "")
        pos["pnl"]           = pos.get("unrealized_pnl")
        pos["pnl_pct"]       = pos.get("unrealized_pnl_pct")
        pos["mid_price"]     = pos.get("current_price")
        out.append(pos)
    return jsonify({"positions": out})


# ── All positions ─────────────────────────────────────────────────────────────

@strategy_bp.route("/positions", methods=["GET"])
def get_all_positions():
    """Return position data for every running engine."""
    result = []
    for sid, engine in _engines.items():
        try:
            pos = _engine_position_response(engine).get_json()
            pos["strategy_id"] = sid
            pos["strategy_name"] = getattr(engine, "strategy_name", "")
            result.append(pos)
        except Exception:
            pass
    return jsonify(result)


# ── Profiles ───────────────────────────────────────────────────────────────────

@strategy_bp.route("/profiles", methods=["GET"])
def get_profiles():
    from services.strategy.profiles import CUSTOM_DEFAULTS, PROFILES
    profiles = []
    for k in PROFILES.keys():
        desc = describe_profile(k)
        desc["entry_mode"] = PROFILES[k].get("entry_mode", "BREAK")
        profiles.append(desc)
    profiles.append({
        "key": "CUSTOM",
        "display_name": "Custom",
        "emoji": "⚙️",
        "contracts": CUSTOM_DEFAULTS["qty_contracts"],
        "max_loss_pct": int(CUSTOM_DEFAULTS["max_loss_pct"] * 100),
        "tp1_pct": int((CUSTOM_DEFAULTS["tp1_mult"] - 1) * 100),
        "tp2_pct": int((CUSTOM_DEFAULTS["tp2_mult"] - 1) * 100),
        "runner": CUSTOM_DEFAULTS["tp2_close_pct"] < 1.0,
        "risk_level": "Custom",
        "vix_max": CUSTOM_DEFAULTS["vix_max_override"],
        "breakout_limit_min": CUSTOM_DEFAULTS["breakout_time_limit_min"],
        "thresholds": CUSTOM_DEFAULTS,
        "entry_mode": "BREAK",
    })
    return jsonify(profiles)


@strategy_bp.route("/profiles/<profile_key>", methods=["GET"])
def get_profile_detail(profile_key: str):
    key = profile_key.upper()
    if key not in PROFILES:
        return jsonify({"error": "Unknown profile"}), 404
    return jsonify(describe_profile(key))


# ── Account ────────────────────────────────────────────────────────────────────

@strategy_bp.route("/account", methods=["GET"])
def get_account():
    engine = _first_engine()
    if not engine:
        return jsonify({"success": False, "error": "No strategy configured"}), 404
    info = engine.get_account_info()
    if info:
        return jsonify({"success": True, "data": info})
    return jsonify({"success": False, "error": "Could not fetch account data"}), 502


@strategy_bp.route("/accounts/both", methods=["GET"])
def get_both_accounts():
    """Returns paper and live Alpaca account data in a single call."""
    import os
    from alpaca.trading.client import TradingClient

    def _fetch(paper: bool) -> dict | None:
        try:
            key    = os.getenv("ALPACA_PAPER_API_KEY" if paper else "ALPACA_LIVE_API_KEY")
            secret = os.getenv("ALPACA_PAPER_SECRET_KEY" if paper else "ALPACA_LIVE_SECRET_KEY")
            client = TradingClient(key, secret, paper=paper)
            acct = client.get_account()
            equity      = float(acct.equity)
            last_equity = float(acct.last_equity)
            pnl_today   = equity - last_equity
            return {
                "equity":                equity,
                # Exposed so the client can recompute today's P&L against a
                # live-derived equity (cash + streamed position market value)
                # instead of only this endpoint's own slower equity figure.
                "last_equity":           last_equity,
                "cash":                  float(acct.cash),
                "buying_power":          float(acct.buying_power),
                # Optional[int] on Alpaca's model — coerced to 0 rather than
                # left None, which the mobile Live Positions screen used to
                # render as the literal string "null" (position.tsx wasn't
                # guarding it the way this endpoint's other consumer does).
                "day_trade_count":       acct.daytrade_count or 0,
                "pnl_today":             round(pnl_today, 2),
                "pnl_today_pct":         round(pnl_today / last_equity * 100, 3) if last_equity > 0 else 0,
                # "Available balance" — the account's actual unlevered spending
                # power, distinct from buying_power (which reflects margin).
                "available_balance":     float(acct.non_marginable_buying_power or 0),
                "options_buying_power":  float(acct.options_buying_power or 0),
                "long_market_value":     float(acct.long_market_value or 0),
                "short_market_value":    float(acct.short_market_value or 0),
                "paper_mode":      paper,
                "available":       True,
            }
        except Exception as e:
            return {"available": False, "paper_mode": paper, "error": str(e)}

    engine    = _first_engine()
    paper_mode = engine.paper if engine else True
    return jsonify({
        "success":     True,
        "active_mode": paper_mode,
        "paper":       _fetch(True),
        "live":        _fetch(False),
    })


@strategy_bp.route("/accounts/transfers", methods=["GET"])
def get_account_transfers():
    """
    Real ACH transfer history (deposits/withdrawals) for the live account.

    Alpaca paper accounts start with a fixed virtual balance and don't take
    real ACH transfers, so this is live-only — a "Paper transfers" section
    would always be empty and just be noise.

    The retail TradingClient has no typed get_account_activities()/
    get_transfers() method (that only exists on the separate Broker API,
    alpaca.broker.client, which this app doesn't use) — TradingClient extends
    RESTClient, which does expose a generic authenticated .get(path, data),
    so the retail Activities endpoint is reached directly through that.
    """
    import os
    from alpaca.trading.client import TradingClient

    try:
        key    = os.getenv("ALPACA_LIVE_API_KEY")
        secret = os.getenv("ALPACA_LIVE_SECRET_KEY")
        client = TradingClient(key, secret, paper=False)

        raw = client.get("/account/activities", {"activity_types": "CSD,CSW"})
        transfers = []
        for item in raw or []:
            net_amount = float(item.get("net_amount", 0) or 0)
            transfers.append({
                "id":          item.get("id"),
                "date":        item.get("date"),
                "amount":      net_amount,
                "direction":   "deposit" if net_amount >= 0 else "withdrawal",
                "status":      item.get("status"),
                "description": item.get("description", ""),
            })
        transfers.sort(key=lambda t: t["date"] or "", reverse=True)
        return jsonify({"success": True, "transfers": transfers})
    except Exception as e:
        logger.error("[strategy] get_account_transfers failed: %s", e, exc_info=True)
        return jsonify({"success": False, "error": str(e), "transfers": []}), 502


@strategy_bp.route("/accounts/history", methods=["GET"])
def get_accounts_history():
    """
    Return period P&L (today / week / month / YTD / all-time) plus deposit
    tracking for paper and live accounts.

    Correctness notes (fixed 2026-07-12 — this endpoint previously crashed on
    every call and silently degraded to "no data"):
      - `client.get_portfolio_history(...)` takes its request object
        POSITIONALLY. The old code passed `filter=None`, a kwarg that doesn't
        exist on this method — every call raised, was swallowed by a bare
        `except Exception`, and week/month always came back None (hence
        "This Week" spinning forever in the app — the query had already
        resolved to `available: True` with no data, not an actual loading state).
      - Week/month used to be computed from raw EQUITY deltas, which counts
        deposits as if they were trading profit. Alpaca's `profit_loss` array
        already excludes cashflow (deposits/withdrawals) — using it instead is
        what actually answers "what did my trades do", not "what did my
        balance do" (a $100 deposit is not $100 of P&L).
    """
    import os
    from datetime import date as _date
    from alpaca.trading.client import TradingClient
    from alpaca.trading.requests import GetPortfolioHistoryRequest

    def _nearest_index_on_or_before(timestamps: list, target_ts: float) -> int:
        """Index of the latest daily bar at/before target_ts, clamped to [0, len-1]."""
        idx = 0
        for i, ts in enumerate(timestamps):
            if ts <= target_ts:
                idx = i
            else:
                break
        return idx

    def _fetch_deposits_withdrawn(client) -> tuple[float, float]:
        """
        Total deposited/withdrawn via the same direct Activities endpoint
        /accounts/transfers uses (client.get("/account/activities", ...)),
        rather than get_portfolio_history's `cashflow` sub-object below.

        That sub-object requires cashflow_types to exactly match Alpaca's
        expected format and only reports cashflow that falls inside the
        returned daily-bar timestamp range — for at least one real account
        this came back empty (0 deposited) despite $500+ in confirmed CSD
        activity, silently breaking both the All-Time P&L % and the app's
        "Overall P&L vs. net deposits" figure (position.tsx). The Activities
        endpoint is what actually lists each settled transfer directly, so
        summing it here can't miss what /accounts/transfers already shows.
        """
        try:
            raw = client.get("/account/activities", {"activity_types": "CSD,CSW"})
        except Exception as e:
            logger.warning("[strategy] deposit/withdrawal activities fetch failed: %s", e)
            return 0.0, 0.0
        deposited = withdrawn = 0.0
        for item in raw or []:
            net_amount = float(item.get("net_amount", 0) or 0)
            if net_amount >= 0:
                deposited += net_amount
            else:
                withdrawn += abs(net_amount)
        return deposited, withdrawn

    def _fetch_with_history(paper: bool) -> dict:
        try:
            key    = os.getenv("ALPACA_PAPER_API_KEY" if paper else "ALPACA_LIVE_API_KEY")
            secret = os.getenv("ALPACA_PAPER_SECRET_KEY" if paper else "ALPACA_LIVE_SECRET_KEY")
            client = TradingClient(key, secret, paper=paper)

            acct        = client.get_account()
            equity      = float(acct.equity)
            last_equity = float(acct.last_equity)
            pnl_today   = equity - last_equity
            pnl_today_pct = (pnl_today / last_equity * 100) if last_equity > 0 else 0

            # One daily-granularity fetch spanning the account's full life —
            # every other period (week/month/YTD/all-time) is a slice of it,
            # so this is the only history call we need to make.
            pnl_week = pnl_week_pct = None
            pnl_month = pnl_month_pct = None
            pnl_ytd = pnl_ytd_pct = None
            pnl_all_time = pnl_all_time_pct = None

            # Deposits/withdrawals via the direct Activities endpoint — see
            # _fetch_deposits_withdrawn's docstring for why this replaced
            # get_portfolio_history's cashflow sub-object.
            total_deposited, total_withdrawn = _fetch_deposits_withdrawn(client)

            try:
                hist = client.get_portfolio_history(
                    GetPortfolioHistoryRequest(period="all", timeframe="1D")
                )
                timestamps = list(hist.timestamp or [])
                equities   = [float(e) if e is not None else None for e in (hist.equity or [])]
                pls        = [float(p) if p is not None else None for p in (hist.profit_loss or [])]

                if timestamps and pls:
                    now_ts = timestamps[-1]
                    latest_pl = next((p for p in reversed(pls) if p is not None), None)

                    def _period_pnl(days_ago: int | None, boundary_ts: float | None = None):
                        if latest_pl is None:
                            return None, None
                        target = boundary_ts if boundary_ts is not None else now_ts - days_ago * 86400
                        idx = _nearest_index_on_or_before(timestamps, target)
                        base_pl     = pls[idx]
                        base_equity = equities[idx]
                        if base_pl is None or base_equity is None or base_equity <= 0:
                            return None, None
                        delta = round(latest_pl - base_pl, 2)
                        pct   = round(delta / base_equity * 100, 3)
                        return delta, pct

                    pnl_week,  pnl_week_pct  = _period_pnl(7)
                    pnl_month, pnl_month_pct = _period_pnl(30)

                    jan1 = _date(_date.today().year, 1, 1)
                    jan1_ts = __import__("time").mktime(jan1.timetuple())
                    pnl_ytd, pnl_ytd_pct = _period_pnl(None, boundary_ts=jan1_ts)

                    # All-time: delta from the very first recorded day (index 0)
                    # — this is "P&L since the account started", excluding every
                    # deposit/withdrawal along the way.
                    if pls[0] is not None and equities[0] and equities[0] > 0:
                        pnl_all_time = round(latest_pl - pls[0], 2)
                    # % on total capital actually contributed, not on a fluctuating
                    # equity base — matches how a user thinks about "my return":
                    # gained/lost X% of the money I actually put in.
                    if pnl_all_time is not None and total_deposited > 0:
                        pnl_all_time_pct = round(pnl_all_time / total_deposited * 100, 3)
            except Exception as hist_err:
                logger.warning("[strategy] Portfolio history fetch failed (paper=%s): %s", paper, hist_err)

            return {
                "available":         True,
                "equity":            equity,
                "pnl_today":         round(pnl_today, 2),
                "pnl_today_pct":     round(pnl_today_pct, 3),
                "pnl_week":          pnl_week,
                "pnl_week_pct":      pnl_week_pct,
                "pnl_month":         pnl_month,
                "pnl_month_pct":     pnl_month_pct,
                "pnl_ytd":           pnl_ytd,
                "pnl_ytd_pct":       pnl_ytd_pct,
                "pnl_all_time":      pnl_all_time,
                "pnl_all_time_pct":  pnl_all_time_pct,
                "total_deposited":   round(total_deposited, 2),
                "total_withdrawn":   round(total_withdrawn, 2),
                "net_contributions": round(total_deposited - total_withdrawn, 2),
                "paper_mode":        paper,
            }
        except Exception as e:
            return {"available": False, "paper_mode": paper, "error": str(e)}

    return jsonify({
        "success": True,
        "paper":   _fetch_with_history(True),
        "live":    _fetch_with_history(False),
    })


@strategy_bp.route("/accounts/positions", methods=["GET"])
def get_alpaca_positions():
    """
    Fast endpoint: open position market values for paper and/or live.

    Called every 5 s by the mobile app when positions are active so the UI
    can derive a live equity without waiting for the slower /accounts/both poll.

      displayEquity = cash + sum(position.market_value)

    cash is stable mid-trade; position.market_value ticks with options quotes.
    ?mode=paper | live | both  (default: both)
    """
    import os
    from alpaca.trading.client import TradingClient

    mode = request.args.get("mode", "both")

    def _fetch(paper: bool) -> dict:
        try:
            key    = os.getenv("ALPACA_PAPER_API_KEY" if paper else "ALPACA_LIVE_API_KEY")
            secret = os.getenv("ALPACA_PAPER_SECRET_KEY" if paper else "ALPACA_LIVE_SECRET_KEY")
            client = TradingClient(key, secret, paper=paper)
            raw    = client.get_all_positions()
            positions = [
                {
                    "symbol":           str(p.symbol),
                    "qty":              float(p.qty or 0),
                    "side":             str(p.side),
                    "market_value":     float(p.market_value or 0),
                    "unrealized_pl":    float(p.unrealized_pl or 0),
                    "unrealized_plpc":  float(p.unrealized_plpc or 0),
                    "current_price":    float(p.current_price or 0),
                    "avg_entry_price":  float(p.avg_entry_price or 0),
                }
                for p in raw
            ]
            return {
                "available":           True,
                "positions":           positions,
                "total_market_value":  sum(p["market_value"]   for p in positions),
                "total_unrealized_pl": sum(p["unrealized_pl"]  for p in positions),
            }
        except Exception as e:
            logger.warning("[accounts/positions] paper=%s %s", paper, e)
            return {"available": False, "positions": [], "total_market_value": 0, "total_unrealized_pl": 0, "error": str(e)}

    result: dict = {"success": True}
    if mode in ("paper", "both"):
        result["paper"] = _fetch(True)
    if mode in ("live", "both"):
        result["live"] = _fetch(False)
    return jsonify(result)


# ── Trade history / Stats ──────────────────────────────────────────────────────

@strategy_bp.route("/data/reset", methods=["POST"])
def reset_strategy_data():
    """
    Danger-zone: delete all rows from orb_trades, orb_session,
    performance_reviews, and orb_pending_confirmations so the user can start
    fresh and re-rate the system from a clean slate. Optionally also wipes
    orb_debug_logs when clear_debug_logs=true is passed in the JSON body.

    performance_reviews and orb_pending_confirmations are cleared
    unconditionally (not gated behind a flag) — both are entirely derived
    from trades that no longer exist after this call, so leaving them behind
    would show stale AI reviews / confirmation prompts referencing deleted
    history, which defeats the point of a "clean slate."

    Also resets every currently-loaded engine's in-memory session state
    (_session_halted, _session_realized_pnl, re-entry cooldowns, etc. — see
    ORBEngine.reset_session). Without this, an engine that halted on
    daily_loss_limit or is sitting in a post-loss cooldown earlier today would
    keep enforcing that against trades that no longer exist in the DB until
    the next 9:35 ET calculate_orb or a server restart — the DB would say
    "clean slate" while the live engine still didn't believe it.

    Intended for development / paper-trading only.  The route does not require
    a confirmation token beyond the explicit POST — the frontend handles the
    two-step confirm UI.
    """
    body = request.get_json(silent=True) or {}
    clear_debug = bool(body.get("clear_debug_logs", False))
    try:
        client = logger_svc.client
        # .not_.is_("id", "null") matches every row regardless of whether id is
        # UUID or integer — avoids the cast error from a hardcoded UUID sentinel.
        client.table("orb_trades").delete().not_.is_("id", "null").execute()
        client.table("orb_session").delete().not_.is_("id", "null").execute()
        # performance_reviews has no guaranteed "id" column usage elsewhere in
        # this codebase (upserts key on review_date+paper_mode) — filter on
        # review_date instead, which is always populated and part of that
        # composite key, so this can't silently no-op on a schema mismatch.
        client.table("performance_reviews").delete().not_.is_("review_date", "null").execute()
        client.table("orb_pending_confirmations").delete().not_.is_("id", "null").execute()
        cleared = ["orb_trades", "orb_session", "performance_reviews", "orb_pending_confirmations"]
        if clear_debug:
            client.table("orb_debug_logs").delete().not_.is_("id", "null").execute()
            cleared.append("orb_debug_logs")

        # Reset every live engine's session state so halts/cooldowns/realized
        # P&L don't keep enforcing against trades that no longer exist.
        # Skip any engine that currently holds an OPEN position — resetting
        # it would wipe its self.exit_manager/self.trade_taken and silently
        # orphan a real broker position with no more SL/TP monitoring. That
        # position's own orb_trades row was just deleted above too, so its
        # eventual exit won't have a row left to log against; this is
        # surfaced to the caller via open_position_engines rather than
        # silently swallowed, since it's the one real risk of resetting
        # while something is still open.
        reset_count = 0
        open_position_skips = []
        for eng in list(_engines.values()) + list(_immediate_engines.values()):
            if getattr(eng, "trade_taken", False):
                open_position_skips.append(f"{eng.ticker} {getattr(eng, 'contract_symbol', '?')}")
                continue
            try:
                eng.reset_session()
                reset_count += 1
            except Exception as e:
                logger.warning("[strategy] reset_session failed for %s during data/reset: %s",
                               getattr(eng, "strategy_id", "?"), e)

        logger.warning(
            "[strategy] Trade data reset performed — %s cleared, %d live engine(s) session-reset, "
            "%d skipped (open position)",
            ", ".join(cleared), reset_count, len(open_position_skips),
        )
        warning = (
            f" WARNING: {len(open_position_skips)} engine(s) have an open position "
            f"({', '.join(open_position_skips)}) — left running as-is, but its trade "
            f"history was just deleted, so its eventual exit won't be logged."
            if open_position_skips else ""
        )
        return jsonify({
            "status":  "ok",
            "message": f"Trade data cleared ({', '.join(cleared)}). "
                       f"{reset_count} live engine(s) session-reset.{warning}",
            "cleared": cleared,
            "engines_reset": reset_count,
            "open_position_skips": open_position_skips,
        })
    except Exception as e:
        logger.error("[strategy] data/reset failed: %s", e)
        return jsonify({"status": "error", "message": str(e)}), 500


@strategy_bp.route("/trades", methods=["GET"])
def get_trade_history():
    limit   = request.args.get("limit", 20, type=int)
    ticker     = request.args.get("ticker", None)
    profile    = request.args.get("profile", None)
    trade_date = request.args.get("trade_date", None)
    trades = logger_svc.get_trades(limit=limit, ticker=ticker, profile=profile,
                                    trade_date=trade_date)
    trades = enrich_open_trades_with_live_pnl(trades)
    return jsonify(trades)


@strategy_bp.route("/skipped-sessions", methods=["GET"])
def get_skipped_sessions():
    """Return sessions where trade_taken=false (strategy chose not to trade), newest first."""
    limit = request.args.get("limit", 50, type=int)
    try:
        res = (
            logger_svc.client.table("orb_session")
            .select("session_date,ticker,profile,skip_reason,strategy_id")
            .eq("trade_taken", False)
            .not_.is_("skip_reason", "null")
            .order("session_date", desc=True)
            .limit(limit)
            .execute()
        )
        return jsonify(res.data or [])
    except Exception as e:
        logger.error("[strategy] skipped-sessions failed: %s", e)
        return jsonify([])


@strategy_bp.route("/stats", methods=["GET"])
def get_stats():
    profile = request.args.get("profile", None)
    return jsonify(logger_svc.get_stats(profile=profile))


@strategy_bp.route("/stats/by-profile", methods=["GET"])
def get_stats_by_profile():
    return jsonify(logger_svc.get_stats_by_profile())


@strategy_bp.route("/performance", methods=["GET"])
def get_performance():
    """
    Returns a 0-100 performance rating for the overall system and per-strategy/profile.
    Score components: Win Rate (25) · Profit Factor (35) · Reward:Risk (25) · Sample Size (15)
    """
    return jsonify(logger_svc.get_performance())


# ── Simulation ─────────────────────────────────────────────────────────────────

@strategy_bp.route("/simulate", methods=["POST"])
def run_simulation():
    """
    POST { "scenario": "profit"|"loss"|"reversal",
           "strategy_id": "<uuid>" (optional),
           "profile": "<ORB profile key>" (optional, default THUNDER_CAT),
           "suppress_push": bool (optional, default false) }

    Starts a 10-tick synthetic session (6 s/tick, ~60 s total) that fans out
    over WebSocket to any client connected on /ws/strategy/<id>/live, and —
    unless suppress_push is set — fires real Expo push notifications.
    No Alpaca orders, no Supabase writes.

    strategy_id is optional: when omitted, falls back to an existing engine
    or a throwaway IWM engine (same ad-hoc pattern as the immediate-trade
    flow — never auto-trades, no strategy config required), so this is
    reachable from a standalone "Run Simulation" entry point with no
    pre-configured strategy.
    """
    from services.strategy.simulation import SimulationRunner, VALID_SIM_PROFILES, _build_pre_entry_history, SIM_ORH, SIM_ORL

    data          = request.get_json() or {}
    scenario      = data.get("scenario", "profit")
    strategy_id   = data.get("strategy_id")
    profile       = data.get("profile", "THUNDER_CAT")
    suppress_push = bool(data.get("suppress_push", False))

    if scenario not in ("profit", "loss", "reversal"):
        return jsonify({"error": "scenario must be 'profit', 'loss', or 'reversal'"}), 400

    if profile not in VALID_SIM_PROFILES:
        return jsonify({
            "error": f"profile must be one of: {', '.join(VALID_SIM_PROFILES)}",
        }), 400

    engine = _engines.get(strategy_id) if strategy_id else (
        _first_engine() or _get_or_create_immediate_engine("IWM", paper_mode=True)
    )
    if strategy_id and not engine:
        return jsonify({"error": "Strategy not found"}), 404

    active_sid = strategy_id or getattr(engine, "strategy_id", None)
    runner = SimulationRunner(engine, suppress_push=suppress_push)
    if not runner.start(scenario, profile_key=profile):
        return jsonify({"error": "A simulation is already running"}), 409

    duration = 90 if scenario == "reversal" else 60
    ticks    = 14 if scenario == "reversal" else 10
    return jsonify({
        "status":           "started",
        "scenario":         scenario,
        "strategy_id":      active_sid,
        "duration_seconds": duration,
        "ticks":            ticks,
        "ticker":           "IWM",
        "entry_premium":    1.50,
        "profile":          profile,
        "orb_high":         SIM_ORH,
        "orb_low":          SIM_ORL,
        "history":          _build_pre_entry_history(SIM_ORH, SIM_ORL),
    }), 202




# ── Performance reviews ───────────────────────────────────────────────────────

def _parse_paper_mode_arg(raw: str | None, default: bool = True) -> bool:
    if raw is None:
        return default
    return raw.strip().lower() not in ("false", "0", "no")


@strategy_bp.route("/review/list", methods=["GET"])
def list_reviews():
    """
    Return recent daily review summaries (no markdown/trades for list efficiency).
    Reviews are decoupled per account — pass ?paper_mode=true|false to scope
    the list to one account; omit to get both (e.g. for a combined calendar).
    """
    from services.supabase.supabase_service import get_supabase_service
    limit = min(int(request.args.get("limit", 30)), 90)
    paper_mode_arg = request.args.get("paper_mode")
    try:
        q = (
            get_supabase_service().client
            .table("performance_reviews")
            .select("review_date, paper_mode, net_pnl, trade_count, win_rate, winners, losers, created_at")
        )
        if paper_mode_arg is not None:
            q = q.eq("paper_mode", _parse_paper_mode_arg(paper_mode_arg))
        rows = q.order("review_date", desc=True).limit(limit).execute().data or []
        for row in rows:
            row["is_reviewed"] = True
        return jsonify({"success": True, "data": rows, "count": len(rows)})
    except Exception as e:
        logger.error("[review/list] %s", e, exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@strategy_bp.route("/review/<review_date>", methods=["GET"])
def get_review(review_date: str):
    """
    Return full review for a date including markdown and trades_json.
    A date can now have both a paper and a live review — pass
    ?paper_mode=true|false to pick one. Defaults to paper_mode=true, matching
    how pre-decoupling single-review dates were saved (see migration
    20260712_performance_reviews_decouple_paper_live.sql).
    """
    from services.supabase.supabase_service import get_supabase_service
    paper_mode = _parse_paper_mode_arg(request.args.get("paper_mode"))
    try:
        rows = (
            get_supabase_service().client
            .table("performance_reviews")
            .select("*")
            .eq("review_date", review_date)
            .eq("paper_mode", paper_mode)
            .limit(1)
            .execute()
            .data or []
        )
        if not rows:
            return jsonify({"success": False, "error": "Review not found"}), 404
        return jsonify({"success": True, "data": rows[0]})
    except Exception as e:
        logger.error("[review/%s] %s", review_date, e, exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


# ── Manual review trigger ─────────────────────────────────────────────────────

@strategy_bp.route("/review/generate", methods=["POST"])
def trigger_review():
    """
    Generate the daily performance review(s) and save to Supabase.
    Body: { "date": "YYYY-MM-DD", "paper_mode": true|false }
      - date defaults to today if omitted.
      - paper_mode omitted (the normal case — this is what the single Supabase
        pg_cron job at 4:15 PM ET calls with no body): generates BOTH paper
        and live, saves both, and sends exactly ONE push notification
        combining both accounts' trade count and net P&L. Previously each
        account fired its own notification, AND a separate in-process
        APScheduler job did the same thing independently at the same time —
        together producing 3-4 near-duplicate pushes for one day's review
        (2026-07-15). pg_cron is now the only trigger, and this one call
        covers both accounts, so exactly one notification goes out per day.
      - paper_mode explicit (true|false): generates only that one account
        and sends its own labeled notification — for manually re-generating
        a single account's review (e.g. after fixing bad trade data), not
        for the scheduled path.
    """
    from datetime import date as _date
    from services.strategy.review_generator import ReviewGenerator
    from services.supabase.supabase_service import get_supabase_service
    from services.strategy.notifier import StrategyNotifier

    body = request.get_json(silent=True) or {}
    date_str = body.get("date")
    try:
        session_date = _date.fromisoformat(date_str) if date_str else _date.today()
    except ValueError:
        return jsonify({"success": False, "error": f"Invalid date: {date_str}"}), 400

    sb = get_supabase_service().client
    gen = ReviewGenerator(sb)

    if "paper_mode" in body:
        paper_mode = bool(body["paper_mode"])
        try:
            content, meta = gen.generate(session_date, paper_mode)
            trades = gen._fetch_trades(session_date, paper_mode)
            gen.save_to_supabase(session_date, content, trades, meta, paper_mode)
            return jsonify({
                "success": True,
                "date": str(session_date),
                "paper_mode": paper_mode,
                "meta": meta,
                "preview": content[:500] + ("..." if len(content) > 500 else ""),
            })
        except Exception as e:
            logger.error("[strategy/review/generate] Failed: %s", e, exc_info=True)
            return jsonify({"success": False, "error": str(e)}), 500

    # Default path: both accounts, one combined notification.
    results = {}
    for mode in (True, False):
        label = "paper" if mode else "live"
        try:
            content, meta = gen.generate(session_date, mode)
            trades = gen._fetch_trades(session_date, mode)
            gen.save_to_supabase(session_date, content, trades, meta, mode)
            results[label] = {"meta": meta, "preview": content[:500] + ("..." if len(content) > 500 else "")}
        except Exception as e:
            logger.error("[strategy/review/generate] %s review failed: %s", label, e, exc_info=True)
            results[label] = {"error": str(e)}

    total_trades = sum(r["meta"]["trade_count"] for r in results.values() if "meta" in r)
    total_pnl     = sum(r["meta"]["net_pnl"] for r in results.values() if "meta" in r)

    if any("meta" in r for r in results.values()):
        StrategyNotifier(sb).notify_review_ready_combined(str(session_date), total_trades, total_pnl)

    return jsonify({
        "success": any("meta" in r for r in results.values()),
        "date": str(session_date),
        "combined": {"trade_count": total_trades, "net_pnl": total_pnl},
        "results": results,
    })


# ── EMA / Technical data ──────────────────────────────────────────────────────

@strategy_bp.route("/technicals/<ticker>", methods=["GET"])
def get_ticker_technicals(ticker: str):
    from services.technical_service import get_technicals
    force = request.args.get("force", "false").lower() == "true"
    data = get_technicals(ticker.upper(), force_refresh=force)
    if data.get("error"):
        return jsonify({"success": False, "error": data["error"]}), 422
    return jsonify({"success": True, "data": data})


@strategy_bp.route("/technicals/batch", methods=["POST"])
def get_batch_technicals():
    from services.technical_service import get_technicals
    body = request.get_json(silent=True) or {}
    tickers = [t.upper().strip() for t in (body.get("tickers") or []) if t]
    if not tickers:
        return jsonify({"success": False, "error": "tickers required"}), 400
    results = {t: get_technicals(t) for t in tickers}
    return jsonify({"success": True, "data": results})


# ── Helpers ────────────────────────────────────────────────────────────────────

def _engine_position_response(engine: ORBEngine):
    if not engine.trade_taken or not engine.contract_symbol:
        return jsonify({
            "active":     False,
            "ticker":     engine.config["ticker"],
            "profile":    engine.profile_key,
            "position":   None,
            "paper_mode": engine.paper,
        })
    try:
        pos = engine.trading_client.get_open_position(engine.contract_symbol)
        em  = engine.exit_manager
        # Alpaca can return None for current_price on illiquid/freshly-opened
        # options (no recent trade print). Fall back to the engine's own
        # streamed mid-price so a missing broker quote doesn't collapse the
        # whole response to active=False via a TypeError on float(None).
        raw_price = pos.current_price
        if raw_price is None:
            raw_price = getattr(engine, '_current_option_price', None)
        current_price   = float(raw_price) if raw_price is not None else 0.0
        entry_p         = em.entry_premium if em else 0
        qty_rem         = em.qty_remaining if em else 0
        unrealized_pnl  = (current_price - entry_p) * qty_rem * 100
        unrealized_pct  = ((current_price - entry_p) / entry_p * 100) if entry_p > 0 else 0
        return jsonify({
            "active":              True,
            "ticker":              engine.config["ticker"],
            "profile":             engine.profile_key,
            "paper_mode":          engine.paper,
            "direction":           engine.position,
            "contract":            engine.contract_symbol,
            "qty_remaining":       qty_rem,
            "qty_total":           em.qty if em else 0,
            "entry_premium":       entry_p,
            "current_price":       current_price,
            "unrealized_pnl":      round(unrealized_pnl, 2),
            "unrealized_pnl_pct":  round(unrealized_pct, 2),
            "hard_stop":           em.hard_stop if em else None,
            "tp1":                 em.tp1 if em else None,
            "tp2":                 em.tp2 if em else None,
            "tp1_hit":             em.tp1_hit if em else False,
            "tp2_hit":             em.tp2_hit if em else False,
            "be_stop_active":      em.be_stop_active if em else False,
            "runner_trail":        em.runner_trail if em else None,
            "fib_levels":          engine.fib_levels,
            # Whether TP2 is even reachable for this trade — false for a
            # 1-contract entry regardless of profile (see ExitManager.__init__).
            # Lets the client hide TP2 entirely instead of showing a number
            # that can never fire.
            "use_tp2":             em._use_tp2 if em else False,
        })
    except Exception:
        return jsonify({"active": False, "position": None, "paper_mode": engine.paper})
