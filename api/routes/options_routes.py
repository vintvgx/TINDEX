"""
Options chain, contract tracking, and suggested contracts routes.
"""

import re
import time
import asyncio
from datetime import datetime

from flask import Blueprint, jsonify, request

from log.logging_config import get_logger
from services.supabase.supabase_service import get_supabase_service
from services.utils.research_service import get_research_service

logger = get_logger(__name__)

bp = Blueprint("options", __name__)


def _run_async(coro):
    loop = asyncio.new_event_loop()
    try:
        asyncio.set_event_loop(loop)
        return loop.run_until_complete(coro)
    finally:
        loop.close()


@bp.route("/options/<ticker>", methods=["GET"])
def get_options(ticker: str):
    try:
        ticker = ticker.strip().upper()
        if not ticker or not re.match(r"^[A-Z0-9]{1,5}$", ticker):
            return jsonify({"success": False, "error": "Invalid ticker symbol format. Must be 1-5 alphanumeric characters.", "ticker": ticker}), 400

        feed = request.args.get("feed", "indicative")
        limit = request.args.get("limit", 100, type=int)
        strike_price_gte = request.args.get("strike_price_gte", type=float)
        strike_price_lte = request.args.get("strike_price_lte", type=float)
        expiration_date_gte = request.args.get("expiration_date_gte")
        expiration_date_lte = request.args.get("expiration_date_lte")

        if feed and feed not in ("indicative", "opra"):
            logger.warning("Invalid feed '%s' for %s — defaulting to indicative", feed, ticker)
            feed = "indicative"
        if limit < 1 or limit > 500:
            return jsonify({"success": False, "error": "Limit must be between 1 and 500", "ticker": ticker}), 400

        for field, value in [("expiration_date_gte", expiration_date_gte), ("expiration_date_lte", expiration_date_lte)]:
            if value:
                try:
                    datetime.strptime(value, "%Y-%m-%d")
                except ValueError:
                    return jsonify({"success": False, "error": f"Invalid {field} format. Must be 'YYYY-MM-DD'", "ticker": ticker}), 400

        from services.alpaca.alpaca_option_service import get_alpaca_option_service
        result = _run_async(
            get_alpaca_option_service().get_options(
                ticker=ticker,
                feed=feed,
                limit=limit,
                strike_price_gte=strike_price_gte,
                strike_price_lte=strike_price_lte,
                expiration_date_gte=expiration_date_gte,
                expiration_date_lte=expiration_date_lte,
            )
        )
        return jsonify({"success": True, "data": result, "timestamp": time.time()})

    except ValueError as e:
        logger.error("Validation error for options request %s: %s", ticker, e, exc_info=True)
        return jsonify({"success": False, "error": str(e), "ticker": ticker}), 400
    except Exception as e:
        logger.error("Options retrieval failed for %s: %s", ticker, e, exc_info=True)
        return jsonify({"success": False, "error": f"Options retrieval failed: {str(e)}", "ticker": ticker}), 500


