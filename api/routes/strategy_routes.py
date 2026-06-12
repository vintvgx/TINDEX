"""
Flask blueprint for ORB strategy endpoints.

Multi-strategy: _engines is a dict keyed by strategy UUID.
Legacy single-engine endpoints (/strategy/config, /strategy/position, etc.)
operate on the first engine for backwards compatibility with old clients.
"""

import logging

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
        result.append({
            **cfg,
            "has_position": bool(eng and eng.trade_taken and eng.contract_symbol),
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
            "bypass_breakout_window", "custom_thresholds",
            "budget_otm_mode", "otm_fib_level", "debug_mode",
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
    if strategy_id not in _engines:
        return jsonify({"error": "Strategy not found"}), 404

    engine = _engines[strategy_id]
    allowed = {"ticker", "paper_mode", "active",
               "profile", "trade_days", "strategy_name", "capital_limit",
               "bypass_breakout_window", "custom_thresholds",
               "budget_otm_mode", "otm_fib_level", "debug_mode"}
    for key in allowed:
        if key in data:
            engine.config[key] = data[key]
    engine.config["id"] = strategy_id

    engine.reload_config(engine.config)
    reschedule_jobs(engine, strategy_id=strategy_id)
    logger_svc.save_strategy_config(engine.config)

    return jsonify({"status": "ok", "config": engine.config})


@strategy_bp.route("/configs/<strategy_id>", methods=["DELETE"])
def delete_config(strategy_id: str):
    """Stop and remove a strategy."""
    engine = _engines.get(strategy_id)
    if engine and engine.trade_taken and engine.contract_symbol:
        # Refuse to delete until the open position is closed — prevents orphaned orders
        try:
            engine.trading_client.close_position(engine.contract_symbol)
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
        engine.trading_client.close_position(engine.contract_symbol)
        em          = engine.exit_manager
        qty         = em.qty_remaining if em else 0
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
        res = logger_svc.client.table("orb_debug_logs") \
            .select("id,ts,level,message,data,strategy_id,ticker,strategy_name") \
            .order("ts", desc=False) \
            .limit(limit) \
            .execute()
        rows = res.data or []
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

    result = engine.submit_manual_trade(
        direction=direction,
        contract_symbol=contract_symbol,
        qty=data.get("qty"),
        profile_key=data.get("profile"),
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

    engine = _get_or_create_immediate_engine(ticker, paper_mode)
    result = engine.submit_manual_trade(
        direction=direction,
        contract_symbol=contract_symbol,
        qty=data.get("qty"),
        profile_key=data.get("profile"),
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
    from services.strategy.profiles import CUSTOM_DEFAULTS
    profiles = [describe_profile(k) for k in PROFILES.keys()]
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


# ── Trade history / Stats ──────────────────────────────────────────────────────

@strategy_bp.route("/trades", methods=["GET"])
def get_trade_history():
    limit   = request.args.get("limit", 20, type=int)
    ticker  = request.args.get("ticker", None)
    profile = request.args.get("profile", None)
    return jsonify(logger_svc.get_trades(limit=limit, ticker=ticker, profile=profile))


@strategy_bp.route("/stats", methods=["GET"])
def get_stats():
    profile = request.args.get("profile", None)
    return jsonify(logger_svc.get_stats(profile=profile))


@strategy_bp.route("/stats/by-profile", methods=["GET"])
def get_stats_by_profile():
    return jsonify(logger_svc.get_stats_by_profile())


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
        return jsonify({
            "active":              True,
            "ticker":              engine.config["ticker"],
            "profile":             engine.profile_key,
            "paper_mode":          engine.paper,
            "direction":           engine.position,
            "contract":            engine.contract_symbol,
            "qty_remaining":       em.qty_remaining if em else 0,
            "qty_total":           em.qty if em else 0,
            "entry_premium":       em.entry_premium if em else None,
            "current_price":       float(pos.current_price),
            "unrealized_pnl":      float(pos.unrealized_pl),
            "unrealized_pnl_pct":  float(pos.unrealized_plpc) * 100,
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
