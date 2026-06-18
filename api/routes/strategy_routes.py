"""
Flask blueprint for ORB strategy endpoints.

Multi-strategy: _engines is a dict keyed by strategy UUID.
Legacy single-engine endpoints (/strategy/config, /strategy/position, etc.)
operate on the first engine for backwards compatibility with old clients.
"""

import logging
import concurrent.futures

from flask import Blueprint, jsonify, request
from services.strategy.trade_logger import TradeLogger
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


def _get_or_create_immediate_engine(ticker: str, paper_mode: bool) -> ORBEngine:
    """Return the immediate engine for (ticker, paper/live), creating it on first use."""
    key = _immediate_key(ticker, paper_mode)
    eng = _immediate_engines.get(key)
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
    allowed = {"ticker", "paper_mode", "active",
               "profile", "trade_days", "strategy_name", "capital_limit",
               "bypass_breakout_window", "custom_thresholds", "exit_overrides",
               "budget_otm_mode", "otm_fib_level", "debug_mode", "smart_contracts"}
    for key in allowed:
        if key in data:
            engine.config[key] = data[key]
    engine.config["id"] = strategy_id

    engine.reload_config(engine.config)
    reschedule_jobs(engine, strategy_id=strategy_id)

    saved = logger_svc.save_strategy_config(engine.config)
    if not saved:
        return jsonify({"error": "Config updated in memory but failed to persist to database"}), 500

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
        )
        engine.notifier.notify_exit(
            ticker=engine.ticker,
            contract_symbol=engine.contract_symbol,
            exit_reason="MANUAL_CLOSE",
            pnl=pnl,
            qty=qty,
            profile_key=engine.profile_key,
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
    and ad-hoc immediate-trade engines (resolved by id). Body: {qty?} — omit qty
    to sell the entire remaining position.
    """
    engine = _resolve_any_engine(strategy_id)
    if not engine:
        return jsonify({"status": "error", "message": "Position not found"}), 404
    data = request.get_json() or {}
    qty = data.get("qty")
    result = engine.submit_manual_exit(int(qty) if qty is not None else None)
    code = 200 if result.get("status") == "ok" else 409
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
    breakout wait / sentiment / flow filters. Body:
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

    exit_overrides = {}
    if "consol_exit" in data:
        exit_overrides["consol_exit"] = bool(data["consol_exit"])
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
    section. Live P&L is computed from the latest streamed option mid-price.
    """
    out = []
    for eng in _immediate_engines.values():
        if not eng.trade_taken or not eng.contract_symbol:
            continue
        em      = eng.exit_manager
        entry_p = em.entry_premium if em else None
        qty_rem = em.qty_remaining if em else 0
        mid     = getattr(eng, "_current_option_price", None)
        pnl = pnl_pct = None
        if mid is not None and entry_p:
            pnl     = round((mid - entry_p) * qty_rem * 100, 2)
            pnl_pct = round(((mid - entry_p) / entry_p * 100) if entry_p > 0 else 0, 2)
        out.append({
            "strategy_id":   eng.strategy_id,
            "ticker":        eng.ticker,
            "paper_mode":    eng.paper,
            "direction":     eng.position,
            "contract":      eng.contract_symbol,
            "profile":       eng.profile_key,
            "qty_remaining": qty_rem,
            "entry_premium": entry_p,
            "mid_price":     round(mid, 4) if mid is not None else None,
            "pnl":           pnl,
            "pnl_pct":       pnl_pct,
            "tp1_hit":       em.tp1_hit if em else False,
            "tp2_hit":       em.tp2_hit if em else False,
        })
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
                "equity":          equity,
                "cash":            float(acct.cash),
                "buying_power":    float(acct.buying_power),
                "day_trade_count": acct.daytrade_count,
                "pnl_today":       round(pnl_today, 2),
                "pnl_today_pct":   round(pnl_today / last_equity * 100, 3) if last_equity > 0 else 0,
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


@strategy_bp.route("/accounts/history", methods=["GET"])
def get_accounts_history():
    """Return period P&L (today / week / month) for paper and live accounts."""
    import os
    from alpaca.trading.client import TradingClient

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

            # Fetch 1-month of daily history to derive week/month P&L.
            try:
                hist = client.get_portfolio_history(filter=None)
                # alpaca-py returns PortfolioHistory with .equity (list) and .profit_loss
                equities = [float(e) for e in (hist.equity or []) if e is not None]
            except Exception:
                equities = []

            pnl_week = pnl_week_pct = None
            pnl_month = pnl_month_pct = None

            if equities:
                # Week: compare current equity to 5 trading days ago (or earliest available)
                week_idx = max(0, len(equities) - 6)
                week_start = equities[week_idx]
                if week_start > 0:
                    pnl_week     = round(equity - week_start, 2)
                    pnl_week_pct = round((equity - week_start) / week_start * 100, 3)

                # Month: compare to first available equity in the series
                month_start = equities[0]
                if month_start > 0:
                    pnl_month     = round(equity - month_start, 2)
                    pnl_month_pct = round((equity - month_start) / month_start * 100, 3)

            return {
                "available":      True,
                "equity":         equity,
                "pnl_today":      round(pnl_today, 2),
                "pnl_today_pct":  round(pnl_today_pct, 3),
                "pnl_week":       pnl_week,
                "pnl_week_pct":   pnl_week_pct,
                "pnl_month":      pnl_month,
                "pnl_month_pct":  pnl_month_pct,
                "paper_mode":     paper,
            }
        except Exception as e:
            return {"available": False, "paper_mode": paper, "error": str(e)}

    return jsonify({
        "success": True,
        "paper":   _fetch_with_history(True),
        "live":    _fetch_with_history(False),
    })


# ── Trade history / Stats ──────────────────────────────────────────────────────

@strategy_bp.route("/data/reset", methods=["POST"])
def reset_strategy_data():
    """
    Danger-zone: delete all rows from orb_trades and orb_session so the user
    can start fresh.  Optionally also wipes orb_debug_logs when
    clear_debug_logs=true is passed in the JSON body.

    Intended for development / paper-trading only.  The route does not require
    a confirmation token beyond the explicit POST — the frontend handles the
    two-step confirm UI.
    """
    body = request.get_json(silent=True) or {}
    clear_debug = bool(body.get("clear_debug_logs", False))
    try:
        client = logger_svc.client
        # Delete all trade records
        client.table("orb_trades").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
        # Delete all session records
        client.table("orb_session").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
        if clear_debug:
            client.table("orb_debug_logs").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
        logger.warning("[strategy] Trade data reset performed — orb_trades and orb_session cleared")
        return jsonify({
            "status":  "ok",
            "message": "Trade data cleared. orb_trades and orb_session wiped."
                       + (" orb_debug_logs also cleared." if clear_debug else ""),
            "cleared": ["orb_trades", "orb_session"] + (["orb_debug_logs"] if clear_debug else []),
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
    return jsonify(logger_svc.get_trades(limit=limit, ticker=ticker, profile=profile,
                                         trade_date=trade_date))


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
    POST { "scenario": "profit"|"loss", "strategy_id": "<uuid>" (optional) }

    Starts a 10-tick synthetic session (6 s/tick, ~60 s total) that fires
    real Expo push notifications and WebSocket fan-outs to any client
    connected on /ws/strategy/<id>/live.  No Alpaca orders, no Supabase writes.
    """
    from services.strategy.simulation import SimulationRunner

    data        = request.get_json() or {}
    scenario    = data.get("scenario", "profit")
    strategy_id = data.get("strategy_id")

    if scenario not in ("profit", "loss", "reversal"):
        return jsonify({"error": "scenario must be 'profit', 'loss', or 'reversal'"}), 400

    engine = _engines.get(strategy_id) if strategy_id else _first_engine()
    if not engine:
        return jsonify({
            "error": "No strategy engine running — add a strategy first",
        }), 404

    active_sid = strategy_id or next(iter(_engines))
    runner = SimulationRunner(engine)
    if not runner.start(scenario):
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
        "profile":          "THUNDER_CAT",
    }), 202




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
        current_price   = float(pos.current_price)
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
        })
    except Exception:
        return jsonify({"active": False, "position": None, "paper_mode": engine.paper})
