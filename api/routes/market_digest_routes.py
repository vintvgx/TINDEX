"""
Flask blueprint for the pre-market Market Digest.

Mirrors the /strategy/review/* endpoints (strategy_routes.py) but for the
structured-JSON pre-market digest instead of the markdown daily review.
Kept as its own blueprint rather than folded into strategy_routes.py since
it has no dependency on the ORB engine state that file otherwise centers on.
"""

import logging

from flask import Blueprint, jsonify, request

from services.supabase.supabase_service import get_supabase_service

logger = logging.getLogger(__name__)

market_digest_bp = Blueprint("market_digest", __name__, url_prefix="/market-digest")


@market_digest_bp.route("/list", methods=["GET"])
def list_digests():
    """Recent digest dates (no content_json, for a calendar-style list)."""
    limit = min(int(request.args.get("limit", 30)), 90)
    try:
        rows = (
            get_supabase_service().client
            .table("market_digests")
            .select("digest_date, created_at")
            .order("digest_date", desc=True)
            .limit(limit)
            .execute()
            .data or []
        )
        return jsonify({"success": True, "data": rows, "count": len(rows)})
    except Exception as e:
        logger.error("[market-digest/list] %s", e, exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@market_digest_bp.route("/<digest_date>", methods=["GET"])
def get_digest(digest_date: str):
    try:
        rows = (
            get_supabase_service().client
            .table("market_digests")
            .select("*")
            .eq("digest_date", digest_date)
            .limit(1)
            .execute()
            .data or []
        )
        if not rows:
            return jsonify({"success": False, "error": "Digest not found"}), 404
        return jsonify({"success": True, "data": rows[0]})
    except Exception as e:
        logger.error("[market-digest/%s] %s", digest_date, e, exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@market_digest_bp.route("/generate", methods=["POST"])
def trigger_digest():
    """
    DEPRECATED — the Claude-generated digest is retired. Digests are now
    published by Muse's morning cron via POST /muse/market-digest/publish
    (8 AM ET notify, 9 AM ET silent refresh). This route returns 410; the
    app's regenerate button is removed in the digest UI redesign.
    """
    return jsonify({
        "success": False,
        "error": "Digest generation is deprecated — digests are now published by the morning cron.",
    }), 410
