"""
$3.00 max-entry-premium gate (2026-11-19, 0.8.05).

Kareem's hard line: no contract over $3.00, whatever the move (Nov 19
734P at $6.21 — the premium was mostly 0DTE IV, and the crush ate a $4
SPY move). The gate is enforced in select_contract so the strict filter
and the fallback both respect it; the Nov 19 replay test below proves
the 734P would have been rejected and the fallback would have stepped
further OTM to a $2.80 contract.
"""
from types import SimpleNamespace

import pytest

from services.strategy.contract_selector import MAX_ENTRY_PREMIUM, select_contract
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
    """rows: (strike, ask, delta) -> {OCC symbol: fake contract}."""
    return {
        f"SPY261119P{int(strike * 1000):08d}": _contract(ask, delta)
        for strike, ask, delta in rows
    }


PROFILE = get_profile("TREND_RIDER")
# Nov 19 replay anchors: ORL $735.47, trigger close $732.94, SPY waterfall.
ORH, ORL, TRIGGER = 739.77, 735.47, 732.94


def _select(chain, trigger=TRIGGER, **kwargs):
    return select_contract(
        "SPY", "PUT", trigger, ORH, ORL, {}, _FakeClient(chain), PROFILE, **kwargs
    )


def test_cap_default_is_three_dollars():
    assert MAX_ENTRY_PREMIUM == 3.00


def test_strict_filter_rejects_over_cap_pick_and_keeps_affordable():
    # 734P (offset 1.47, in window) is $6.25 — rejected on ask alone.
    # 733P (offset 2.47, in window) is $2.90 — the only strict survivor.
    # Trigger $735.20 (a normal entry, just past the level): on the Nov 19
    # waterfall trigger ($732.94) every in-window strike is ITM vs the live
    # price, so the live-OTM check would reject the 733P too — the strict-
    # survivor case needs a live-OTM in-window strike.
    chain = _put_chain([(734, 6.25, 0.40), (733, 2.90, 0.38), (732, 2.80, 0.35)])
    best = _select(chain, trigger=735.20)
    assert best is not None
    assert best["strike"] == 733.0
    assert best["ask"] == pytest.approx(2.90)


def test_nov19_replay_fallback_steps_further_otm():
    # 734P $6.25 and 733P $4.50 both over the cap; 732P/731P are outside
    # the offset window, so strict is empty. The fallback must step
    # further OTM to the nearest affordable strike — not buy the $6.21.
    chain = _put_chain([(734, 6.25, 0.40), (733, 4.50, 0.38),
                        (732, 2.80, 0.35), (731, 2.20, 0.30)])
    best = _select(chain)
    assert best is not None
    assert best["strike"] == 732.0
    assert best["ask"] == pytest.approx(2.80)


def test_no_affordable_contract_skips_entry():
    chain = _put_chain([(734, 6.25, 0.40), (733, 4.50, 0.38),
                        (732, 3.50, 0.35), (731, 3.10, 0.30)])
    assert _select(chain) is None


def test_cap_boundary_301_rejected_300_accepted():
    chain = _put_chain([(734, 3.01, 0.40), (733, 3.01, 0.38)])
    assert _select(chain, trigger=735.20) is None
    chain = _put_chain([(734, 3.01, 0.40), (733, 3.00, 0.38)])
    best = _select(chain, trigger=735.20)
    assert best is not None
    assert best["strike"] == 733.0


def test_cap_applies_when_greeks_missing():
    # The indicative feed frequently omits greeks, so the delta filter is
    # skipped — the cap must still bind (it needs only the ask).
    # Trigger $735.20 (see test_strict_filter): the Nov 19 waterfall
    # trigger would make the 733P ITM vs live, so the live-OTM check
    # would reject it before the cap is even reached.
    chain = _put_chain([(734, 6.25, None), (733, 2.90, None)])
    best = _select(chain, trigger=735.20)
    assert best is not None
    assert best["strike"] == 733.0


def test_cap_applies_to_calls_too():
    chain = {
        f"SPY261119C{int(strike * 1000):08d}": _contract(ask, delta)
        for strike, ask, delta in [(741, 2.50, 0.40), (742, 2.50, 0.38),
                                   (740, 6.10, 0.42)]
    }
    best = select_contract(
        "SPY", "CALL", 741.50, ORH, ORL, {}, _FakeClient(chain), PROFILE
    )
    assert best is not None
    assert best["strike"] == 742.0
    assert best["ask"] == pytest.approx(2.50)
