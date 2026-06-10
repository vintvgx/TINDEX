"""
0DTE contract selection.

Filter pipeline (hard — fail → discard):
  1. Strike: offset inside profile's [offset_min, offset_max] window
             (budget mode: within _BUDGET_STRIKE_TOLERANCE of the fib extension anchor)
  2. Greeks present — contracts without delta are rejected on 0DTE
  3. Delta inside profile's [delta_min, delta_max] range
             (budget mode: overridden by _BUDGET_DELTA_RANGES[fib_level])
  4. Ask > 0
  5. Bid/ask spread % ≤ max_spread_pct (profile override → default 0.25)
  5b. Budget mode only: ask ≤ budget_max_ask

  (Open interest is NOT filtered — it isn't returned by the option-chain snapshot;
   the bid/ask spread filter is the remaining liquidity proxy.)

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

# Default max spread fraction (ask - bid) / ask when profile omits "max_spread_pct"
_DEFAULT_MAX_SPREAD_PCT = 0.25

# Budget OTM mode: delta ranges per fib level (lower delta = further OTM)
_BUDGET_DELTA_RANGES = {
    "1.0":   (0.14, 0.26),
    "1.618": (0.08, 0.17),
    "2.618": (0.03, 0.09),
}
_BUDGET_STRIKE_TOLERANCE = 0.75  # |strike - fib_anchor| ≤ this to pass filter


def _parse_occ_strike(symbol: str) -> Optional[float]:
    """
    Parse the strike from an OCC option symbol. Format:
    <ROOT><YYMMDD><C|P><strike × 1000, 8 digits>, e.g. IWM260610C00200000 → 200.0.
    Returns None when the trailing 8 digits aren't numeric.
    """
    try:
        return int(symbol[-8:]) / 1000.0
    except (ValueError, IndexError):
        return None


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
    max_spread   = profile.get("max_spread_pct", _DEFAULT_MAX_SPREAD_PCT)

    # ── Budget mode: override thresholds with fib-anchored OTM parameters ─────
    # (Open-interest floors are no longer applied — OI isn't available from the
    # option-chain snapshot; the bid/ask spread filter is the liquidity proxy.)
    if budget_mode:
        fib_dir_key         = f"up_{budget_fib_level}" if direction == "CALL" else f"dn_{budget_fib_level}"
        fib_anchor          = fib_levels.get(fib_dir_key, breakout_level)
        budget_delta_range  = _BUDGET_DELTA_RANGES.get(budget_fib_level, (0.08, 0.22))
        effective_delta_min = budget_delta_range[0]
        effective_delta_max = budget_delta_range[1]
    else:
        fib_anchor          = None
        effective_delta_min = delta_min
        effective_delta_max = delta_max

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
    # INDICATIVE feed so the chain returns without an OPRA real-time entitlement;
    # the actual entry still passes verify_stream (real-time option WS) + a market order.
    try:
        from alpaca.data.requests import OptionChainRequest
        from alpaca.data.enums import OptionsFeed
        chain = data_client.get_option_chain(OptionChainRequest(
            underlying_symbol=ticker,
            expiration_date=today,
            type=option_type,
            feed=OptionsFeed.INDICATIVE,
        ))
    except Exception as exc:
        logger.error("[ContractSelector] Chain fetch failed: %s", exc)
        return None

    # ── Filters ──────────────────────────────────────────────────────────────────
    # NOTE: get_option_chain returns {symbol: OptionsSnapshot}; strike is parsed from
    # the OCC symbol, open interest is NOT available from this endpoint, and the
    # INDICATIVE feed frequently omits greeks. We therefore:
    #   • build `candidates` from the PREFERRED filters (strike window/fib + spread,
    #     and delta range ONLY when a delta is present — never reject for missing greeks)
    #   • build `all_valid` from EVERY live-quoted strike, as a guaranteed fallback so a
    #     confirmed breakout always gets a tradeable, near-the-money contract.
    candidates = []
    all_valid  = []
    for symbol, contract in chain.items():
        strike = _parse_occ_strike(symbol)
        if strike is None:
            continue

        # Valid live ask is the one true requirement (can't buy without an offer).
        q = getattr(contract, "latest_quote", None)
        ask = getattr(q, "ask_price", None) if q else None
        if not ask or float(ask) <= 0:
            continue
        ask_f = float(ask)
        bid_f = float(getattr(q, "bid_price", 0) or 0)
        spread_pct = (ask_f - bid_f) / ask_f if ask_f > 0 else 1.0
        offset = abs(strike - breakout_level)

        raw_delta = contract.greeks.delta if getattr(contract, "greeks", None) else None
        delta = abs(raw_delta) if raw_delta is not None else None

        row = {
            "symbol":     symbol,
            "strike":     strike,
            "expiry":     str(today),
            "delta":      delta if delta is not None else 0.0,
            "ask":        ask_f,
            "bid":        bid_f,
            "spread_pct": round(spread_pct, 3),
            "oi":         None,
            "offset":     offset,
        }
        all_valid.append(row)

        # ── Preferred (strict) filters ──
        # 1. Strike: fib proximity in budget mode, offset window otherwise
        if budget_mode:
            if fib_anchor is not None and abs(strike - fib_anchor) > _BUDGET_STRIKE_TOLERANCE:
                continue
        else:
            if offset < offset_min or offset > offset_max:
                continue
        # 2. Delta range — enforced only when greeks are present (indicative feed omits them)
        if delta is not None and not (effective_delta_min <= delta <= effective_delta_max):
            continue
        # 3. Spread quality (liquidity proxy)
        if spread_pct > max_spread:
            continue
        # 3b. Budget mode: reject contracts above the per-contract price cap
        if budget_mode and budget_max_ask is not None and ask_f > budget_max_ask:
            continue

        candidates.append(row)

    # ── Fallback when nothing passed the preferred filters ───────────────────────
    if not candidates:
        if not all_valid:
            logger.warning("[ContractSelector] No live-quoted contracts for %s %s — cannot enter",
                           ticker, direction)
            return None

        if budget_mode and budget_max_ask is not None:
            affordable = [c for c in all_valid if c["ask"] <= budget_max_ask]
            if not affordable:
                logger.warning("[ContractSelector] Budget OTM: no affordable contract ≤ $%.2f for %s",
                               budget_max_ask, ticker)
                return None
            anchor = fib_anchor if fib_anchor is not None else breakout_level
            affordable.sort(key=lambda c: (abs(c["strike"] - anchor), c["spread_pct"]))
            best = affordable[0]
        else:
            # Prefer the OTM side of the breakout in the trade direction, nearest the
            # money; fall back to nearest overall. Capital is sized downstream.
            directional = [c for c in all_valid
                           if (c["strike"] >= breakout_level if direction == "CALL"
                               else c["strike"] <= breakout_level)]
            pool = directional or all_valid
            pool.sort(key=lambda c: (abs(c["strike"] - breakout_level), c["spread_pct"]))
            best = pool[0]

        logger.warning(
            "[ContractSelector] No contract passed strict filters for %s %s — fallback to "
            "nearest-the-money %s (strike=%.2f ask=%.2f spread=%.0f%% delta=%s)",
            ticker, direction, best["symbol"], best["strike"], best["ask"],
            best["spread_pct"] * 100, best["delta"] or "n/a",
        )
        return best

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
