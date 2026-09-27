"""
Flask blueprint for the pre-market Market Digest.

Mirrors the /strategy/review/* endpoints (strategy_routes.py) but for the
structured-JSON pre-market digest instead of the markdown daily review.
Kept as its own blueprint rather than folded into strategy_routes.py since
it has no dependency on the ORB engine state that file otherwise centers on.
"""

import logging
from datetime import date as _date

from flask import Blueprint, jsonify, request

from services.strategy.market_digest_generator import MarketDigestGenerator
from services.strategy.notifier import StrategyNotifier
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
    Generate today's (or a given date's) digest and save it.
    Body: { "date": "YYYY-MM-DD" } — defaults to today. No body is the
    normal case: this is what the Supabase pg_cron job at 8:30 AM ET calls.
    A manual on-demand call from the Daily Review screen passes the same
    shape and gets the same one push notification on success.
    """
    body = request.get_json(silent=True) or {}
    date_str = body.get("date")
    try:
        digest_date = _date.fromisoformat(date_str) if date_str else _date.today()
    except ValueError:
        return jsonify({"success": False, "error": f"Invalid date: {date_str}"}), 400

    sb = get_supabase_service().client
    gen = MarketDigestGenerator(sb)

    try:
        content = gen.generate(digest_date)
        gen.save_to_supabase(digest_date, content)
        StrategyNotifier(sb).notify_market_digest_ready(str(digest_date))
        return jsonify({"success": True, "date": str(digest_date), "data": content})
    except Exception as e:
        logger.error("[market-digest/generate] Failed: %s", e, exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500
