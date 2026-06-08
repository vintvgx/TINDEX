"""
Flask blueprint for ORB strategy endpoints.

Multi-strategy: _engines is a dict keyed by strategy UUID.
Legacy single-engine endpoints (/strategy/config, /strategy/position, etc.)
operate on the first engine for backwards compatibility with old clients.
"""

from flask import Blueprint, jsonify, request
from services.strategy.trade_logger import TradeLogger
from services.strategy.profiles import PROFILES, describe_profile
from services.strategy.scheduler import reschedule_jobs
from services.strategy.orb_engine import ORBEngine, STRATEGY_DEFAULTS

strategy_bp = Blueprint("strategy", __name__, url_prefix="/strategy")

logger_svc    = TradeLogger()
_engines:      dict[str, ORBEngine] = {}   # strategy_id -> ORBEngine
_stream_manager = None                     # OptionStreamManager — set by init_routes


def init_routes(engines: dict[str, ORBEngine], stream_manager=None):
    global _engines, _stream_manager
    _engines        = engines
    _stream_manager = stream_manager


def _first_engine() -> ORBEngine | None:
    """Return the first engine, used by legacy single-engine endpoints."""
    return next(iter(_engines.values()), None)


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
            "ticker", "orb_minutes", "paper_mode", "active",
            "profile", "trade_days", "strategy_name", "capital_limit",
            "bypass_breakout_window", "custom_thresholds",
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
    allowed = {"ticker", "orb_minutes", "paper_mode", "active",
               "profile", "trade_days", "strategy_name", "capital_limit",
               "bypass_breakout_window", "custom_thresholds"}
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
        engine.logger.log_exit(
            engine.contract_symbol, "MANUAL_CLOSE", None,
            engine.exit_manager.qty_remaining if engine.exit_manager else 0,
            engine.profile_key,
            strategy_id=engine.strategy_id,
        )
        engine.reset_session()
        return jsonify({"status": "ok"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


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
