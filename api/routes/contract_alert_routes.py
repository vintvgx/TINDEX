"""
Contract price alert routes: "notify me when THIS CONTRACT's price hits $X",
set from an open position's PositionInfoModal (PRICE ALERT section).

Deliberately separate from price_level_routes.py's watched_price_levels,
which watches the UNDERLYING ticker's price via KeyLevelWatcher's 1-minute
bar feed — an option contract's price doesn't flow through that feed at
all. Instead, an alert here is registered directly on the position's live
ExitManager (see ExitManager.add_price_alert/check_price_alerts) and
checked every tick alongside the existing SL/TP evaluation in
ORBEngine._process_tick — see notifier.py's notify_contract_price_alert
for the push itself.
"""

from flask import Blueprint, jsonify, request

from log.logging_config import get_logger
from services.supabase.supabase_service import get_supabase_service

logger = get_logger(__name__)

bp = Blueprint("contract_alerts", __name__)


@bp.route("/strategy/positions/<strategy_id>/alerts", methods=["POST"])
def create_contract_alert(strategy_id: str):
    """
    Body: { userId, targetPrice }.
    Only meaningful for an OPEN position (needs a live engine + exit_manager
    + a current contract price to compute direction from) — a closed/unknown
    strategy_id 404s rather than creating an orphaned, never-checked row.
    """
    try:
        # Routes import services, not the other way around (same convention
        # as price_level_routes.py) — imported here to avoid a circular
        # import with strategy_routes.py at module load time.
        from routes.strategy_routes import _resolve_any_engine

        data = request.get_json(silent=True) or {}
        user_id = data.get("userId")
        if not user_id:
            return jsonify({"success": False, "error": "userId is required"}), 400

        target_raw = data.get("targetPrice")
        if target_raw is None:
            return jsonify({"success": False, "error": "targetPrice is required"}), 400
        try:
            target_price = float(target_raw)
        except (TypeError, ValueError):
            return jsonify({"success": False, "error": "targetPrice must be a number"}), 400
        if target_price <= 0:
            return jsonify({"success": False, "error": "targetPrice must be positive"}), 400

        engine = _resolve_any_engine(strategy_id)
        if not engine or not engine.exit_manager or not engine.contract_symbol:
            return jsonify({"success": False, "error": "No open position for this strategy_id"}), 404

        # Alpaca can lag on a freshly-opened contract's current_price (no
        # recent trade print yet) — fall back to the engine's own streamed
        # tick, same fallback _engine_position_response already uses.
        current_price = getattr(engine, "_current_option_price", None)
        if current_price is None:
            current_price = engine.exit_manager.entry_premium
        current_price = float(current_price)

        service = get_supabase_service()
        service.verify_user(user_id=user_id)

        row = {
            "user_id": user_id,
            "strategy_id": strategy_id,
            "ticker": engine.ticker,
            "contract_symbol": engine.contract_symbol,
            "target_price": target_price,
            "direction": "above" if target_price >= current_price else "below",
            "status": "watching",
        }
        result = service.client.table("contract_price_alerts").insert(row).execute()
        created = result.data[0] if result.data else None
        if not created:
            return jsonify({"success": False, "error": "Failed to create contract price alert"}), 500

        engine.exit_manager.add_price_alert(created)

        return jsonify({"success": True, "data": created}), 200

    except Exception as e:
        logger.error("Failed to create contract price alert for %s: %s", strategy_id, e, exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route("/strategy/positions/<strategy_id>/alerts", methods=["GET"])
def list_contract_alerts(strategy_id: str):
    try:
        user_id = request.args.get("userId")
        if not user_id:
            return jsonify({"success": False, "error": "userId query parameter is required"}), 400

        service = get_supabase_service()
        service.verify_user(user_id=user_id)

        # Everything except cancelled — includes 'triggered' so a user can
        # still see an alert's history/hit price after it fires, not just
        # while it's pending.
        rows = (
            service.client.table("contract_price_alerts")
            .select("*")
            .eq("strategy_id", strategy_id)
            .eq("user_id", user_id)
            .neq("status", "cancelled")
            .order("created_at", desc=True)
            .execute()
            .data or []
        )
        return jsonify({"success": True, "data": rows})

    except Exception as e:
        logger.error("Failed to list contract price alerts for %s: %s", strategy_id, e, exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route("/strategy/positions/<strategy_id>/alerts/<alert_id>", methods=["DELETE"])
def delete_contract_alert(strategy_id: str, alert_id: str):
    """Soft-delete (status='cancelled'), mirroring price_level_routes.py's
    delete_price_level. Stops watching on the live engine if it's still
    open — but doesn't fail the request if the position has since closed
    (the row still gets cancelled either way)."""
    try:
        from routes.strategy_routes import _resolve_any_engine

        user_id = request.args.get("userId")
        if not user_id:
            return jsonify({"success": False, "error": "userId query parameter is required"}), 400

        service = get_supabase_service()
        service.verify_user(user_id=user_id)

        engine = _resolve_any_engine(strategy_id)
        if engine and engine.exit_manager:
            engine.exit_manager.remove_price_alert(alert_id)

        result = (
            service.client.table("contract_price_alerts")
            .update({"status": "cancelled"})
            .eq("id", alert_id)
            .eq("strategy_id", strategy_id)
            .eq("user_id", user_id)
            .execute()
        )
        if not result.data:
            return jsonify({"success": False, "error": "Contract price alert not found"}), 404
        return jsonify({"success": True, "data": result.data[0]})

    except Exception as e:
        logger.error("Failed to delete contract price alert %s: %s", alert_id, e, exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500
