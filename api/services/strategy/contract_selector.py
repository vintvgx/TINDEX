"""
0DTE contract selection.

Filter pipeline (hard — fail → discard):
  1. Strike: offset inside profile's [offset_min, offset_max] window
             (budget mode: within _BUDGET_STRIKE_TOLERANCE of the fib extension anchor)
  2. Open interest ≥ oi_min  (profile override → ticker default → global fallback;
             budget mode uses a lower floor)
  3. Greeks present — contracts without delta are rejected on 0DTE
  4. Delta inside profile's [delta_min, delta_max] range
             (budget mode: overridden by _BUDGET_DELTA_RANGES[fib_level])
  5. Ask > 0
  6. Bid/ask spread % ≤ max_spread_pct (profile override → default 0.25)
  6b. Budget mode only: ask ≤ budget_max_ask

Scoring (lower = better — determines which survivor is selected):
  Standard mode:
    • Delta distance from profile midpoint  (weight 1.0)
    • Offset distance from profile midpoint (weight 0.5)
    • Spread %                              (weight 0.3)
    • VWAP misalignment penalty            (weight 0.05 when price/direction disagree)
  Budget mode:
    • Distance from fib anchor strike      (weight 1.0)
    • Ask price fraction of budget cap     (weight 0.5)
    • Spread %                              (weight 0.3)

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
  In standard mode, passed in for future use.
  In budget mode, the fib extension matching budget_fib_level is used as the
  strike anchor — targeting a strike that becomes near-ATM exactly when the
  underlying reaches the TP1 / TP2 / extension zone.
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

# Budget OTM mode: delta ranges per fib level (lower delta = further OTM)
_BUDGET_DELTA_RANGES = {
    "1.0":   (0.14, 0.26),
    "1.618": (0.08, 0.17),
    "2.618": (0.03, 0.09),
}
_BUDGET_OI_MIN           = 25    # lower liquidity floor acceptable for cheap OTM
_BUDGET_STRIKE_TOLERANCE = 0.75  # |strike - fib_anchor| ≤ this to pass filter


def fetch_0dte_chain(ticker: str, option_type: str, data_client,
                     limit: int = 40) -> list[dict]:
    """
    Return the raw 0DTE option chain for a ticker/side as a clean, sorted list for
    the manual "Immediate Trade" picker. Unlike select_contract this applies NO
    hard filters — it surfaces every strike with a live quote so the user chooses.

    option_type — "call" | "put".
    Returns [{symbol, strike, delta, bid, ask, mid, spread_pct, oi}] sorted by strike.

    Uses the INDICATIVE options feed so the chain is returned regardless of whether
    the Alpaca account holds an OPRA real-time subscription (the OPRA default returns
    nothing/errors without that entitlement). The picker only needs strikes to choose
    from — the real order still passes verify_stream (real-time option WS) before it
    is submitted, so indicative pricing here is not safety-critical. Raises on a
    hard fetch failure so the caller can surface the reason instead of an empty list.
    """
    today = date.today()
    from alpaca.data.requests import OptionChainRequest
    from alpaca.data.enums import OptionsFeed
    chain = data_client.get_option_chain(OptionChainRequest(
        underlying_symbol=ticker,
        expiration_date=today,
        type=option_type,
        feed=OptionsFeed.INDICATIVE,
    ))

    rows = []
    for symbol, contract in chain.items():
        q = contract.latest_quote
        if not q:
            continue
        ask = float(q.ask_price) if q.ask_price else 0.0
        bid = float(q.bid_price) if q.bid_price else 0.0
        if ask <= 0:
            continue
        delta = None
        if contract.greeks and contract.greeks.delta is not None:
            delta = round(abs(contract.greeks.delta), 3)
        rows.append({
            "symbol":     symbol,
            "strike":     contract.strike_price,
            "delta":      delta,
            "bid":        round(bid, 2),
            "ask":        round(ask, 2),
            "mid":        round((ask + bid) / 2, 2),
            "spread_pct": round((ask - bid) / ask, 3) if ask > 0 else None,
            "oi":         contract.open_interest or 0,
        })

    rows.sort(key=lambda r: r["strike"])
    if limit and len(rows) > limit:
        # Keep the strikes nearest the money (middle of the sorted list).
        start = max(0, (len(rows) - limit) // 2)
        rows = rows[start:start + limit]
    return rows


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
    budget_mode: bool = False,
    budget_max_ask: Optional[float] = None,
    budget_fib_level: str = "1.0",
) -> dict | None:
    today          = date.today()
    option_type    = "call" if direction == "CALL" else "put"
    breakout_level = orh if direction == "CALL" else orl

    offset_min   = profile["strike_offset_min"]
    offset_max   = profile["strike_offset_max"]
    delta_min    = profile["target_delta_min"]
    delta_max    = profile["target_delta_max"]
    oi_min       = profile.get("oi_min",         _TICKER_OI_MIN.get(ticker.upper(), _DEFAULT_OI_MIN))
    max_spread   = profile.get("max_spread_pct", _DEFAULT_MAX_SPREAD_PCT)

    # ── Budget mode: override thresholds with fib-anchored OTM parameters ─────
    if budget_mode:
        fib_dir_key         = f"up_{budget_fib_level}" if direction == "CALL" else f"dn_{budget_fib_level}"
        fib_anchor          = fib_levels.get(fib_dir_key, breakout_level)
        budget_delta_range  = _BUDGET_DELTA_RANGES.get(budget_fib_level, (0.08, 0.22))
        effective_delta_min = budget_delta_range[0]
        effective_delta_max = budget_delta_range[1]
        effective_oi_min    = _BUDGET_OI_MIN
    else:
        fib_anchor          = None
        effective_delta_min = delta_min
        effective_delta_max = delta_max
        effective_oi_min    = oi_min

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

        # 1. Strike filter: fib proximity in budget mode, offset window otherwise
        if budget_mode:
            if fib_anchor is not None and abs(strike - fib_anchor) > _BUDGET_STRIKE_TOLERANCE:
                continue
        else:
            if offset < offset_min or offset > offset_max:
                continue

        # 2. Open interest liquidity floor
        if (contract.open_interest or 0) < effective_oi_min:
            continue

        # 3. Greeks required — no-delta contracts are unreliable on 0DTE
        if not contract.greeks:
            logger.debug("[ContractSelector] Skipping %s — no greeks", symbol)
            continue
        raw_delta = contract.greeks.delta
        if raw_delta is None:
            logger.debug("[ContractSelector] Skipping %s — delta is None", symbol)
            continue
        delta = abs(raw_delta)

        # 4. Delta range (effective range accounts for budget mode override)
        if not (effective_delta_min <= delta <= effective_delta_max):
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

        # 6b. Budget mode: reject contracts above the per-contract price cap
        if budget_mode and budget_max_ask is not None and ask_f > budget_max_ask:
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
        if budget_mode:
            logger.warning(
                "[ContractSelector] No budget OTM contracts for %s %s "
                "(fib=%s anchor=%.2f delta %.2f–%.2f max_ask=%s oi≥%d)",
                ticker, direction, budget_fib_level,
                fib_anchor or 0, effective_delta_min, effective_delta_max,
                f"${budget_max_ask:.2f}" if budget_max_ask else "—", effective_oi_min,
            )
        else:
            logger.warning(
                "[ContractSelector] No valid contracts for %s %s "
                "(offset %.2f–%.2f, delta %.2f–%.2f, oi≥%d, spread≤%.0f%%)",
                ticker, direction,
                offset_min, offset_max, delta_min, delta_max,
                oi_min, max_spread * 100,
            )
        return None

    # ── Scorer ─────────────────────────────────────────────────────────────────
    if budget_mode and fib_anchor is not None:
        # Budget mode: prefer strike nearest the fib anchor, then cheapest
        budget_cap = budget_max_ask or 1.0

        def _score(c: dict) -> float:
            fib_dist  = abs(c["strike"] - fib_anchor)
            ask_score = c["ask"] / budget_cap
            return fib_dist + ask_score * 0.5 + c["spread_pct"] * 0.3

    else:
        # Standard mode: profile-targeted — each profile scores toward its sweet spot
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
        "spread=%.0f%% oi=%d vwap_aligned=%s budget=%s",
        best["symbol"], best["strike"], best["delta"],
        best["ask"], best["spread_pct"] * 100, best["oi"], vwap_aligned, budget_mode,
    )
    return best
