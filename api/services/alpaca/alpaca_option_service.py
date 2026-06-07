"""
Alpaca Options Service

Fetches options chain snapshots from Alpaca using the alpaca-py SDK.
Each snapshot contains: latestQuote (bid/ask), latestTrade (last price),
dailyBar (volume/OHLC), prevDailyBar, minuteBar.
Greeks and IV are only available on the paid OPRA feed.

OCC symbol format: TICKER + YYMMDD + C/P + 8-digit strike (strike * 1000, zero-padded)
Example: IWM260427P00267000 → IWM, 2026-04-27, PUT, $267.00
"""

import asyncio
import os
import logging
from typing import Dict, Optional, List, Callable
from datetime import datetime, timedelta, date
from decimal import Decimal

from alpaca.data.historical import OptionHistoricalDataClient
from alpaca.data.requests import OptionChainRequest
from alpaca.data.live import OptionDataStream
from alpaca.data.enums import DataFeed

logger = logging.getLogger(__name__)


def _safe_float(val) -> Optional[float]:
    try:
        return float(val) if val is not None else None
    except (ValueError, TypeError):
        return None


def _safe_int(val) -> int:
    try:
        return int(float(val)) if val is not None else 0
    except (ValueError, TypeError):
        return 0


def _parse_occ_type(symbol: str) -> str:
    """
    Derive CALL/PUT from the OCC symbol character at position [-10].
    IWM260427P00267000: len=18, position 8 = 'P'
    Falls back to 'CALL' on parse error.
    """
    try:
        # The type character sits immediately before the 8-digit strike suffix
        type_char = symbol[-9] if len(symbol) >= 9 else 'C'
        return "PUT" if type_char.upper() == 'P' else "CALL"
    except Exception:
        return "CALL"


def _parse_occ_strike(symbol: str) -> float:
    """
    Extract strike from OCC symbol: last 8 digits represent strike * 1000.
    IWM260427P00267000 → 00267000 → 267.000
    """
    try:
        return int(symbol[-8:]) / 1000.0
    except Exception:
        return 0.0


def _parse_occ_expiration(symbol: str, underlying: str) -> str:
    """
    Extract YYYY-MM-DD expiration from OCC symbol.
    IWM260427P00267000 → underlying=IWM (3), date starts at 3 → 260427 → 2026-04-27
    """
    try:
        start = len(underlying)
        date_str = symbol[start:start + 6]  # YYMMDD
        return f"20{date_str[0:2]}-{date_str[2:4]}-{date_str[4:6]}"
    except Exception:
        return ""


