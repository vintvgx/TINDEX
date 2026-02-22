"""
Portfolio service: batch price fetch and P&L calculation for portfolio positions.

Uses yfinance batch download for current prices; computes unrealized P&L per position
and aggregates for portfolio summary. Keeps price logic server-side (no API keys on client).
"""

import pandas as pd
import yfinance as yf
from log.logging_config import get_logger

logger = get_logger(__name__)


def batch_fetch_current_prices(tickers: list[str]) -> dict[str, float]:
    """
    Fetch current (latest close) prices for multiple tickers in a single yfinance call.

    Uses yf.download with period="1d" for one HTTP request for all tickers.
    Single-ticker and multi-ticker responses have different shapes; both are handled.

    Args:
        tickers: List of ticker symbols (e.g. ["AAPL", "TSLA"]).

    Returns:
        Dict mapping ticker -> latest close price. Missing/failed tickers are omitted.
    """
    if not tickers:
        return {}

    try:
        data = yf.download(
            tickers,
            period="1d",
            group_by="ticker" if len(tickers) > 1 else None,
            progress=False,
            threads=False,
        )

        if data.empty:
            return {}

        prices: dict[str, float] = {}

        if len(tickers) == 1:
            # Single ticker: columns are ["Open", "High", "Low", "Close", ...], no ticker level
            close_series = data["Close"] if "Close" in data.columns else None
            if close_series is not None:
                last = close_series.iloc[-1]
                if last is not None and not pd.isna(last):
                    prices[tickers[0]] = float(last)
        else:
            # Multi ticker with group_by="ticker": columns are (ticker, "Close") -> data[ticker]["Close"]
            for ticker in tickers:
                try:
                    close_series = data[ticker]["Close"]
                    last = close_series.iloc[-1]
                    if last is not None and not pd.isna(last):
                        prices[ticker] = float(last)
                except (KeyError, IndexError, TypeError) as e:
                    logger.warning("No price data for %s: %s", ticker, e)

        return prices

    except Exception as e:
        logger.error("Batch price fetch failed: %s", e, exc_info=True)
        return {}


def calculate_position_pnl(
    shares: float,
    avg_cost: float,
    current_price: float,
    position_type: str,
) -> dict:
    """
    Compute unrealized P&L and related metrics for a single position.

    Args:
        shares: Number of shares.
        avg_cost: Average cost per share.
        current_price: Current market price per share.
        position_type: "long" or "short".

    Returns:
        Dict with unrealized_pnl, current_value, cost_basis, pnl_pct, current_price.
    """
    if position_type == "short":
        unrealized = (avg_cost - current_price) * shares
    else:
        unrealized = (current_price - avg_cost) * shares

    cost_basis = avg_cost * shares
    current_value = current_price * shares
    pnl_pct = ((current_price - avg_cost) / avg_cost * 100) if avg_cost > 0 else 0.0

    return {
        "unrealized_pnl": round(float(unrealized), 4),
        "current_value": round(float(current_value), 4),
        "cost_basis": round(float(cost_basis), 4),
        "pnl_pct": round(float(pnl_pct), 4),
        "current_price": round(float(current_price), 4),
    }
