"""
0DTE contract selection. The profile dict controls strike offsets and delta range:

BULL DOG    → further OTM, lower delta (0.28-0.45), higher leverage
THUNDER CAT → near ATM, delta 0.38-0.58
WOLF        → closest ATM, delta 0.42-0.58, never far OTM
"""

import logging
from datetime import date

logger = logging.getLogger(__name__)

OI_THRESHOLD = 100  # minimum open interest for liquidity


def select_contract(ticker: str, direction: str, trigger_price: float,
                    orh: float, orl: float, fib_levels: dict,
                    data_client, profile: dict) -> dict | None:
    today = date.today()
    option_type = "call" if direction == "CALL" else "put"
    breakout_level = orh if direction == "CALL" else orl

    offset_min = profile["strike_offset_min"]
    offset_max = profile["strike_offset_max"]
    delta_min  = profile["target_delta_min"]
    delta_max  = profile["target_delta_max"]

    try:
        from alpaca.data.requests import OptionChainRequest
        req = OptionChainRequest(
            underlying_symbol=ticker,
            expiration_date=today,
            option_type=option_type,
        )
        chain = data_client.get_option_chain(req)
    except Exception as e:
        logger.error("[ContractSelector] Chain fetch failed: %s", e)
        return None

    candidates = []
    for symbol, contract in chain.items():
        strike = contract.strike_price
        offset = abs(strike - breakout_level)

        if offset < offset_min or offset > offset_max:
            continue

        if (contract.open_interest or 0) < OI_THRESHOLD:
            continue

        delta = abs(contract.greeks.delta) if contract.greeks else None
        if delta and not (delta_min <= delta <= delta_max):
            continue

        ask = contract.latest_quote.ask_price if contract.latest_quote else None
        if not ask or ask <= 0:
            continue

        candidates.append({
            "symbol": symbol,
            "strike": strike,
            "expiry": str(today),
            "delta":  delta,
            "ask":    ask,
            "bid":    contract.latest_quote.bid_price,
            "oi":     contract.open_interest,
            "offset": offset,
        })

    if not candidates:
        logger.warning("[ContractSelector] No valid contracts for %s %s profile=%s",
                       ticker, direction, profile)
        return None

    def score(c):
        d_score = abs((c["delta"] or 0.5) - 0.50)
        o_score = abs(c["offset"] - 1.00)
        return d_score + o_score * 0.5

    candidates.sort(key=score)
    best = candidates[0]
    logger.info("[ContractSelector] Selected %s strike=%s delta=%s ask=%s",
                best["symbol"], best["strike"], best["delta"], best["ask"])
    return best
