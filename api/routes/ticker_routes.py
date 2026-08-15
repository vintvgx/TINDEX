"""
Ticker research, blog generation, ticker updates, and trending stocks routes.
"""

import re
import time
import asyncio
from dataclasses import dataclass, asdict
from typing import Optional

from flask import Blueprint, jsonify, request

from log.logging_config import get_logger
from services.anthropic.anthropic_service import anthropic_service
from services.supabase.supabase_service import get_supabase_service
from services.utils.research_service import get_research_service
from services.utils.blog_generation_service import get_blog_service
from services.yfinance.yfinance_service import get_historical_prices, PERIOD_MAP, get_intraday_chart_for_date
from utils.cache import TrendingStocksCache

import requests as _requests
from bs4 import BeautifulSoup

logger = get_logger(__name__)

bp = Blueprint("ticker", __name__)

_trending_cache = TrendingStocksCache()
_TRENDING_CACHE_TTL = 90


# ── Data classes ────────────────────────────────────────────────────────────────

@dataclass
class RequestData:
    topic: str
    userId: Optional[str]
    save_to_db: Optional[bool] = True
    use_cache: Optional[bool] = True
    research_data: Optional[dict] = None
    target_length: Optional[int] = 800
    ticker: Optional[str] = None
    include_options: Optional[bool] = True


@dataclass
class RequestDataError:
    success: bool
    error: str


# ── Helpers ──────────────────────────────────────────────────────────────────────

def run_async(coro):
    loop = asyncio.new_event_loop()
    try:
        asyncio.set_event_loop(loop)
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def validate_and_create_ticker_request_data(
    data: dict, ticker: str, require_user_id: bool = True
) -> tuple[RequestData | None, RequestDataError | None]:
    try:
        request_data = RequestData(
            topic=ticker,
            userId=data.get("userId"),
            save_to_db=data.get("save_to_db", True),
            use_cache=data.get("use_cache", True),
            research_data=data.get("research_data", {}),
            target_length=data.get("target_length", 800),
            ticker=ticker,
        )
        if require_user_id and not request_data.userId:
            return None, RequestDataError(success=False, error="User ID must be a non-empty string")
        return request_data, None
    except Exception as e:
        return None, RequestDataError(success=False, error=f"Invalid request data: {str(e)}")


def log_request_data(request_data: RequestData | None, endpoint: str):
    if request_data is None:
        logger.info("Nothing contained in Request")
    else:
        logger.info(
            "Request to %s: topic=%s, userId=%s, save_to_db=%s, use_cache=%s",
            endpoint, request_data.topic, request_data.userId,
            request_data.save_to_db, request_data.use_cache,
        )


# ── Routes ────────────────────────────────────────────────────────────────────────

@bp.route("/ticker/<ticker>", methods=["POST"])
def get_ticker_data(ticker: str):
    try:
        ticker = ticker.strip().upper()
        if not ticker or not re.match(r"^[A-Z0-9]{1,5}$", ticker):
            return jsonify({"success": False, "error": "Invalid ticker symbol format. Must be 1-5 alphanumeric characters."}), 400

        data = request.get_json()
        service = get_supabase_service()
        research_service = get_research_service()

        request_data, error_response = validate_and_create_ticker_request_data(data or {}, ticker=ticker)
        if error_response:
            return jsonify(asdict(error_response)), 400

        log_request_data(request_data, "get_ticker_data")
        if request_data is not None:
            service.verify_user(user_id=request_data.userId)
            research_result = research_service.get_research_data(
                ticker=ticker,
                use_cache=request_data.use_cache,
                save_to_db=request_data.save_to_db,
                include_options=request_data.include_options,
            )
            if not research_result["success"]:
                return jsonify(research_result), 400

        return jsonify(research_result)

    except Exception as e:
        logger.error("Ticker research failed for ticker '%s': %s", ticker, e, exc_info=True)
        return jsonify({"success": False, "error": f"Research failed: {str(e)}"}), 500


@bp.route("/ticker/<ticker>/history", methods=["POST"])
def get_ticker_history(ticker: str):
    try:
        ticker = ticker.strip().upper()
        if not ticker or not re.match(r"^[A-Z0-9]{1,5}$", ticker):
            return jsonify({"success": False, "error": "Invalid ticker symbol format. Must be 1-5 alphanumeric characters."}), 400

        data = request.get_json() or {}
        period = data.get("period", "1M")
        if period not in PERIOD_MAP:
            return jsonify({"success": False, "error": f"Invalid period. Must be one of: {', '.join(PERIOD_MAP.keys())}"}), 400

        historical_data = get_historical_prices(ticker, period)

        return jsonify({"success": True, "data": historical_data, "period": period, "timestamp": time.time(), "from_cache": False})

    except Exception as e:
        logger.error("Ticker history fetch failed for ticker '%s': %s", ticker, e, exc_info=True)
        return jsonify({"success": False, "error": f"History fetch failed: {str(e)}"}), 500


