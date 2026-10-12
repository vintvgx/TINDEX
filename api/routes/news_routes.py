import logging

from flask import Blueprint, jsonify

from services.news.market_news import get_market_news

logger = logging.getLogger(__name__)

news_bp = Blueprint("news", __name__)


@news_bp.route("/market-news", methods=["GET"])
def market_news():
    """General market news for the Home card's headlines — Finnhub
    general_news, newest first, ≤20, cached 15 min:
    {success, data: [{headline, source, url, image, published_at}]}."""
    try:
        return jsonify({"success": True, "data": get_market_news()})
    except Exception as e:
        logger.error("[market-news] %s", e, exc_info=True)
        return jsonify({"success": False, "error": str(e), "data": []}), 500
