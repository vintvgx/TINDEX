import logging
from flask import Blueprint, jsonify, request

logger = logging.getLogger(__name__)
bp = Blueprint("zero_dte", __name__)

ZERO_DTE_PROFILES = {
    "SCALP": {
        "label": "Scalp",
        "description": "Quick flip — tight 30% stop, full exit at +30%",
        "stop_pct": 0.30,
        "tp1_pct": 0.30,
        "tp1_qty_pct": 1.0,
        "tp2_pct": None,
        "tp2_qty_pct": 0.0,
        "max_loss_pct": 0.35,
    },
    "MOMENTUM": {
        "label": "Momentum",
        "description": "Ride the move — 40% stop, scale out at +40% then +80%",
        "stop_pct": 0.40,
        "tp1_pct": 0.40,
        "tp1_qty_pct": 0.50,
        "tp2_pct": 0.80,
        "tp2_qty_pct": 0.50,
        "max_loss_pct": 0.45,
    },
    "AGGRESSIVE": {
        "label": "Aggressive",
        "description": "High conviction — 50% stop, let runners extend to +60% / +120%",
        "stop_pct": 0.50,
        "tp1_pct": 0.60,
        "tp1_qty_pct": 0.40,
        "tp2_pct": 1.20,
        "tp2_qty_pct": 0.60,
        "max_loss_pct": 0.55,
    },
}


def _sb():
    from services.supabase.supabase_service import get_supabase_service
    return get_supabase_service().client