@bp.route("/ticker/<ticker>/history-date", methods=["POST"])
def get_ticker_history_for_date(ticker: str):
    """
    Intraday OHLCV + VWAP + RSI(14) for one specific past calendar day — used
    by the Daily Review's per-trade chart (see ReviewTradeChart.tsx) so a
    trade card can show the actual price/volume/RSI/VWAP action around its
    entry/exit, not just the logged numbers.

    yfinance only serves intraday bars for a limited lookback window (roughly
    60 days for 5-minute bars) — a request for an older date comes back with
    "available": False rather than an error; the client shows a graceful
    "chart unavailable" state for those instead of treating it as a failure.
    """
    date_str = "?"
    try:
        ticker = ticker.strip().upper()
        if not ticker or not re.match(r"^[A-Z0-9]{1,5}$", ticker):
            return jsonify({"success": False, "error": "Invalid ticker symbol format. Must be 1-5 alphanumeric characters."}), 400

        data = request.get_json() or {}
        date_str = data.get("date", "")
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", date_str):
            return jsonify({"success": False, "error": "date must be YYYY-MM-DD"}), 400

        chart = get_intraday_chart_for_date(ticker, date_str)
        return jsonify({"success": True, "data": chart, "date": date_str})

    except Exception as e:
        logger.error("Intraday chart fetch failed for ticker '%s' on %s: %s", ticker, date_str, e, exc_info=True)
        return jsonify({"success": False, "error": f"Chart fetch failed: {str(e)}"}), 500


@bp.route("/search/<ticker>", methods=["POST"])
def search_for_ticker(ticker: str):
    try:
        ticker = ticker.strip().upper()
        if not ticker or not re.match(r"^[A-Z0-9]{1,5}$", ticker):
            return jsonify({"success": False, "error": "Ticker does not match format"}), 404
        research_service = get_research_service()
        return jsonify(research_service.get_ticker_search(ticker))
    except Exception as e:
        logger.error("Ticker research failed for ticker '%s': %s", ticker, e, exc_info=True)
        return jsonify({"success": False, "data": None, "error": f"Ticker not found: {str(e)}"}), 404


@bp.route("/generate_post/<ticker>", methods=["POST"])
def generate_post(ticker: str):
    try:
        ticker = ticker.strip().upper()
        if not ticker or not re.match(r"^[A-Z0-9]{1,5}$", ticker):
            return jsonify({"success": False, "error": "Invalid ticker symbol format. Must be 1-5 alphanumeric characters."}), 400

        data = request.get_json()
        service = get_supabase_service()
        research_service = get_research_service()
        blog_service = get_blog_service()

        request_data, error_response = validate_and_create_ticker_request_data(data or {}, ticker=ticker)
        if error_response:
            return jsonify(asdict(error_response)), 400

        log_request_data(request_data, "generate_post")
        assert request_data is not None

        service.verify_user(user_id=request_data.userId)

        research_result = None
        research_data = None
        research_id = None
        used_cache = False

        if request_data.research_data:
            research_data = request_data.research_data
            logger.info("Using provided research data for %s", ticker)
        else:
            research_result = research_service.get_research_data(
                ticker=ticker,
                use_cache=request_data.use_cache,
                save_to_db=request_data.save_to_db,
            )
            if not research_result["success"]:
                return jsonify(research_result), 400
            research_data = research_result["data"]
            research_id = research_result.get("research_id")
            used_cache = research_result.get("cached", False)

        blog_result = blog_service.generate_blog_post(
            ticker=ticker,
            research_data=research_data,
            save_to_db=request_data.save_to_db,
            research_id=research_id,
            target_length=request_data.target_length or 800,
        )
        if not blog_result["success"]:
            return jsonify(blog_result), 400

        return jsonify({
            "success": True,
            "data": blog_result["data"],
            "blog_id": blog_result.get("blog_id"),
            "research_id": research_id,
            "research_cached": used_cache,
            "blog_saved": blog_result.get("saved", False),
            "timestamp": time.time(),
        })

    except Exception as e:
        _topic = locals().get("topic") or (locals().get("data") or {}).get("topic") or "<unknown>"
        logger.error("Blog generation failed for topic '%s': %s", _topic, e, exc_info=True)
        return jsonify({"success": False, "error": f"Blog generation failed: {str(e)}"}), 500


