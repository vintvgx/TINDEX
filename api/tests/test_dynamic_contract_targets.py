"""
Dynamic contract targets (2026-11-19, 0.8.06): OTM lean by expected move.

OTM vs ITM is a function of expected move size, not a fixed preference.
The tier is read off the gate composite + how far the trigger closed past
the level; it shifts the scorer's target delta and the offset window
(LARGE leans OTM, SMALL leans near-ATM, MEDIUM is today's behavior).
Underneath it, the live-price OTM check guarantees the pick is actually
OTM at the fill — the Nov 19 734P was 1.47 OTM vs ORL but $1.06 ITM vs
the $732.94 live price.
"""
from types import SimpleNamespace

import pytest

from services.strategy.contract_selector import (
    MIN_LIVE_OTM,
    move_tier,
    select_contract,
)
from services.strategy.profiles import get_profile


def _contract(ask, delta=None, bid=None):
    return SimpleNamespace(
        latest_quote=SimpleNamespace(
            ask_price=ask,
            bid_price=bid if bid is not None else ask - 0.05,
        ),
        greeks=SimpleNamespace(delta=delta) if delta is not None else None,
    )


class _FakeClient:
    def __init__(self, chain):
        self._chain = chain

    def get_option_chain(self, _request):
        return self._chain


def _put_chain(rows):
    """rows: (strike, ask) -> {OCC symbol: fake contract, greeks absent}."""
    return {
        f"SPY261119P{int(strike * 1000):08d}": _contract(ask)
        for strike, ask in rows
    }


PROFILE = get_profile("TREND_RIDER")
ORH = 739.77  # unused on the PUT path (breakout level is ORL); kept realistic


def _select(chain, orl, trigger, composite_total=None, **kwargs):
    return select_contract(
        "SPY", "PUT", trigger, ORH, orl, {}, _FakeClient(chain), PROFILE,
        composite_total=composite_total, **kwargs,
    )


# ── Tier ─────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("composite,trigger,level,expected", [
    (12, 736.40, 737.49, "LARGE"),   # Nov 17: +12, $1.09 past, $9.40 move
    (10, 734.47, 735.47, "LARGE"),   # boundary: +10 and exactly $1.00 past
    (10, 734.48, 735.47, "MEDIUM"),  # $0.99 past — not LARGE
    (9, 733.00, 735.47, "MEDIUM"),
    (5, 735.20, 735.47, "SMALL"),    # MODERATE — small expected move
    (4, 735.20, 735.47, "SMALL"),
    (6, 735.20, 735.47, "MEDIUM"),
    (None, 733.00, 735.47, "MEDIUM"),  # no composite info — don't change behavior
])
def test_move_tier(composite, trigger, level, expected):
    assert move_tier(composite, trigger, level) == expected


def test_min_live_otm_calibration():
    # $0.25 is calibrated so the Nov 17 winner (736P, $0.40 OTM at entry)
    # passes; a $0.50 minimum would have blocked it.
    assert MIN_LIVE_OTM == 0.25


# ── Nov 17 LARGE replay ──────────────────────────────────────────────────────

NOV17_CHAIN = _put_chain([(737, 2.85), (736, 2.35), (735, 1.70), (734, 1.25)])


def test_nov17_large_tier_shifts_pick_further_otm():
    # Composite +12, trigger $736.40 (ORL $737.49) -> LARGE. The pick moves
    # a strike further OTM — the 735P instead of the 736P. Same winner,
    # better shape: cheaper entry, bigger % return, smaller dollar stop.
    best = _select(NOV17_CHAIN, orl=737.49, trigger=736.40, composite_total=12)
    assert best is not None
    assert best["strike"] == 735.0
    assert best["ask"] == pytest.approx(1.70)


def test_nov17_no_composite_keeps_todays_pick():
    # composite_total=None -> MEDIUM -> today's behavior: the 736P.
    best = _select(NOV17_CHAIN, orl=737.49, trigger=736.40, composite_total=None)
    assert best is not None
    assert best["strike"] == 736.0
    assert best["ask"] == pytest.approx(2.35)


def test_large_tier_survives_time_of_day_narrowing():
    # Late in the day the TOD narrowing shrinks the LARGE window
    # ([2.00, 3.50] -> [2.00, 2.78] at 300 min), but it stays valid and
    # the 735P is still the only survivor.
    best = _select(NOV17_CHAIN, orl=737.49, trigger=736.40, composite_total=12,
                   minutes_since_orb_close=300)
    assert best is not None
    assert best["strike"] == 735.0


# ── Nov 19 replay ────────────────────────────────────────────────────────────

def test_nov19_live_otm_check_fixes_the_734p_without_a_price_gate():
    # Composite +8 -> MEDIUM (today's bands). The 734P is 1.47 OTM vs ORL
    # but $1.06 ITM vs the $732.94 live price, so the live-OTM check
    # rejects it — and the 733P too ($0.06 ITM vs live). The fallback steps
    # to the 732P at $2.80. The price cap is disabled here (tests only) to
    # isolate the live-OTM check: with the $3.00 gate from PR #126 the same
    # pick is reached for a different reason, and this test proves the
    # live-OTM check fixes Nov 19 on its own.
    chain = _put_chain([(734, 6.25), (733, 4.50), (732, 2.80),
                        (731, 2.20), (730, 1.70)])
    best = _select(chain, orl=735.47, trigger=732.94, composite_total=8,
                   max_entry_premium=float("inf"))
    assert best is not None
    assert best["strike"] == 732.0
    assert best["ask"] == pytest.approx(2.80)


# ── SMALL tier ───────────────────────────────────────────────────────────────

def test_small_tier_leans_near_atm():
    # Composite +5 (MODERATE) -> SMALL: the offset window narrows to
    # [1.25, 2.00], so the nearer strike wins — a small expected move
    # needs the delta.
    chain = _put_chain([(734, 2.40), (733, 1.90)])
    best = _select(chain, orl=735.47, trigger=735.20, composite_total=5)
    assert best is not None
    assert best["strike"] == 734.0


# ── Cheap-ITM edge case ──────────────────────────────────────────────────────

def test_cheap_itm_rejected_by_live_otm_check():
    # Trigger $733.50 (ORL $735.47), composite +5 -> SMALL. The 734P is
    # $2.30 — cheap enough to pass any price cap — but $0.50 ITM vs live,
    # so the live-OTM check rejects it and the fallback picks the 733P.
    chain = _put_chain([(734, 2.30), (733, 1.85), (732, 1.45)])
    best = _select(chain, orl=735.47, trigger=733.50, composite_total=5)
    assert best is not None
    assert best["strike"] == 733.0
    assert best["ask"] == pytest.approx(1.85)


def test_no_live_otm_contract_skips_entry():
    # Every quoted strike is ITM vs the $730.00 live price — skip the
    # entry rather than buy ITM. The price cap is disabled here (tests
    # only) so the fallback reaches the live-OTM check instead of the
    # affordability check firing first.
    chain = _put_chain([(734, 6.25), (733, 4.50)])
    best = _select(chain, orl=735.47, trigger=730.00, composite_total=8,
                   max_entry_premium=float("inf"))
    assert best is None
