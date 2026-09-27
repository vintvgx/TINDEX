"""
Plain Black-Scholes option pricing for the Simulated Returns feature — see
docs/SIMULATED_RETURNS_PLAN.md for the full design/caveats.

European-style, stdlib-only (math.erf for the normal CDF — no py_vollib/
QuantLib/scipy dependency). A documented simplification for equity options
(technically American/early-exercisable), same tradeoff Robinhood's own
curve shape suggests they're making too. IV is held flat across the whole
grid rather than interpolated from a smile/surface — directionally honest,
not vol-crush-aware.
"""

import math
from datetime import date, timedelta
from typing import Literal, TypedDict

OptionType = Literal["CALL", "PUT"]

DEFAULT_SPOT_RANGE_PCT = 0.10
DEFAULT_RISK_FREE_RATE = 0.043  # short-term T-bill yield, hand-refreshed — see plan doc §3
GRID_SPOT_POINTS = 41  # odd count so the center point lands exactly on current_spot


def _norm_cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def black_scholes_price(
    spot: float,
    strike: float,
    years_to_expiry: float,
    volatility: float,
    risk_free_rate: float,
    option_type: OptionType,
) -> float:
    """
    Theoretical price of one option contract's underlying share (not x100).
    At years_to_expiry <= 0, the formula is undefined/meaningless — falls
    back to intrinsic value, which is what a contract is actually worth at
    expiration.
    """
    if years_to_expiry <= 0 or volatility <= 0 or spot <= 0 or strike <= 0:
        if option_type == "CALL":
            return max(0.0, spot - strike)
        return max(0.0, strike - spot)

    sqrt_t = math.sqrt(years_to_expiry)
    d1 = (
        math.log(spot / strike) + (risk_free_rate + 0.5 * volatility ** 2) * years_to_expiry
    ) / (volatility * sqrt_t)
    d2 = d1 - volatility * sqrt_t

    discount = math.exp(-risk_free_rate * years_to_expiry)
    if option_type == "CALL":
        return spot * _norm_cdf(d1) - strike * discount * _norm_cdf(d2)
    return strike * discount * _norm_cdf(-d2) - spot * _norm_cdf(-d1)


class SimulatedReturnsGrid(TypedDict):
    dates: list[str]
    spot_prices: list[float]
    pnl: list[list[float]]
    max_loss: float
    risk_free_rate_used: float


def build_simulated_returns_grid(
    *,
    current_spot: float,
    strike: float,
    expiration_date: date,
    volatility: float,
    current_contract_price: float,
    cost_basis: float,
    quantity: int,
    option_type: OptionType,
    spot_range_pct: float = DEFAULT_SPOT_RANGE_PCT,
    risk_free_rate: float = DEFAULT_RISK_FREE_RATE,
    today: date | None = None,
) -> SimulatedReturnsGrid:
    """
    Builds the full (date x spot) P&L grid in one shot, so the mobile
    client can slice/re-slice locally (e.g. dragging the price ruler)
    without a round-trip per interaction.

    Anchoring: the raw Black-Scholes model rarely lands exactly on the
    contract's real current market price (model vs. reality drift is
    normal). Rather than showing a "now" P&L that visibly disagrees with
    the live price already shown elsewhere in the app, the whole grid is
    shifted by a constant dollar offset so the model's (today, current_spot)
    point exactly equals current_contract_price. This preserves the
    model's shape (decay curve, delta/gamma behavior across spot) while
    keeping the anchor point honest.

    dates run from `today` (defaults to date.today()) through
    `expiration_date` inclusive, one point per calendar day — matches the
    smooth daily decay in the reference Robinhood screenshots. The final
    date (expiration itself) always prices at pure intrinsic value, not
    the Black-Scholes formula (T=0 there is exact, not an approximation).
    """
    today = today or date.today()
    dte = max((expiration_date - today).days, 0)
    dates = [today + timedelta(days=i) for i in range(dte + 1)]

    half_range = current_spot * spot_range_pct
    if GRID_SPOT_POINTS == 1:
        spot_prices = [current_spot]
    else:
        step = (2 * half_range) / (GRID_SPOT_POINTS - 1)
        spot_prices = [
            current_spot - half_range + step * i for i in range(GRID_SPOT_POINTS)
        ]

    # Anchor offset: raw model price today at the current spot, vs. the
    # contract's actual current market price.
    years_now = dte / 365.0
    model_now_price = black_scholes_price(
        spot=current_spot,
        strike=strike,
        years_to_expiry=years_now,
        volatility=volatility,
        risk_free_rate=risk_free_rate,
        option_type=option_type,
    )
    anchor_offset = current_contract_price - model_now_price

    pnl: list[list[float]] = []
    for i, d in enumerate(dates):
        days_left = (expiration_date - d).days
        years_to_expiry = 0.0 if days_left <= 0 else days_left / 365.0
        row = []
        for spot in spot_prices:
            theo = black_scholes_price(
                spot=max(spot, 0.01),
                strike=strike,
                years_to_expiry=years_to_expiry,
                volatility=volatility,
                risk_free_rate=risk_free_rate,
                option_type=option_type,
            )
            # Only the anchor point's own drift is corrected, not a fresh
            # offset per cell — everywhere else the model's own shape
            # (decay, delta across spot) is trusted as-is. The expiration
            # column is intrinsic value by construction and deliberately
            # NOT anchored — real contracts converge to intrinsic value at
            # expiry regardless of today's live-quote drift.
            anchored = theo if days_left <= 0 else theo + anchor_offset
            row.append(round((anchored - cost_basis) * 100 * quantity, 2))
        pnl.append(row)

    max_loss = round(-cost_basis * 100 * quantity, 2)

    return {
        "dates": [d.isoformat() for d in dates],
        "spot_prices": [round(s, 2) for s in spot_prices],
        "pnl": pnl,
        "max_loss": max_loss,
        "risk_free_rate_used": risk_free_rate,
    }