@bp.route("/track-option", methods=["POST"])
def track_option():
    try:
        data = request.get_json()
        if not data:
            return jsonify({"success": False, "error": "Request body is required"}), 400

        user_id = data.get("userId")
        if not user_id:
            return jsonify({"success": False, "error": "userId is required"}), 400

        ticker = data.get("ticker", "").strip().upper()
        if not ticker or not re.match(r"^[A-Z0-9]{1,5}$", ticker):
            return jsonify({"success": False, "error": "Invalid ticker symbol format"}), 400

        service = get_supabase_service()
        service.verify_user(user_id=user_id)

        contract_symbol = data.get("contractSymbol", "")
        tracking_snapshot = data.get("trackingSnapshot", {})

        if not tracking_snapshot and contract_symbol:
            logger.info("[track-option] No snapshot provided for %s — attempting Alpaca auto-fetch", contract_symbol)
            try:
                from services.alpaca.alpaca_option_service import get_alpaca_option_service
                raw = _run_async(get_alpaca_option_service().get_contract_snapshot(contract_symbol))
                if raw:
                    bid = raw.get("bid") or 0.0
                    ask = raw.get("ask") or 0.0
                    tracking_snapshot = {
                        "ask": ask,
                        "bid": bid,
                        "contractSymbol": contract_symbol,
                        "delta": raw.get("delta"),
                        "dte": 0,
                        "expirationDate": raw.get("expiration", data.get("expirationDate", "")),
                        "extrinsicValue": 0,
                        "gamma": raw.get("gamma"),
                        "impliedVolatility": raw.get("implied_volatility") or 0,
                        "intrinsicValue": 0,
                        "lastPrice": raw.get("last_price"),
                        "mark": (bid + ask) / 2 if (bid > 0 or ask > 0) else 0,
                        "moneyness": 0,
                        "openInterest": raw.get("open_interest") or 0,
                        "optionType": raw.get("option_type", data.get("optionType", "").upper()),
                        "reasons": "",
                        "signal": "CONSIDER",
                        "spreadPct": ((ask - bid) / ask * 100) if ask > 0 else 0,
                        "theta": raw.get("theta"),
                        "total_score": 0,
                        "vega": raw.get("vega"),
                        "volume": raw.get("volume") or 0,
                    }
                    logger.info("[track-option] Alpaca snapshot OK for %s", contract_symbol)
                else:
                    logger.warning("[track-option] Alpaca returned no snapshot for %s", contract_symbol)
            except Exception as snap_err:
                logger.warning("[track-option] Auto-fetch failed for %s: %s", contract_symbol, snap_err, exc_info=True)

        contract_data = {
            "ticker": ticker,
            "contract_symbol": contract_symbol,
            "option_type": data.get("optionType", "").upper(),
            "strike": data.get("strike"),
            "expiration_date": data.get("expirationDate"),
            "tracking_snapshot": tracking_snapshot,
            "tracked_from_source": data.get("trackedFromSource", "manual"),
            "orb_breakout_id": data.get("orbBreakoutId"),
            "initial_analysis_score": data.get("initialAnalysisScore"),
            "tracking_reason": data.get("trackingReason"),
        }

        result = service.track_option_contract(user_id, contract_data)
        return jsonify(result), 200 if result.get("success") else 400

    except Exception as e:
        logger.error("Failed to track option contract: %s", e, exc_info=True)
        return jsonify({"success": False, "error": f"Failed to track contract: {str(e)}"}), 500


@bp.route("/tracked-options", methods=["GET"])
def get_tracked_options():
    try:
        user_id = request.args.get("userId")
        if not user_id:
            return jsonify({"success": False, "error": "userId query parameter is required"}), 400
        service = get_supabase_service()
        service.verify_user(user_id=user_id)
        result = service.get_tracked_contracts(user_id, request.args.get("status"))
        return jsonify(result), 200
    except Exception as e:
        logger.error("Failed to get tracked options: %s", e, exc_info=True)
        return jsonify({"success": False, "error": f"Failed to get tracked contracts: {str(e)}"}), 500


@bp.route("/track-option/<contract_id>", methods=["PUT"])
def update_tracked_option(contract_id: str):
    try:
        data = request.get_json()
        if not data:
            return jsonify({"success": False, "error": "Request body is required"}), 400

        user_id = data.get("userId")
        if not user_id:
            return jsonify({"success": False, "error": "userId is required"}), 400

        status = data.get("status")
        if status not in ("entered", "exited", "cancelled"):
            return jsonify({"success": False, "error": "status must be 'entered', 'exited', or 'cancelled'"}), 400

        service = get_supabase_service()
        service.verify_user(user_id=user_id)
        result = service.update_contract_status(
            user_id=user_id,
            contract_id=contract_id,
            status=status,
            entry_price=data.get("entryPrice"),
            exit_price=data.get("exitPrice"),
            position_size=data.get("positionSize"),
        )
        return jsonify(result), 200 if result.get("success") else 400

    except Exception as e:
        logger.error("Failed to update tracked option: %s", e, exc_info=True)
        return jsonify({"success": False, "error": f"Failed to update contract: {str(e)}"}), 500