@bp.route("/generate_ticker_update/<ticker>", methods=["POST"])
def generate_ticker_update(ticker: str):
    try:
        ticker = ticker.strip().upper()
        if not ticker or not re.match(r"^[A-Z0-9]{1,5}$", ticker):
            return jsonify({"success": False, "error": "Invalid ticker symbol format. Must be 1-5 alphanumeric characters."}), 400

        request_data_raw = request.get_json() or {}
        target_length = request_data_raw.get("target_length", 500)
        if not isinstance(target_length, int) or target_length < 50 or target_length > 500:
            target_length = 500

        research_service = get_research_service()
        research_result = research_service.get_research_data(ticker=ticker, use_cache=False, save_to_db=True)
        if not research_result.get("success"):
            return jsonify({"success": False, "error": research_result.get("error", "Failed to retrieve research data"), "ticker": ticker}), 500

        research_data = research_result
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            result = loop.run_until_complete(
                anthropic_service.generate_ticker_update(research_data=research_data, target_length=target_length, ticker=ticker)
            )
        finally:
            loop.close()

        if not result.get("success", True):
            error_details = result.get("error_details", {})
            error_type = error_details.get("type", "unknown_error")
            status_code = error_details.get("status_code", 500)
            if error_type == "not_found_error" or status_code == 404:
                http_status = 404
            elif error_type in ("connection_error", "timeout_error"):
                http_status = 503
            elif status_code in [400, 401, 403, 429]:
                http_status = status_code
            else:
                http_status = 500
            logger.error("Ticker update generation failed for %s: %s (HTTP %s)", ticker, result.get("error"), http_status)
            return jsonify(result), http_status

        ticker_update_id = None
        try:
            service = get_supabase_service()
            stock_research_id = (
                research_result.get("research_id")
                or research_data.get("research_id")
                or research_data.get("id")
            )
            save_result = service.save_ticker_update({
                "ticker": ticker,
                "content": result.get("content", ""),
                "character_count": result.get("character_count", 0),
                "tags": result.get("tags", []),
                "model_used": result.get("model_used", "claude-haiku-4-5"),
                "target_length": target_length,
                "stock_research_id": stock_research_id,
                "status": "published",
            })
            if save_result.get("success"):
                ticker_update_id = save_result.get("data", {}).get("id")
        except Exception as save_error:
            logger.error("Error saving ticker update for %s: %s", ticker, save_error, exc_info=True)

        response = result.copy()
        response["ticker_update_id"] = ticker_update_id
        response["saved"] = ticker_update_id is not None
        return jsonify(response), 200

    except Exception as e:
        logger.error("Ticker update generation failed for %s: %s", ticker, e, exc_info=True)
        return jsonify({"success": False, "error": f"Ticker update generation failed: {str(e)}", "ticker": ticker}), 500


@bp.route("/trending-stocks-sort", methods=["GET", "POST"])
def get_trending_stocks_by_param():
    try:
        if request.method == "GET":
            sort_by = request.args.get("sort_by")
        else:
            sort_by = (request.get_json() or {}).get("sort_by")

        if not sort_by:
            return jsonify({"success": False, "error": "sort_by parameter is required"}), 400

        valid_sort_params = ["volume", "change", "pe", "marketcap"]
        if sort_by not in valid_sort_params:
            return jsonify({"success": False, "error": f'Invalid sort_by parameter. Must be one of: {", ".join(valid_sort_params)}'}), 400

        cache_key = f"trending_stocks_{sort_by}"
        cached_data = _trending_cache.get(cache_key)
        if cached_data:
            logger.info("Returning cached trending stocks data for sort_by: %s", sort_by)
            return jsonify({**cached_data, "from_cache": True})

        logger.info("Fetching trending stocks from FINVIZ, sorted by: %s", sort_by)
        url = f"https://finviz.com/screener.ashx?v=111&o=-{sort_by}"
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (HTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"}

        resp = _requests.get(url, headers=headers, timeout=60)
        resp.raise_for_status()

        soup = BeautifulSoup(resp.content, "html.parser")
        stocks = []
        table = soup.find("table", {"class": "screener_table"})
        if table:
            for row in table.find_all("tr")[1:][:20]:
                cells = row.find_all("td")
                if len(cells) >= 11:
                    try:
                        stocks.append({
                            "ticker": cells[1].text.strip(), "company": cells[2].text.strip(),
                            "sector": cells[3].text.strip(), "industry": cells[4].text.strip(),
                            "market_cap": cells[6].text.strip(), "pe": cells[7].text.strip(),
                            "price": cells[8].text.strip(), "change": cells[9].text.strip(),
                            "volume": cells[10].text.strip(),
                        })
                    except (IndexError, AttributeError) as e:
                        logger.warning("Error parsing stock row: %s", e)

        response_data = {"success": True, "sorted_by": sort_by, "data": stocks, "count": len(stocks), "source": "FINVIZ", "timestamp": int(time.time() * 1000)}
        _trending_cache.set(cache_key, response_data, _TRENDING_CACHE_TTL)
        return jsonify({**response_data, "from_cache": False})

    except _requests.RequestException as e:
        logger.error("Request failed when fetching trending stocks: %s", e)
        return jsonify({"success": False, "error": f"Failed to fetch data by {sort_by}, from FINVIZ: {str(e)}"}), 503
    except Exception as e:
        logger.error("Trending stocks failed: %s", e, exc_info=True)
        return jsonify({"success": False, "code": "UPSTREAM_FETCH_FAILED", "error": "Unable to fetch trending stocks at this time"}), 500
