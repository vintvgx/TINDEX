"""
Yahoo Finance watchlist routes (gainers, losers, trending, most-active).
"""

from flask import Blueprint, jsonify, request

from log.logging_config import get_logger
from services.yfinance.yahoo_watchlist_service import get_yahoo_watchlist_service
from utils.cache import TrendingStocksCache

logger = get_logger(__name__)

bp = Blueprint("yahoo", __name__)

_cache = TrendingStocksCache()
_CACHE_TTL = 90


def _validate_limit(limit: int) -> bool:
    return 1 <= limit <= 100


@bp.route("/yahoo/gainers", methods=["GET"])
def get_yahoo_gainers():
    try:
        limit = request.args.get("limit", default=25, type=int)
        use_cache = request.args.get("use_cache", default="true").lower() == "true"
        if not _validate_limit(limit):
            return jsonify({"success": False, "error": "Limit must be between 1 and 100"}), 400
        cache_key = f"yahoo_gainers_{limit}"
        if use_cache:
            cached = _cache.get(cache_key)
            if cached:
                return jsonify({**cached, "from_cache": True})
        service = get_yahoo_watchlist_service()
        result = service.get_gainers(limit=limit)
        if not result.get("success"):
            return jsonify(result), 500
        _cache.set(cache_key, result, _CACHE_TTL)
        return jsonify({**result, "from_cache": False})
    except Exception as e:
        logger.error("Failed to fetch Yahoo gainers: %s", e, exc_info=True)
        return jsonify({"success": False, "error": f"Failed to fetch gainers: {str(e)}"}), 500


@bp.route("/yahoo/trending", methods=["GET"])
def get_yahoo_trending():
    try:
        limit = request.args.get("limit", default=25, type=int)
        use_cache = request.args.get("use_cache", default="true").lower() == "true"
        if not _validate_limit(limit):
            return jsonify({"success": False, "error": "Limit must be between 1 and 100"}), 400
        cache_key = f"yahoo_trending_{limit}"
        if use_cache:
            cached = _cache.get(cache_key)
            if cached:
                return jsonify({**cached, "from_cache": True})
        service = get_yahoo_watchlist_service()
        result = service.get_trending(limit=limit)
        if not result.get("success"):
            return jsonify(result), 500
        _cache.set(cache_key, result, _CACHE_TTL)
        return jsonify({**result, "from_cache": False})
    except Exception as e:
        logger.error("Failed to fetch Yahoo trending: %s", e, exc_info=True)
        return jsonify({"success": False, "error": f"Failed to fetch trending stocks: {str(e)}"}), 500


@bp.route("/yahoo/most-active", methods=["GET"])
def get_yahoo_most_active():
    try:
        limit = request.args.get("limit", default=25, type=int)
        use_cache = request.args.get("use_cache", default="true").lower() == "true"
        if not _validate_limit(limit):
            return jsonify({"success": False, "error": "Limit must be between 1 and 100"}), 400
        cache_key = f"yahoo_most_active_{limit}"
        if use_cache:
            cached = _cache.get(cache_key)
            if cached:
                return jsonify({**cached, "from_cache": True})
        service = get_yahoo_watchlist_service()
        result = service.get_most_active(limit=limit)
        if not result.get("success"):
            return jsonify(result), 500
        _cache.set(cache_key, result, _CACHE_TTL)
        return jsonify({**result, "from_cache": False})
    except Exception as e:
        logger.error("Failed to fetch Yahoo most active: %s", e, exc_info=True)
        return jsonify({"success": False, "error": f"Failed to fetch most active stocks: {str(e)}"}), 500


@bp.route("/yahoo/losers", methods=["GET"])
def get_yahoo_losers():
    try:
        limit = request.args.get("limit", default=25, type=int)
        use_cache = request.args.get("use_cache", default="true").lower() == "true"
        if not _validate_limit(limit):
            return jsonify({"success": False, "error": "Limit must be between 1 and 100"}), 400
        cache_key = f"yahoo_losers_{limit}"
        if use_cache:
            cached = _cache.get(cache_key)
            if cached:
                return jsonify({**cached, "from_cache": True})
        service = get_yahoo_watchlist_service()
        result = service.get_losers(limit=limit)
        if not result.get("success"):
            return jsonify(result), 500
        _cache.set(cache_key, result, _CACHE_TTL)
        return jsonify({**result, "from_cache": False})
    except Exception as e:
        logger.error("Failed to fetch Yahoo losers: %s", e, exc_info=True)
        return jsonify({"success": False, "error": f"Failed to fetch losers: {str(e)}"}), 500


@bp.route("/watchlist/all", methods=["GET"])
def get_all_yahoo_watchlists():
    try:
        limit = request.args.get("limit", default=25, type=int)
        if not _validate_limit(limit):
            return jsonify({"success": False, "error": "Limit must be between 1 and 100"}), 400
        service = get_yahoo_watchlist_service()
        return jsonify(service.get_all_watchlists(limit=limit))
    except Exception as e:
        logger.error("Failed to fetch all Yahoo watchlists: %s", e, exc_info=True)
        return jsonify({"success": False, "error": f"Failed to fetch watchlists: {str(e)}"}), 500
