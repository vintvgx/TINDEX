"""
Watched price-level routes: user-defined key levels (self-identified or
confirmed by a Discord options-flow admin) that get watched against live
price. See services/strategy/key_level_watcher.py for the confirmation
pipeline.
"""

import re

from flask import Blueprint, jsonify, request

from log.logging_config import get_logger
from services.supabase.supabase_service import get_supabase_service

logger = get_logger(__name__)

bp = Blueprint("price_levels", __name__)


@bp.route("/price-levels", methods=["POST"])
def create_price_level():
    """
    Body: {
      userId, ticker, direction ('bullish'|'bearish'),
      levelLow, levelHigh?,             // levelHigh defaults to levelLow (a point)
      source? ('self'|'discord_admin'), notes?,
      namedContracts?: [{option_type, strike, expiration_date}]
    }
    """
    try:
        data = request.get_json(silent=True) or {}
        user_id = data.get("userId")
        if not user_id:
            return jsonify({"success": False, "error": "userId is required"}), 400

        ticker = (data.get("ticker") or "").strip().upper()
        if not ticker or not re.match(r"^[A-Z0-9]{1,5}$", ticker):
            return jsonify({"success": False, "error": "Invalid ticker symbol format"}), 400

        direction = data.get("direction")
        if direction not in ("bullish", "bearish"):
            return jsonify({"success": False, "error": "direction must be 'bullish' or 'bearish'"}), 400

        level_low_raw = data.get("levelLow")
        if level_low_raw is None:
            return jsonify({"success": False, "error": "levelLow is required"}), 400
        try:
            level_low = float(level_low_raw)
            level_high = float(data["levelHigh"]) if data.get("levelHigh") is not None else level_low
        except (TypeError, ValueError):
            return jsonify({"success": False, "error": "levelLow/levelHigh must be numbers"}), 400
        if level_low <= 0 or level_high <= 0:
            return jsonify({"success": False, "error": "levelLow/levelHigh must be positive"}), 400
        if level_high < level_low:
            level_low, level_high = level_high, level_low

        source = data.get("source", "self")
        if source not in ("self", "discord_admin"):
            return jsonify({"success": False, "error": "source must be 'self' or 'discord_admin'"}), 400

        service = get_supabase_service()
        service.verify_user(user_id=user_id)

        row = {
            "user_id": user_id,
            "ticker": ticker,
            "level_low": level_low,
            "level_high": level_high,
            "direction": direction,
            "source": source,
            "notes": (data.get("notes") or "").strip() or None,
            "named_contracts": data.get("namedContracts") or [],
            "status": "watching",
        }
        result = service.client.table("watched_price_levels").insert(row).execute()
        created = result.data[0] if result.data else None
        if not created:
            return jsonify({"success": False, "error": "Failed to create price level"}), 500

        # Bars only flow through OrbDataHub for tickers with orb_enabled —
        # this is the same flag the ticker-detail-sheet ORB star toggles.
        # A level watch is meaningless without live bars, so make sure it's
        # on. This only enables bar streaming + ORB range calc for the
        # ticker; it does not start any automated trading.
        try:
            service.follow_stock(user_id, ticker)
        except Exception as e:
            logger.warning("[price-levels] follow_stock failed for %s/%s: %s", user_id, ticker, e)

        from services.strategy.key_level_watcher import get_key_level_watcher
        get_key_level_watcher().watch_level(created)

        return jsonify({"success": True, "data": created}), 200

    except Exception as e:
        logger.error("Failed to create price level: %s", e, exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route("/price-levels", methods=["GET"])
def list_price_levels():
    try:
        user_id = request.args.get("userId")
        if not user_id:
            return jsonify({"success": False, "error": "userId query parameter is required"}), 400

        service = get_supabase_service()
        service.verify_user(user_id=user_id)

        query = service.client.table("watched_price_levels").select("*").eq("user_id", user_id)
        status = request.args.get("status")
        if status:
            query = query.eq("status", status)
        rows = query.order("created_at", desc=True).execute().data or []
        return jsonify({"success": True, "data": rows})

    except Exception as e:
        logger.error("Failed to list price levels: %s", e, exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route("/price-levels/<level_id>", methods=["DELETE"])
def delete_price_level(level_id: str):
    """Cancels a level. Soft-delete (status='cancelled') rather than a row
    delete, so a confirmed level's suggestions stay visible in history."""
    try:
        user_id = request.args.get("userId")
        if not user_id:
            return jsonify({"success": False, "error": "userId query parameter is required"}), 400

        service = get_supabase_service()
        service.verify_user(user_id=user_id)

        from services.strategy.key_level_watcher import get_key_level_watcher
        get_key_level_watcher().cancel_level(level_id)

        result = (
            service.client.table("watched_price_levels")
            .update({"status": "cancelled"})
            .eq("id", level_id)
            .eq("user_id", user_id)
            .execute()
        )
        if not result.data:
            return jsonify({"success": False, "error": "Price level not found"}), 404
        return jsonify({"success": True, "data": result.data[0]})

    except Exception as e:
        logger.error("Failed to delete price level: %s", e, exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500
