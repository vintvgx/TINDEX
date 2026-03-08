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

    Uses yf.download with period="5d" so we get the latest available close even when
    the market is closed (e.g. weekend). Single-ticker and multi-ticker responses have
    different shapes; both are handled.

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
            period="5d",
            group_by="ticker" if len(tickers) > 1 else None,
            progress=False,
            threads=False,
            auto_adjust=True,
        )

        if data.empty:
            logger.warning("yf.download returned empty DataFrame for tickers=%s", tickers)
            return _fallback_fetch_prices(tickers)

        prices: dict[str, float] = {}

        if len(tickers) == 1:
            # Single ticker: flat columns ["Close", ...] or MultiIndex (ticker, "Close")
            close_series = _get_close_series_single(data, tickers[0])
            if close_series is not None:
                last = close_series.iloc[-1]
                if last is not None and not pd.isna(last):
                    prices[tickers[0]] = float(last)
        else:
            for ticker in tickers:
                try:
                    close_series = data[ticker]["Close"]
                    last = close_series.iloc[-1]
                    if last is not None and not pd.isna(last):
                        prices[ticker] = float(last)
                except (KeyError, IndexError, TypeError) as e:
                    logger.warning("No price data for %s: %s", ticker, e)

        if not prices and tickers:
            return _fallback_fetch_prices(tickers)
        return prices

    except Exception as e:
        logger.error("Batch price fetch failed: %s", e, exc_info=True)
        return _fallback_fetch_prices(tickers)


def _get_close_series_single(data: pd.DataFrame, ticker: str):
    """Get Close series for single-ticker download; handle flat or MultiIndex columns."""
    if "Close" in data.columns:
        return data["Close"]
    if isinstance(data.columns, pd.MultiIndex):
        try:
            return data[ticker]["Close"]
        except (KeyError, TypeError):
            pass
    return None


def _fallback_fetch_prices(tickers: list[str]) -> dict[str, float]:
    """Fetch price per ticker via Ticker().info when batch download returns nothing."""
    prices: dict[str, float] = {}
    for ticker in tickers:
        try:
            t = yf.Ticker(ticker)
            info = t.info
            price = info.get("currentPrice") or info.get("regularMarketPrice")
            if price is not None and not (isinstance(price, float) and pd.isna(price)):
                prices[ticker] = float(price)
        except Exception as e:
            logger.warning("Fallback price fetch failed for %s: %s", ticker, e)
    return prices


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
    if avg_cost > 0:
        price_delta = avg_cost - current_price if position_type == "short" else current_price - avg_cost
        pnl_pct = price_delta / avg_cost * 100
    else:
        pnl_pct = 0.0

    return {
        "unrealized_pnl": round(float(unrealized), 4),
        "current_value": round(float(current_value), 4),
        "cost_basis": round(float(cost_basis), 4),
        "pnl_pct": round(float(pnl_pct), 4),
        "current_price": round(float(current_price), 4),
    }