def _require_user_id():
    """Returns (user_id, error_response). error_response is a Flask tuple on failure."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None, (jsonify({"success": False, "error": "Authorization required"}), 401)
    token = auth.removeprefix("Bearer ").strip()
    try:
        from services.supabase.supabase_service import get_supabase_service
        user_id = get_supabase_service().resolve_authenticated_user_id(token)
        return user_id, None
    except ValueError as e:
        return None, (jsonify({"success": False, "error": str(e)}), 401)
    except Exception as e:
        logger.error("[zero-dte/auth] %s", e)
        return None, (jsonify({"success": False, "error": "Authentication failed"}), 401)


@bp.route("/zero-dte/watchlist", methods=["GET"])
def get_watchlist():
    from datetime import date
    scan_date = request.args.get("date", str(date.today()))
    try:
        res = (
            _sb()
            .table("zero_dte_watchlist")
            .select("*")
            .eq("scan_date", scan_date)
            .order("composite_score", desc=True)
            .limit(50)
            .execute()
        )
        rows = res.data or []
        if rows:
            latest_scan_time = rows[0]["scan_time"]
            rows = [r for r in rows if r["scan_time"] == latest_scan_time]
        return jsonify({"success": True, "data": rows, "scan_date": scan_date})
    except Exception as e:
        logger.error("[zero-dte/watchlist] %s", e)
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route("/zero-dte/scan", methods=["POST"])
def trigger_scan():
    from services.zero_dte.zero_dte_service import get_zero_dte_scanner
    try:
        scanner = get_zero_dte_scanner(_sb())
        result  = scanner.run_scan()
        return jsonify(result)
    except Exception as e:
        logger.error("[zero-dte/scan] %s", e)
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route("/zero-dte/history", methods=["GET"])
def get_history():
    from datetime import date
    scan_date = request.args.get("date", str(date.today()))
    try:
        res = (
            _sb()
            .table("zero_dte_watchlist")
            .select("scan_time, ticker, composite_score, tier, contract_type, strike, dollar_flow, is_sweep")
            .eq("scan_date", scan_date)
            .order("scan_time", desc=True)
            .order("composite_score", desc=True)
            .execute()
        )
        return jsonify({"success": True, "data": res.data or []})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ── Profiles ──────────────────────────────────────────────────────────────────

@bp.route("/zero-dte/profiles", methods=["GET"])
def get_profiles():
    return jsonify({"success": True, "profiles": ZERO_DTE_PROFILES})


# ── Positions ─────────────────────────────────────────────────────────────────

@bp.route("/zero-dte/positions", methods=["GET"])
def get_positions():
    user_id, auth_error = _require_user_id()
    if auth_error:
        return auth_error
    status_filter = request.args.get("status", "open")
    try:
        query = _sb().table("zero_dte_positions").select("*").eq("user_id", user_id)
        if status_filter != "all":
            query = query.eq("status", status_filter)
        rows = query.order("created_at", desc=True).execute().data or []
        return jsonify({"success": True, "data": rows})
    except Exception as e:
        logger.error("[zero-dte/positions GET] %s", e)
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route("/zero-dte/positions/enter", methods=["POST"])
def enter_zero_dte_position():
    """
    Open a 0DTE position from the watchlist.
    Body: { ticker, contract_type, strike, expiry, qty, entry_price, strategy_profile, mode?, watchlist_ref_id? }
    """
    user_id, auth_error = _require_user_id()
    if auth_error:
        return auth_error
    body = request.get_json(silent=True) or {}

    required = ["ticker", "contract_type", "strike", "expiry", "qty", "entry_price", "strategy_profile"]
    for field in required:
        if body.get(field) is None:
            return jsonify({"success": False, "error": f"{field} is required"}), 400

    profile_name = body["strategy_profile"]
    if profile_name not in ZERO_DTE_PROFILES:
        return jsonify({"success": False, "error": f"Unknown profile. Valid: {list(ZERO_DTE_PROFILES)}"}), 400

    profile     = ZERO_DTE_PROFILES[profile_name]
    entry_price = float(body["entry_price"])
    qty         = int(body["qty"])

    tp_ladder = [{"level": "TP1", "pct": profile["tp1_pct"], "qty_pct": profile["tp1_qty_pct"], "hit": False}]
    if profile.get("tp2_pct"):
        tp_ladder.append({"level": "TP2", "pct": profile["tp2_pct"], "qty_pct": profile["tp2_qty_pct"], "hit": False})

    try:
        row = _sb().table("zero_dte_positions").insert({
            "user_id":          user_id,
            "ticker":           body["ticker"],
            "contract_type":    body["contract_type"],
            "strike":           float(body["strike"]),
            "expiry":           body["expiry"],
            "qty":              qty,
            "qty_remaining":    qty,
            "entry_price":      entry_price,
            "strategy_profile": profile_name,
            "stop_pct":         profile["stop_pct"],
            "stop_price":       round(entry_price * (1 - profile["stop_pct"]), 4),
            "tp_ladder":        tp_ladder,
            "mode":             body.get("mode", "paper"),
            "watchlist_ref_id": body.get("watchlist_ref_id"),
            "status":           "open",
        }).execute().data
        return jsonify({"success": True, "data": row[0] if row else None})
    except Exception as e:
        logger.error("[zero-dte/positions/enter] %s", e)
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route("/zero-dte/positions/<position_id>/exit", methods=["POST"])
def exit_zero_dte_position(position_id: str):
    """Manual close. Body: { qty?, exit_price?, reason? }"""
    user_id, auth_error = _require_user_id()
    if auth_error:
        return auth_error
    body = request.get_json(silent=True) or {}

    try:
        rows = (
            _sb().table("zero_dte_positions")
            .select("*").eq("id", position_id).eq("user_id", user_id)
            .execute().data or []
        )
        if not rows:
            return jsonify({"success": False, "error": "Position not found"}), 404
        pos = rows[0]
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

    qty_to_close = int(body.get("qty") or pos["qty"])
    exit_price   = float(body.get("exit_price") or 0)
    entry_price  = float(pos.get("entry_price") or 0)
    pnl          = (exit_price - entry_price) * qty_to_close * 100 if exit_price and entry_price else None

    new_qty    = (pos.get("qty_remaining") or pos.get("qty") or 0) - qty_to_close
    new_status = "closed" if new_qty <= 0 else "partially_closed"
    realized   = float(pos.get("realized_pnl") or 0) + (pnl or 0)

    try:
        from datetime import datetime
        _sb().table("zero_dte_positions").update({
            "status":       new_status,
            "qty_remaining": max(new_qty, 0),
            "realized_pnl": realized,
            "closed_at":    datetime.utcnow().isoformat() if new_status == "closed" else None,
        }).eq("id", position_id).execute()
        return jsonify({"success": True, "status": new_status, "realized_pnl": realized, "qty_closed": qty_to_close})
    except Exception as e:
        logger.error("[zero-dte/positions/exit] %s", e)
        return jsonify({"success": False, "error": str(e)}), 500
