"""Zone gate whipsaw fix (TODO 22ad923f): the gate's zone factor keys off
far-edge crosses and stays sticky while price is inside a band, instead of
flipping on the zone's center line.

Run from api/:  python -m pytest tests/test_zone_gate_sticky.py
"""
import sys
import types

import pytest

from services import entry_check_service as ecs

# The IWM 2026-10-01 band from the incident write-up.
LOW, HIGH = 279.05, 279.40


class _FakeTracker:
    flips: list = []

    def get_flipped_zones(self, ticker):
        return list(self.flips)


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    ecs.reset_zone_side_memory()
    _FakeTracker.flips = []
    fake = types.ModuleType("services.strategy.structure_tracker")
    fake.get_structure_tracker = lambda: _FakeTracker()
    monkeypatch.setitem(sys.modules, "services.strategy.structure_tracker", fake)
    yield
    ecs.reset_zone_side_memory()


def _snap(score=76.0, low=LOW, high=HIGH, price=279.0):
    """A zone_engine snapshot with the band labelled by its center vs
    `price` — the positional rule that used to drive the gate."""
    center = round((low + high) / 2, 4)
    z = {"low": low, "high": high, "center": center, "score": score,
         "sources": ["swing", "volume"],
         "type": "resistance" if center > price else "support"}
    side = "resistance" if z["type"] == "resistance" else "support"
    return {"support": [z] if side == "support" else [],
            "resistance": [z] if side == "resistance" else [],
            "tolerance": 0.05, "current_price": price}


def _row(price, **kw):
    # A fresh snapshot per call, relabelled at the new price — exactly how
    # zone_engine refreshes it (this is what flipped at the center line).
    return ecs._zone_row("IWM", price, snap=_snap(price=price, **kw))


def _verdict(direction, zone_row):
    return ecs.compute_verdict(direction, {"zone": zone_row})


def _blocked(direction, zone_row):
    v = _verdict(direction, zone_row)
    return any("zone" in b for b in v.get("blockers", []))


def test_center_line_drift_never_flips_position():
    """Acceptance 1: $278.80 → $279.11 → $279.25 → $278.95, never through
    either edge for good — the position (and so the hard block) holds."""
    path = [278.80, 279.11, 279.25, 278.95]
    positions = [_row(p)["position"] for p in path]
    assert positions == ["at_resistance"] * 4

    # The old bug: CALL blocked below the center, PUT blocked above it.
    # Now the CALL stays blocked and the PUT never is, across the path.
    for p in path:
        row = _row(p)
        assert _blocked("CALL", row)
        assert not _blocked("PUT", row)


def test_close_above_far_edge_flips_once_then_sticks_inside():
    """Acceptance 2: above $279.40 → at_support exactly once; back inside
    at $279.20 keeps at_support."""
    seq = [_row(p)["position"] for p in (279.10, 279.45, 279.20, 279.30)]
    assert seq == ["at_resistance", "at_support", "at_support", "at_support"]
    assert sum(1 for a, b in zip(seq, seq[1:]) if a != b) == 1


def test_close_below_near_edge_becomes_resistance():
    """Acceptance 3: from support (price above the band), a print below
    $279.05 makes the band resistance; drifting back inside keeps it."""
    assert _row(279.50)["position"] == "at_support"
    assert _row(279.30)["position"] == "at_support"      # inside: sticky
    assert _row(279.00)["position"] == "at_resistance"   # below the low edge
    assert _row(279.30)["position"] == "at_resistance"   # inside: sticky


def test_strong_overhead_zone_still_blocks_call():
    """Acceptance 4: a 90-score zone overhead hard-blocks a CALL."""
    row = _row(279.00, score=90.0)
    assert row["position"] == "at_resistance"
    v = _verdict("CALL", row)
    assert v["blockers"], v
    assert not _blocked("PUT", row)


def test_new_zone_inside_falls_back_to_center_rule():
    """First sighting while already inside: the center rule decides."""
    assert _row(279.30)["position"] == "at_support"      # above center 279.225
    ecs.reset_zone_side_memory()
    assert _row(279.10)["position"] == "at_resistance"   # below center


def test_structural_flip_overrides_sticky_side_inside():
    """A confirmed StructureTracker break (1m close through the zone) still
    changes the read while inside — sticky only replaces center-line noise."""
    assert _row(279.10)["position"] == "at_resistance"
    _FakeTracker.flips = [{"low": LOW, "high": HIGH, "current_type": "support"}]
    assert _row(279.15)["position"] == "at_support"


def test_zone_matched_across_refresh_bound_shifts():
    """zone_engine recomputes bounds each refresh — a cent of drift in the
    band edges is still the same zone (sticky state survives)."""
    assert _row(279.10)["position"] == "at_resistance"
    assert ecs._zone_row("IWM", 279.30, snap=_snap(low=279.06, high=279.41, price=279.30))["position"] \
        == "at_resistance"


def test_idle_ticker_is_evicted():
    ecs.sticky_zone_position("IWM", {"low": LOW, "high": HIGH, "type": "resistance"}, 279.10, now=1000.0)
    later = 1000.0 + ecs._ZONE_SIDE_TTL_S + 1
    # Memory gone → first-sighting center rule again (279.30 > center).
    assert ecs.sticky_zone_position("IWM", {"low": LOW, "high": HIGH, "type": "support"}, 279.30, now=later) \
        == "at_support"
