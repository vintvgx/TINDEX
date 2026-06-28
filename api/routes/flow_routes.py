"""
Unusual Whales option flow alert routes.
"""

import re

from flask import Blueprint, jsonify, request

from log.logging_config import get_logger
from services.unusual_whales.unusual_whales_service import get_unusual_whales_service

logger = get_logger(__name__)

bp = Blueprint("flow", __name__)


@bp.route("/flow-alerts", methods=["GET"])
def get_global_flow_alerts():
    try:
        limit = min(int(request.args.get("limit", 50)), 200)
        service = get_unusual_whales_service()
        alerts = service.get_flow_alerts(limit=limit)
        return jsonify({"success": True, "data": alerts, "available": service._available()})
    except Exception as exc:
        logger.error("[/flow-alerts] %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 500


@bp.route("/flow-alerts/<ticker>", methods=["GET"])
def get_ticker_flow_alerts(ticker: str):
    try:
        ticker = ticker.strip().upper()
        if not ticker or not re.match(r"^[A-Z0-9]{1,5}$", ticker):
            return jsonify({"success": False, "error": "Invalid ticker symbol"}), 400
        limit = min(int(request.args.get("limit", 50)), 200)
        service = get_unusual_whales_service()
        alerts = service.get_ticker_flow_alerts(ticker, limit=limit)
        return jsonify({"success": True, "ticker": ticker, "data": alerts, "available": service._available()})
    except Exception as exc:
        logger.error("[/flow-alerts/%s] %s", ticker, exc)
        return jsonify({"success": False, "error": str(exc)}), 500
