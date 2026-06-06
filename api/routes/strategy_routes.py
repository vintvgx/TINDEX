"""
Flask blueprint for ORB strategy endpoints.
All endpoints read from / write to the global ORBEngine instance
that is initialized in app.py.
"""

from flask import Blueprint, jsonify, request
from services.strategy.trade_logger import TradeLogger
from services.strategy.profiles import PROFILES, describe_profile
from services.strategy.scheduler import reschedule_jobs

strategy_bp = Blueprint("strategy", __name__, url_prefix="/strategy")

logger_svc = TradeLogger()
_engine = None  # injected by init_routes()


def init_routes(orb_engine):
    global _engine
    _engine = orb_engine


# ── Config ─────────────────────────────────────────────────────────────────────

@strategy_bp.route("/config", methods=["GET"])
def get_config():
    return jsonify(_engine.config)


@strategy_bp.route("/config", methods=["POST"])
def update_config():
    """
    Frontend sends any subset of:
      ticker, orb_minutes, paper_mode, active, profile, trade_days
    """
    data = request.get_json() or {}
    allowed = {"ticker", "orb_minutes", "paper_mode", "active", "profile", "trade_days"}
    for key in allowed:
        if key in data:
            _engine.config[key] = data[key]

    _engine.reload_config(_engine.config)

    if "trade_days" in data or "profile" in data:
        reschedule_jobs(_engine)

    logger_svc.save_config(_engine.config)
    return jsonify({"status": "ok", "config": _engine.config})


# ── Profiles ───────────────────────────────────────────────────────────────────

@strategy_bp.route("/profiles", methods=["GET"])
def get_profiles():
    return jsonify([describe_profile(k) for k in PROFILES.keys()])


@strategy_bp.route("/profiles/<profile_key>", methods=["GET"])
def get_profile_detail(profile_key: str):
    key = profile_key.upper()
    if key not in PROFILES:
        return jsonify({"error": "Unknown profile"}), 404
    return jsonify(describe_profile(key))


# ── Live position ──────────────────────────────────────────────────────────────

@strategy_bp.route("/position", methods=["GET"])
def get_position():
    if not _engine.trade_taken or not _engine.contract_symbol:
        return jsonify({
            "active":   False,
            "ticker":   _engine.config["ticker"],
            "profile":  _engine.profile_key,
            "position": None,
            "paper_mode": _engine.paper,
        })

    try:
        pos = _engine.trading_client.get_open_position(_engine.contract_symbol)
        em  = _engine.exit_manager
        return jsonify({
            "active":            True,
            "ticker":            _engine.config["ticker"],
            "profile":           _engine.profile_key,
            "paper_mode":        _engine.paper,
            "direction":         _engine.position,
            "contract":          _engine.contract_symbol,
            "qty_remaining":     em.qty_remaining if em else 0,
            "qty_total":         em.qty if em else 0,
            "entry_premium":     em.entry_premium if em else None,
            "current_price":     float(pos.current_price),
            "unrealized_pnl":    float(pos.unrealized_pl),
            "unrealized_pnl_pct": float(pos.unrealized_plpc) * 100,
            "hard_stop":         em.hard_stop if em else None,
            "tp1":               em.tp1 if em else None,
            "tp2":               em.tp2 if em else None,
            "tp1_hit":           em.tp1_hit if em else False,
            "tp2_hit":           em.tp2_hit if em else False,
            "be_stop_active":    em.be_stop_active if em else False,
            "runner_trail":      em.runner_trail if em else None,
            "fib_levels":        _engine.fib_levels,
        })
    except Exception:
        return jsonify({"active": False, "position": None, "paper_mode": _engine.paper})


# ── Session ────────────────────────────────────────────────────────────────────

@strategy_bp.route("/session", methods=["GET"])
def get_session():
    return jsonify(_engine.session_state())


# ── Account (paper or live) ────────────────────────────────────────────────────

@strategy_bp.route("/account", methods=["GET"])
def get_account():
    info = _engine.get_account_info()
    if info:
        return jsonify({"success": True, "data": info})
    return jsonify({"success": False, "error": "Could not fetch account data"}), 502


# ── Trade history ──────────────────────────────────────────────────────────────

@strategy_bp.route("/trades", methods=["GET"])
def get_trade_history():
    limit   = request.args.get("limit", 20, type=int)
    ticker  = request.args.get("ticker", None)
    profile = request.args.get("profile", None)
    return jsonify(logger_svc.get_trades(limit=limit, ticker=ticker, profile=profile))


# ── Stats ──────────────────────────────────────────────────────────────────────

@strategy_bp.route("/stats", methods=["GET"])
def get_stats():
    profile = request.args.get("profile", None)
    return jsonify(logger_svc.get_stats(profile=profile))


@strategy_bp.route("/stats/by-profile", methods=["GET"])
def get_stats_by_profile():
    return jsonify(logger_svc.get_stats_by_profile())


# ── Manual controls ────────────────────────────────────────────────────────────

@strategy_bp.route("/reset-session", methods=["POST"])
def reset_session():
    _engine.reset_session()
    return jsonify({"status": "ok", "message": "Session reset"})


@strategy_bp.route("/force-close", methods=["POST"])
def force_close():
    """Emergency close of current position."""
    if not _engine.trade_taken or not _engine.contract_symbol:
        return jsonify({"status": "ok", "message": "No active position"})
    try:
        _engine.trading_client.close_position(_engine.contract_symbol)
        _engine.logger.log_exit(
            _engine.contract_symbol, "MANUAL_CLOSE",
            None,
            _engine.exit_manager.qty_remaining if _engine.exit_manager else 0,
            _engine.profile_key,
        )
        _engine.reset_session()
        return jsonify({"status": "ok", "message": "Position closed"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500
