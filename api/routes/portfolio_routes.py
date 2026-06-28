"""
Portfolio refresh and metrics routes.
"""

import time

from flask import Blueprint, jsonify, request

from log.logging_config import get_logger
from services.supabase.supabase_service import get_supabase_service
from services.portfolio.portfolio_service import (
    batch_fetch_current_prices,
    calculate_position_pnl,
)

logger = get_logger(__name__)

bp = Blueprint("portfolio", __name__)


@bp.route("/portfolio/refresh-prices", methods=["POST"])
def refresh_portfolio_prices():
    try:
        data = request.get_json() or {}
        user_id = data.get("userId")
        if not user_id:
            return jsonify({"success": False, "error": "userId required"}), 400

        service = get_supabase_service()
        service.verify_user(user_id=user_id)

        result = (
            service.client.table("portfolio_positions")
            .select("id, ticker, shares, average_cost, position_type")
            .eq("user_id", user_id)
            .eq("status", "open")
            .execute()
        )

        positions = result.data or []
        if not positions:
            return jsonify({"success": True, "positions": [], "summary": None})

        tickers = list({p["ticker"] for p in positions})
        prices = batch_fetch_current_prices(tickers)
        if not prices:
            return jsonify({"success": False, "error": "Could not fetch market prices"}), 502

        enriched_positions = []
        total_cost_basis = 0.0
        total_current_value = 0.0
        total_unrealized = 0.0

        for pos in positions:
            current_price = prices.get(pos["ticker"])
            if current_price is None:
                enriched_positions.append({**pos, "current_price": None, "unrealized_pnl": None, "current_value": None, "cost_basis": None, "pnl_pct": None})
                continue
            pnl = calculate_position_pnl(
                shares=float(pos["shares"]),
                avg_cost=float(pos["average_cost"]),
                current_price=current_price,
                position_type=pos.get("position_type") or "long",
            )
            total_cost_basis += pnl["cost_basis"]
            total_current_value += pnl["current_value"]
            total_unrealized += pnl["unrealized_pnl"]
            enriched_positions.append({**pos, **pnl})

        performance_pct = (
            (total_current_value - total_cost_basis) / total_cost_basis * 100
            if total_cost_basis > 0 else 0.0
        )

        positions_with_price = len([p for p in enriched_positions if p.get("current_price") is not None])
        service.client.table("portfolio").upsert(
            {
                "user_id": user_id,
                "total_cost_basis": round(total_cost_basis, 4),
                "total_current_value": round(total_current_value, 4),
                "total_unrealized_pnl": round(total_unrealized, 4),
                "performance_pct": round(performance_pct, 4),
                "positions_count": positions_with_price,
            },
            on_conflict="user_id",
        ).execute()

        return jsonify({
            "success": True,
            "positions": enriched_positions,
            "summary": {
                "total_cost_basis": round(total_cost_basis, 4),
                "total_current_value": round(total_current_value, 4),
                "total_unrealized_pnl": round(total_unrealized, 4),
                "performance_pct": round(performance_pct, 4),
            },
        })

    except Exception as e:
        logger.error("Portfolio refresh failed: %s", e, exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route("/portfolio-metrics", methods=["GET"])
def get_portfolio_metrics():
    try:
        user_id = request.args.get("userId")
        if not user_id:
            return jsonify({"success": False, "error": "userId query parameter is required"}), 400

        service = get_supabase_service()
        service.verify_user(user_id=user_id)

        result = service.get_tracked_contracts(user_id, status_filter=None)
        if not result.get("success"):
            return jsonify(result), 400

        contracts = result.get("data", [])
        total_contracts = len(contracts)
        active_contracts = len([c for c in contracts if c.get("status") in ["tracking", "entered"]])

        entered_contracts = [c for c in contracts if c.get("status") == "entered"]
        total_cost_basis = sum(
            (c.get("entry_price") or 0) * (c.get("position_size") or 1)
            for c in entered_contracts
        )
        total_current_value = total_cost_basis

        ticker_exposure = {}
        for contract in contracts:
            ticker = contract.get("ticker", "")
            if not ticker:
                continue
            if ticker not in ticker_exposure:
                ticker_exposure[ticker] = {"ticker": ticker, "contractCount": 0, "totalCostBasis": 0, "unrealizedPnL": 0, "unrealizedPnLPercent": 0}
            ticker_exposure[ticker]["contractCount"] += 1
            if contract.get("status") == "entered":
                ticker_exposure[ticker]["totalCostBasis"] += (contract.get("entry_price") or 0) * (contract.get("position_size") or 1)

        risk_exposure = list(ticker_exposure.values())
        for exposure in risk_exposure:
            exposure["exposurePercent"] = (exposure["totalCostBasis"] / total_cost_basis * 100) if total_cost_basis > 0 else 0
        risk_exposure.sort(key=lambda x: x["totalCostBasis"], reverse=True)

        return jsonify({
            "success": True,
            "data": {
                "totalContracts": total_contracts,
                "activeContracts": active_contracts,
                "totalUnrealizedPnL": 0,
                "totalUnrealizedPnLPercent": 0,
                "totalCostBasis": total_cost_basis,
                "totalCurrentValue": total_current_value,
                "riskExposure": risk_exposure,
            },
            "timestamp": time.time(),
        }), 200

    except Exception as e:
        logger.error("Failed to get portfolio metrics: %s", e, exc_info=True)
        return jsonify({"success": False, "error": f"Failed to get portfolio metrics: {str(e)}"}), 500
