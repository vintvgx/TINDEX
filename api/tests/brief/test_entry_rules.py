from datetime import time

import pytest

from services.brief import entry_rules as r


@pytest.mark.parametrize("premium,qty,profile", [
    (0.20, 3, "SCALP_30_100"), (1.00, 3, "SCALP_30_100"),
    (1.01, 2, "SCALP_50"), (1.50, 2, "SCALP_50"),
    (1.51, 1, "SCALP_100"), (2.50, 1, "SCALP_100"),
])
def test_size_tiers(premium, qty, profile):
    t = r.size_tier(premium)
    assert (t["qty"], t["profile"]) == (qty, profile)


def test_over_budget_has_no_tier():
    assert r.size_tier(2.51) is None


def test_spread_gate_bands():
    assert r.spread_gate(0.95, 1.05)["action"] == "ask"          # 10%
    g = r.spread_gate(0.85, 1.10)                                  # 25.6%
    assert g["action"] == "mid" and g["limit"] == 0.98
    assert r.spread_gate(0.60, 1.00)["action"] == "skip"          # 50%
    assert r.spread_gate(0, 0)["action"] == "skip"
    assert r.spread_gate(1.10, 1.00)["action"] == "skip"          # crossed quote


def test_spread_gate_boundaries():
    # spread = (ask - bid) / mid; with ask 1.00 the 15% edge is bid ≈ 0.8605
    # and the 30% edge bid ≈ 0.7391
    assert r.spread_gate(0.8605, 1.0)["action"] == "ask"    # 14.996%
    assert r.spread_gate(0.86, 1.0)["action"] == "mid"      # 15.05%
    assert r.spread_gate(0.7392, 1.0)["action"] == "mid"    # 29.99%
    assert r.spread_gate(0.739, 1.0)["action"] == "skip"    # 30.02%


def test_trigger_needs_close_through_and_volume():
    assert r.trigger_hit("CALL", 247.75, 247.78, 98400, 82000)            # exactly 1.2x
    assert not r.trigger_hit("CALL", 247.75, 247.78, 98300, 82000)        # just under
    assert not r.trigger_hit("CALL", 247.75, 247.75, 500000, 82000)       # touch, not through
    assert not r.trigger_hit("CALL", 247.75, 247.80, 500000, None)        # no baseline → no signal
    assert r.trigger_hit("PUT", 99.20, 99.10, 200, 100)
    assert not r.trigger_hit("PUT", 99.20, 99.30, 200, 100)
    assert not r.trigger_hit("CALL", 247.75, 247.80, 164000, 82000, volume_mult=2.5)


def test_stale_and_drift():
    assert r.stale_through("CALL", 100.0, 100.31)
    assert not r.stale_through("CALL", 100.0, 100.29)
    assert not r.stale_through("CALL", 100.0, 99.0)                      # below isn't "through"
    assert r.stale_through("PUT", 100.0, 99.69)
    assert r.stale_through("CALL", 100.0, 100.6, pct=0.005)
    assert r.drifted(100.0, 99.69) and r.drifted(100.0, 100.31)          # either direction
    assert not r.drifted(100.0, 100.2)


def test_entry_window():
    assert r.in_entry_window(time(9, 30))
    assert r.in_entry_window(time(9, 59, 59))
    assert not r.in_entry_window(time(10, 0))
    assert not r.in_entry_window(time(9, 29))


CHAIN = [
    {"symbol": "C247", "strike": 247.5, "ask": 2.90, "bid": 2.80, "delta": 0.55},  # over budget
    {"symbol": "C249", "strike": 249.0, "ask": 1.40, "bid": 1.30, "delta": 0.42},
    {"symbol": "C251", "strike": 251.0, "ask": 0.80, "bid": 0.74, "delta": 0.30},
    {"symbol": "C252", "strike": 252.5, "ask": 0.52, "bid": 0.48, "delta": 0.21},
    {"symbol": "C255", "strike": 255.0, "ask": 0.20, "bid": 0.18, "delta": 0.10},  # lottery ticket
    {"symbol": "C250", "strike": 250.0, "ask": 1.00, "bid": 0.50, "delta": 0.36},  # 67% spread
]


def test_pick_anchors_near_target_within_delta_and_spread_rules():
    pick = r.pick_contract(CHAIN, "CALL", 247.75, 252.50)
    assert pick["symbol"] == "C252"
    assert pick["tier"]["profile"] == "SCALP_30_100"
    assert pick["gate"]["action"] == "ask"
    assert 0.20 <= pick["delta_target"] <= 0.60


def test_pick_excludes_lottery_wide_and_over_budget():
    allowed = {r.pick_contract([row], "CALL", 247.75, 252.50) is not None for row in CHAIN[:1] + CHAIN[4:]}
    assert allowed == {False}


def test_pick_without_greeks_keeps_strike_between_trigger_and_target():
    rows = [dict(c, delta=None) for c in CHAIN]
    pick = r.pick_contract(rows, "CALL", 247.75, 252.50)
    assert 247.75 <= pick["strike"] <= 252.50
    put_rows = [{"symbol": "P96", "strike": 96.0, "ask": 0.6, "bid": 0.55, "delta": None},
                {"symbol": "P101", "strike": 101.0, "ask": 0.6, "bid": 0.55, "delta": None}]
    assert r.pick_contract(put_rows, "PUT", 99.2, 96.5) is None   # 96 below target, 101 above trigger


def test_pick_needs_a_move():
    assert r.pick_contract(CHAIN, "CALL", 250.0, 250.0) is None


GUARD = dict(brief_losses_today=0, open_brief_trades=0, orb_position_open=False, now_t=time(9, 40))


def test_guard_passes_when_clear():
    assert r.play_guard({}, **GUARD) is None


@pytest.mark.parametrize("override,fragment", [
    ({"brief_losses_today": 2}, "kill switch"),
    ({"orb_position_open": True}, "ORB strategy"),
    ({"now_t": time(10, 1)}, "entry window"),
])
def test_terminal_guards(override, fragment):
    reason, retry = r.play_guard({}, **{**GUARD, **override})
    assert fragment in reason and retry is False


def test_max_open_is_a_retry_not_a_stand_down():
    reason, retry = r.play_guard({}, **{**GUARD, "open_brief_trades": 2})
    assert retry is True and "re-checking" in reason
    # but a terminal reason wins over max-open
    assert r.play_guard({}, **{**GUARD, "open_brief_trades": 2, "brief_losses_today": 2})[1] is False