@bp.route("/track-option/<contract_id>/alerts", methods=["PATCH"])
def update_tracked_option_alerts(contract_id: str):
    """
    Set per-contract entered-position alert threshold overrides. Independent
    of the status PUT above — can be called any time; only takes effect once
    the contract is 'entered' (see OptionsContractMonitorService). Body keys
    map 1:1 to the alert_* columns; a null value resets that tier to the
    25/50/100 default.
    Body: { userId, gain25?, gain50?, gain100?, loss25?, loss50?, loss100? }
    """
    try:
        data = request.get_json()
        if not data:
            return jsonify({"success": False, "error": "Request body is required"}), 400

        user_id = data.get("userId")
        if not user_id:
            return jsonify({"success": False, "error": "userId is required"}), 400

        field_map = {
            "gain25": "alert_gain_25", "gain50": "alert_gain_50", "gain100": "alert_gain_100",
            "loss25": "alert_loss_25", "loss50": "alert_loss_50", "loss100": "alert_loss_100",
        }
        thresholds = {
            col: data[key] for key, col in field_map.items() if key in data
        }
        if not thresholds:
            return jsonify({"success": False, "error": "No threshold fields provided"}), 400

        service = get_supabase_service()
        service.verify_user(user_id=user_id)
        result = service.update_contract_alert_thresholds(user_id, contract_id, thresholds)
        return jsonify(result), 200 if result.get("success") else 400

    except Exception as e:
        logger.error("Failed to update alert thresholds: %s", e, exc_info=True)
        return jsonify({"success": False, "error": f"Failed to update alert thresholds: {str(e)}"}), 500


@bp.route("/track-option/<contract_id>", methods=["DELETE"])
def delete_tracked_option(contract_id: str):
    try:
        user_id = request.args.get("userId")
        if not user_id:
            return jsonify({"success": False, "error": "userId query parameter is required"}), 400
        service = get_supabase_service()
        service.verify_user(user_id=user_id)
        result = service.delete_tracked_contract(user_id=user_id, contract_id=contract_id)
        return jsonify(result), 200 if result.get("success") else 400
    except Exception as e:
        logger.error("Failed to delete tracked option: %s", e, exc_info=True)
        return jsonify({"success": False, "error": f"Failed to delete contract: {str(e)}"}), 500


@bp.route("/suggested-contracts/<ticker>", methods=["GET"])
def get_suggested_contracts(ticker: str):
    try:
        ticker = ticker.strip().upper()
        if not ticker or not re.match(r"^[A-Z0-9]{1,5}$", ticker):
            return jsonify({"success": False, "error": "Invalid ticker symbol format"}), 400

        limit = min(max(request.args.get("limit", 5, type=int), 1), 10)
        research_service = get_research_service()
        research_result = research_service.get_research_data(ticker=ticker, use_cache=True, save_to_db=False, include_options=True)

        if not research_result.get("success"):
            return jsonify({"success": False, "error": "Failed to fetch ticker data", "details": research_result.get("error")}), 400

        options_analysis = research_result.get("data", {}).get("options_analysis", {})
        if not options_analysis or not options_analysis.get("has_opportunities"):
            return jsonify({"success": False, "error": f"No options opportunities available for {ticker}", "data": {"ticker": ticker, "contracts": [], "count": 0}}), 404

        sorted_ops = sorted(options_analysis.get("opportunities", []), key=lambda x: x.get("total_score", 0), reverse=True)[:limit]
        return jsonify({"success": True, "data": {"ticker": ticker, "contracts": sorted_ops, "count": len(sorted_ops)}, "timestamp": time.time()}), 200

    except Exception as e:
        logger.error("Failed to get suggested contracts for %s: %s", ticker, e, exc_info=True)
        return jsonify({"success": False, "error": f"Failed to get suggested contracts: {str(e)}", "ticker": ticker}), 500