class AlpacaOptionService:
    """
    Fetches options snapshots from Alpaca's OptionHistoricalDataClient.

    Free tier ('indicative' feed) provides:
      - Latest bid/ask (latestQuote)
      - Last trade price (latestTrade)
      - Daily OHLCV (dailyBar, prevDailyBar)
      - Open interest (contract.open_interest)

    Paid tier ('opra') additionally provides greeks and implied volatility.
    """

    def __init__(self):
        self.alpaca_api_key = os.getenv("ALPACA_LIVE_API_KEY")
        self.alpaca_secret_key = os.getenv("ALPACA_LIVE_SECRET_KEY")

        if not self.alpaca_api_key:
            raise ValueError("ALPACA_LIVE_API_KEY not defined")
        if not self.alpaca_secret_key:
            raise ValueError("ALPACA_LIVE_SECRET_KEY not defined")

        self.options_client = OptionHistoricalDataClient(
            api_key=self.alpaca_api_key,
            secret_key=self.alpaca_secret_key,
        )

        self._option_stream: Optional[OptionDataStream] = None
        self._stream_task: Optional[asyncio.Task] = None
        self._is_streaming = False
        self._option_handler: Optional[Callable] = None

    async def get_options(
        self,
        ticker: str,
        feed: str = "indicative",
        limit: int = 100,
        strike_price_gte: Optional[float] = None,
        strike_price_lte: Optional[float] = None,
        expiration_date_gte: Optional[str] = None,
        expiration_date_lte: Optional[str] = None,
        current_price: Optional[float] = None,
        **kwargs,  # absorb extra kwargs (e.g. include_greeks from old callers)
    ) -> Dict:
        """
        Retrieve options snapshots for a ticker.

        Args:
            ticker: Underlying symbol (e.g. "IWM", "SPY")
            feed: 'indicative' (free) or 'opra' (paid)
            limit: Max contracts per side (calls/puts) after sorting
            strike_price_gte/lte: Optional strike filter (applied client-side)
            expiration_date_gte/lte: Optional expiration filter 'YYYY-MM-DD'
            current_price: Used only for fallback; not required with Alpaca

        Returns:
            {
                "ticker": str,
                "current_price": float,
                "calls": List[OptionsContract],
                "puts": List[OptionsContract],
                "expirations_fetched": List[str],   # unique sorted YYYY-MM-DD strings
                "last_updated": str,
                "feed": str,
            }
        """
        ticker = ticker.strip().upper()
        if not ticker or len(ticker) > 6:
            raise ValueError(f"Invalid ticker: {ticker}")

        today = datetime.now().date()

        # Parse expiration date bounds
        exp_gte: Optional[date] = None
        exp_lte: Optional[date] = None

        if expiration_date_gte:
            exp_gte = datetime.strptime(expiration_date_gte, "%Y-%m-%d").date()
        else:
            exp_gte = today  # default: start from today

        if expiration_date_lte:
            exp_lte = datetime.strptime(expiration_date_lte, "%Y-%m-%d").date()
        else:
            exp_lte = today + timedelta(days=30)  # default: 30 days out

        logger.info(
            f"Fetching options chain for {ticker} | "
            f"exp {exp_gte} → {exp_lte} | "
            f"strike {strike_price_gte} → {strike_price_lte} | "
            f"limit={limit}"
        )

        loop = asyncio.get_event_loop()

        def fetch_chain():
            req = OptionChainRequest(
                underlying_symbol=ticker,
                expiration_date_gte=exp_gte,
                expiration_date_lte=exp_lte,
                # Strike filters are applied client-side (API filter is best-effort)
                strike_price_gte=strike_price_gte,
                strike_price_lte=strike_price_lte,
            )
            return self.options_client.get_option_chain(req)

        option_chain = await loop.run_in_executor(None, fetch_chain)

        # Fetch underlying price (fallback: 0)
        if current_price is None:
            current_price = await self._get_current_price(ticker) or 0.0

        return self._process_chain(
            ticker=ticker,
            option_chain=option_chain,
            current_price=current_price,
            feed=feed,
            limit=limit,
            strike_price_gte=strike_price_gte,
            strike_price_lte=strike_price_lte,
            exp_gte=exp_gte,
            exp_lte=exp_lte,
        )

    async def get_contract_prices_batch(
        self, symbols: List[str]
    ) -> Dict[str, Optional[float]]:
        """
        Fetch current prices for a list of OCC symbols with minimal API calls.

        Groups symbols by underlying ticker so one OptionChainRequest is made
        per ticker rather than one per contract.

        Price priority: last trade price → mid of bid/ask → None.

        Returns:
            {symbol: price_float_or_None}
        """
        from collections import defaultdict

        ticker_to_symbols: Dict[str, List[str]] = defaultdict(list)
        for symbol in symbols:
            ticker = ""
            for ch in symbol:
                if ch.isalpha():
                    ticker += ch
                else:
                    break
            if ticker:
                ticker_to_symbols[ticker].append(symbol)

        prices: Dict[str, Optional[float]] = {s: None for s in symbols}
        loop = asyncio.get_event_loop()

        for ticker, ticker_symbols in ticker_to_symbols.items():
            try:
                def fetch_chain(t=ticker):
                    req = OptionChainRequest(underlying_symbol=t)
                    return self.options_client.get_option_chain(req)

                chain = await loop.run_in_executor(None, fetch_chain)

                for symbol in ticker_symbols:
                    snapshot = chain.get(symbol)
                    if snapshot is None:
                        continue

                    # Last trade is the most reliable price
                    last_trade = getattr(snapshot, "latest_trade", None)
                    price = _safe_float(getattr(last_trade, "price", None)) if last_trade else None

                    # Fall back to mid of bid/ask
                    if price is None:
                        latest_quote = getattr(snapshot, "latest_quote", None)
                        if latest_quote:
                            bid = _safe_float(getattr(latest_quote, "bid_price", None)) or 0.0
                            ask = _safe_float(getattr(latest_quote, "ask_price", None)) or 0.0
                            if bid > 0 and ask > 0:
                                price = (bid + ask) / 2.0

                    prices[symbol] = price

            except Exception as e:
                logger.error(f"Error fetching batch chain for {ticker}: {e}")

        fetched = sum(1 for v in prices.values() if v is not None)
        logger.info(f"Batch price fetch: {fetched}/{len(symbols)} prices retrieved")
        return prices

    async def get_contract_snapshot(self, contract_symbol: str) -> Optional[Dict]:
        """
        Fetch a single contract snapshot by its OCC symbol.
        Used for refreshing live price of a tracked contract.
        """
        try:
            ticker = ''.join(c for c in contract_symbol if c.isalpha() and c == c.upper())
            # A cleaner approach: extract leading alpha chars
            ticker = ''
            for ch in contract_symbol:
                if ch.isalpha():
                    ticker += ch
                else:
                    break

            loop = asyncio.get_event_loop()

            def fetch():
                req = OptionChainRequest(underlying_symbol=ticker)
                chain = self.options_client.get_option_chain(req)
                return chain.get(contract_symbol)

            snapshot = await loop.run_in_executor(None, fetch)
            if snapshot is None:
                return None
            return self._extract_contract(contract_symbol, snapshot, ticker)
        except Exception as e:
            logger.error(f"Error fetching snapshot for {contract_symbol}: {e}")
            return None

    def _process_chain(
        self,
        ticker: str,
        option_chain,
        current_price: float,
        feed: str,
        limit: int,
        strike_price_gte: Optional[float],
        strike_price_lte: Optional[float],
        exp_gte: date,
        exp_lte: date,
    ) -> Dict:
        calls: List[Dict] = []
        puts: List[Dict] = []
        expirations_seen: set = set()

        for symbol, snapshot in option_chain.items():
            try:
                contract = self._extract_contract(symbol, snapshot, ticker)
                if not contract:
                    continue

                # Client-side strike filter (in case API didn't apply it)
                if strike_price_gte is not None and contract["strike"] < strike_price_gte:
                    continue
                if strike_price_lte is not None and contract["strike"] > strike_price_lte:
                    continue

                # Client-side expiration filter
                exp_str = contract.get("expiration", "")
                if exp_str:
                    try:
                        exp_date = datetime.strptime(exp_str, "%Y-%m-%d").date()
                        if exp_date < exp_gte or exp_date > exp_lte:
                            continue
                        expirations_seen.add(exp_str)
                    except ValueError:
                        pass

                if contract["option_type"] == "CALL":
                    calls.append(contract)
                else:
                    puts.append(contract)

            except Exception as e:
                logger.warning(f"Error processing {symbol}: {e}")

        # Sort by strike, then apply limit
        calls.sort(key=lambda x: x["strike"])
        puts.sort(key=lambda x: x["strike"])

        # Keep at most `limit` per side — take the ones closest to ATM
        if current_price > 0:
            calls = _nearest_to_price(calls, current_price, limit)
            puts = _nearest_to_price(puts, current_price, limit)
        else:
            calls = calls[:limit]
            puts = puts[:limit]

        expirations_fetched = sorted(expirations_seen)

        logger.info(
            f"{ticker}: {len(calls)} calls, {len(puts)} puts, "
            f"{len(expirations_fetched)} expirations"
        )

        return {
            "ticker": ticker,
            "current_price": current_price,
            "calls": calls,
            "puts": puts,
            "expirations_fetched": expirations_fetched,
            "last_updated": datetime.now().isoformat() + "Z",
            "source": "alpaca",
            "feed": feed,
        }

    def _extract_contract(self, symbol: str, snapshot, ticker: str) -> Optional[Dict]:
        """
        Map an Alpaca SDK OptionSnapshot to the OptionsContract shape
        expected by the frontend.

        SDK attribute reference (alpaca-py OptionSnapshot):
          .contract.type            → 'call' | 'put'
          .contract.strike_price    → Decimal
          .contract.expiration_date → date
          .contract.open_interest   → Decimal | None
          .latest_quote.bid_price   → float  (bp in raw JSON)
          .latest_quote.ask_price   → float  (ap in raw JSON)
          .latest_trade.price       → float  (p in raw JSON)
          .latest_trade.timestamp   → datetime
          .daily_bar.volume         → int    (v in raw JSON)
          .greeks.delta/gamma/theta/vega/rho → float | None (paid only)
          .implied_volatility        → float | None (paid only)
        """
        try:
            # ── Option type ──────────────────────────────────────────────────
            option_type = "CALL"
            contract_obj = getattr(snapshot, "contract", None)
            if contract_obj is not None:
                t = getattr(contract_obj, "type", None)
                if t is not None:
                    option_type = "PUT" if str(t).lower() in ("put", "p") else "CALL"
            else:
                option_type = _parse_occ_type(symbol)

            # ── Strike ───────────────────────────────────────────────────────
            strike = 0.0
            if contract_obj is not None:
                sp = getattr(contract_obj, "strike_price", None)
                if sp is not None:
                    strike = float(sp)
            if strike == 0.0:
                strike = _parse_occ_strike(symbol)

            # ── Expiration ───────────────────────────────────────────────────
            expiration = ""
            if contract_obj is not None:
                exp = getattr(contract_obj, "expiration_date", None)
                if exp is not None:
                    expiration = exp.isoformat() if hasattr(exp, "isoformat") else str(exp)
            if not expiration:
                expiration = _parse_occ_expiration(symbol, ticker)

            # ── Open interest ─────────────────────────────────────────────────
            open_interest = 0
            if contract_obj is not None:
                oi = getattr(contract_obj, "open_interest", None)
                open_interest = _safe_int(oi)

            # ── Latest quote (bid / ask) ──────────────────────────────────────
            bid = 0.0
            ask = 0.0
            latest_quote = getattr(snapshot, "latest_quote", None)
            if latest_quote is not None:
                bid = _safe_float(getattr(latest_quote, "bid_price", None)) or 0.0
                ask = _safe_float(getattr(latest_quote, "ask_price", None)) or 0.0

            # ── Latest trade (last price / timestamp) ─────────────────────────
            last_price: Optional[float] = None
            timestamp = datetime.now().isoformat() + "Z"
            latest_trade = getattr(snapshot, "latest_trade", None)
            if latest_trade is not None:
                last_price = _safe_float(getattr(latest_trade, "price", None))
                ts = getattr(latest_trade, "timestamp", None)
                if ts is not None:
                    timestamp = ts.isoformat() if hasattr(ts, "isoformat") else str(ts)

            # ── Volume (from daily bar) ───────────────────────────────────────
            volume = 0
            daily_bar = getattr(snapshot, "daily_bar", None)
            if daily_bar is not None:
                volume = _safe_int(getattr(daily_bar, "volume", None))

            # ── Greeks (paid feed only; None on free tier) ────────────────────
            delta = gamma = theta = vega = rho = None
            greeks = getattr(snapshot, "greeks", None)
            if greeks is not None:
                delta = _safe_float(getattr(greeks, "delta", None))
                gamma = _safe_float(getattr(greeks, "gamma", None))
                theta = _safe_float(getattr(greeks, "theta", None))
                vega = _safe_float(getattr(greeks, "vega", None))
                rho = _safe_float(getattr(greeks, "rho", None))

            # ── Implied volatility (paid feed only) ───────────────────────────
            iv = _safe_float(getattr(snapshot, "implied_volatility", None))

            return {
                "symbol": symbol,
                "ticker": ticker,
                "strike": strike,
                "expiration": expiration,
                "option_type": option_type,
                "last_price": last_price,
                "bid": bid,
                "ask": ask,
                "volume": volume,
                "open_interest": open_interest,
                "implied_volatility": iv,
                "delta": delta,
                "gamma": gamma,
                "theta": theta,
                "vega": vega,
                "rho": rho,
                "timestamp": timestamp,
            }

        except Exception as e:
            logger.warning(f"Error extracting contract {symbol}: {e}", exc_info=True)
            return None

    async def _get_current_price(self, ticker: str) -> Optional[float]:
        """Fetch current underlying price via yfinance (lightweight fallback)."""
        try:
            import yfinance as yf
            loop = asyncio.get_event_loop()

            def _fetch():
                info = yf.Ticker(ticker).info
                return info.get("currentPrice") or info.get("regularMarketPrice")

            price = await loop.run_in_executor(None, _fetch)
            return float(price) if price else None
        except Exception as e:
            logger.warning(f"Could not fetch price for {ticker}: {e}")
            return None

    # ── Streaming (future) ──────────────────────────────────────────────────

    async def start_options_stream(
        self,
        symbols: List[str],
        option_handler: Callable,
        feed: str = "indicative",
    ) -> bool:
        if self._is_streaming:
            logger.warning("Options stream already running")
            return False

        try:
            data_feed = DataFeed.INDICATIVE if feed == "indicative" else DataFeed.OPRA
            self._option_stream = OptionDataStream(
                api_key=self.alpaca_api_key,
                secret_key=self.alpaca_secret_key,
                feed=data_feed,
            )
            self._option_handler = option_handler

            async def handle_quote(data):
                try:
                    await self._option_handler({
                        "type": "quote",
                        "symbol": data.symbol,
                        "bid": float(data.bid_price) if data.bid_price else None,
                        "ask": float(data.ask_price) if data.ask_price else None,
                        "timestamp": data.timestamp.isoformat() if data.timestamp else None,
                    })
                except Exception as e:
                    logger.error(f"Error handling option quote: {e}")

            async def handle_trade(data):
                try:
                    await self._option_handler({
                        "type": "trade",
                        "symbol": data.symbol,
                        "price": float(data.price) if data.price else None,
                        "size": data.size,
                        "timestamp": data.timestamp.isoformat() if data.timestamp else None,
                    })
                except Exception as e:
                    logger.error(f"Error handling option trade: {e}")

            self._option_stream.subscribe_quotes(handle_quote, *symbols)
            self._option_stream.subscribe_trades(handle_trade, *symbols)

            self._is_streaming = True
            self._stream_task = asyncio.create_task(self._run_stream())
            logger.info(f"Options stream started for {len(symbols)} symbols")
            return True

        except Exception as e:
            logger.error(f"Error starting options stream: {e}", exc_info=True)
            self._is_streaming = False
            return False

    async def _run_stream(self):
        try:
            await self._option_stream._run_forever()
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"Options stream error: {e}", exc_info=True)
        finally:
            self._is_streaming = False

    async def stop_options_stream(self) -> bool:
        if not self._is_streaming:
            return True
        try:
            if self._stream_task:
                self._stream_task.cancel()
                try:
                    await self._stream_task
                except asyncio.CancelledError:
                    pass
            if self._option_stream:
                await self._option_stream.close()
            self._is_streaming = False
            return True
        except Exception as e:
            logger.error(f"Error stopping options stream: {e}", exc_info=True)
            return False


# ── Helpers ─────────────────────────────────────────────────────────────────

def _nearest_to_price(contracts: List[Dict], price: float, limit: int) -> List[Dict]:
    """Return up to `limit` contracts sorted by distance from current price."""
    if len(contracts) <= limit:
        return contracts
    scored = sorted(contracts, key=lambda c: abs(c["strike"] - price))
    result = scored[:limit]
    result.sort(key=lambda c: c["strike"])
    return result


# ── Singleton ────────────────────────────────────────────────────────────────

_service_instance: Optional[AlpacaOptionService] = None


def get_alpaca_option_service() -> AlpacaOptionService:
    global _service_instance
    if _service_instance is None:
        try:
            _service_instance = AlpacaOptionService()
            logger.info("AlpacaOptionService initialized")
        except Exception as e:
            logger.error(f"Failed to initialize AlpacaOptionService: {e}", exc_info=True)
            raise
    return _service_instance


def reset_alpaca_option_service():
    global _service_instance
    _service_instance = None
    logger.info("AlpacaOptionService reset")
