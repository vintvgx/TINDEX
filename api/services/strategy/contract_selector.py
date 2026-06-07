"""
0DTE contract selection.

Filter pipeline (hard — fail → discard):
  1. Strike offset inside profile's [offset_min, offset_max] window
  2. Open interest ≥ oi_min  (profile override → ticker default → global fallback)
  3. Greeks present — contracts without delta are rejected on 0DTE
  4. Delta inside profile's [delta_min, delta_max] range
  5. Ask > 0
  6. Bid/ask spread % ≤ max_spread_pct (profile override → default 0.25)

Scoring (lower = better — determines which survivor is selected):
  • Delta distance from profile midpoint  (weight 1.0)
  • Offset distance from profile midpoint (weight 0.5)
  • Spread %                              (weight 0.3)
  • VWAP misalignment penalty            (weight 0.05 when price/direction disagree)

VWAP signal (soft — not a hard block):
  CALL favoured when trigger_price > session VWAP  (price above average, buyers in control)
  PUT  favoured when trigger_price < session VWAP  (price below average, sellers in control)
  Misalignment is logged as a warning and adds a small scoring penalty.

Note on trigger_price vs breakout_level:
  breakout_level (orh for CALL, orl for PUT) is the structural ORB boundary and
  is used as the strike anchor.  trigger_price is the actual tick that fired
  entry — it may be slightly past the boundary due to polling latency.  It is
  used for VWAP comparison but not for strike offset computation, to keep the
  anchor clean and reproducible.

Note on fib_levels:
  Passed in for future use — e.g. favouring a strike that sits near the 1.0
  extension (natural TP1 target).  Not yet used in scoring.
"""

import logging
from datetime import date
from typing import Optional

logger = logging.getLogger(__name__)

# Per-ticker OI floor (used when profile does not define "oi_min")
_TICKER_OI_MIN = {"SPY": 200, "QQQ": 200, "IWM": 100}
_DEFAULT_OI_MIN = 75

# Default max spread fraction (ask - bid) / ask when profile omits "max_spread_pct"
_DEFAULT_MAX_SPREAD_PCT = 0.25


def select_contract(
    ticker: str,
    direction: str,
    trigger_price: float,
    orh: float,
    orl: float,
    fib_levels: dict,
    data_client,
    profile: dict,
    vwap: Optional[float] = None,
) -> dict | None:
    today          = date.today()
    option_type    = "call" if direction == "CALL" else "put"
    breakout_level = orh if direction == "CALL" else orl

    offset_min   = profile["strike_offset_min"]
    offset_max   = profile["strike_offset_max"]
    delta_min    = profile["target_delta_min"]
    delta_max    = profile["target_delta_max"]
    oi_min       = profile.get("oi_min",          _TICKER_OI_MIN.get(ticker.upper(), _DEFAULT_OI_MIN))
    max_spread   = profile.get("max_spread_pct",  _DEFAULT_MAX_SPREAD_PCT)

    # ── VWAP soft confirmation ─────────────────────────────────────────────────
    # Logs misalignment; applies a small scoring penalty — does NOT block entry.
    vwap_aligned: Optional[bool] = None
    if vwap is not None:
        vwap_aligned = trigger_price > vwap if direction == "CALL" else trigger_price < vwap
        if not vwap_aligned:
            logger.warning(
                "[ContractSelector] VWAP misalignment: %s %s trigger=%.2f vwap=%.2f"
                " — proceeding with caution",
                ticker, direction, trigger_price, vwap,
            )

    # ── Fetch option chain ─────────────────────────────────────────────────────
    try:
        from alpaca.data.requests import OptionChainRequest
        chain = data_client.get_option_chain(OptionChainRequest(
            underlying_symbol=ticker,
            expiration_date=today,
            type=option_type,
        ))
    except Exception as exc:
        logger.error("[ContractSelector] Chain fetch failed: %s", exc)
        return None

    # ── Hard filters ───────────────────────────────────────────────────────────
    candidates = []
    for symbol, contract in chain.items():
        strike = contract.strike_price
        offset = abs(strike - breakout_level)

        # 1. Strike offset window
        if offset < offset_min or offset > offset_max:
            continue

        # 2. Open interest liquidity floor
        if (contract.open_interest or 0) < oi_min:
            continue

        # 3. Greeks required — no-delta contracts are unreliable on 0DTE
        if not contract.greeks:
            logger.debug("[ContractSelector] Skipping %s — no greeks", symbol)
            continue
        delta = abs(contract.greeks.delta)
        if delta is None:
            logger.debug("[ContractSelector] Skipping %s — delta is None", symbol)
            continue

        # 4. Delta range
        if not (delta_min <= delta <= delta_max):
            continue

        # 5. Valid ask
        if not contract.latest_quote:
            continue
        ask = contract.latest_quote.ask_price
        bid = contract.latest_quote.bid_price
        if not ask or float(ask) <= 0:
            continue

        # 6. Spread quality
        ask_f      = float(ask)
        bid_f      = float(bid or 0)
        spread_pct = (ask_f - bid_f) / ask_f
        if spread_pct > max_spread:
            logger.debug(
                "[ContractSelector] Skipping %s — spread %.0f%% > max %.0f%%",
                symbol, spread_pct * 100, max_spread * 100,
            )
            continue

        candidates.append({
            "symbol":     symbol,
            "strike":     strike,
            "expiry":     str(today),
            "delta":      delta,
            "ask":        ask_f,
            "bid":        bid_f,
            "spread_pct": round(spread_pct, 3),
            "oi":         contract.open_interest or 0,
            "offset":     offset,
        })

    if not candidates:
        logger.warning(
            "[ContractSelector] No valid contracts for %s %s "
            "(offset %.2f–%.2f, delta %.2f–%.2f, oi≥%d, spread≤%.0f%%)",
            ticker, direction,
            offset_min, offset_max, delta_min, delta_max,
            oi_min, max_spread * 100,
        )
        return None

    # ── Profile-targeted scorer ────────────────────────────────────────────────
    # Midpoints derived from profile bounds so each profile scores toward its
    # own sweet spot: Bull Dog → lower delta / further OTM, Wolf → near ATM.
    target_delta  = (delta_min + delta_max) / 2
    target_offset = (offset_min + offset_max) / 2
    vwap_penalty  = 0.05 if vwap_aligned is False else 0.0

    def _score(c: dict) -> float:
        d_score = abs(c["delta"]      - target_delta)
        o_score = abs(c["offset"]     - target_offset)
        s_score = c["spread_pct"]
        return d_score + o_score * 0.5 + s_score * 0.3 + vwap_penalty

    candidates.sort(key=_score)
    best = candidates[0]
    logger.info(
        "[ContractSelector] Selected %s strike=%.2f delta=%.3f ask=%.2f "
        "spread=%.0f%% oi=%d vwap_aligned=%s",
        best["symbol"], best["strike"], best["delta"],
        best["ask"], best["spread_pct"] * 100, best["oi"], vwap_aligned,
    )
    return best
