from .fakes import et

from services.brief.review import aggregate, bucket, orb_levels, resolve_outcome

T = lambda m: et(2026, 10, 5, 9, m)


def test_target_hit_first():
    bars = [(T(33), 248.2, 247.6, 248.0), (T(34), 250.1, 247.9, 250.0), (T(35), 252.6, 249.8, 252.4)]
    r = resolve_outcome(bars, "CALL", 252.5, 245.0)
    assert r["outcome"] == "target_hit" and r["resolved_at"] == T(35)
    assert r["mfe_pct"] > 0 and r["mae_pct"] <= 0


def test_stopped_first():
    bars = [(T(33), 248.0, 246.9, 247.0), (T(34), 247.1, 244.8, 245.0), (T(35), 253.0, 245.0, 252.9)]
    assert resolve_outcome(bars, "CALL", 252.5, 245.0)["outcome"] == "stopped"


def test_both_in_one_bar_is_stopped():
    assert resolve_outcome([(T(33), 252.9, 244.9, 248.0)], "CALL", 252.5, 245.0)["outcome"] == "stopped"


def test_expired_and_empty():
    assert resolve_outcome([(T(33), 248.5, 247.0, 248.0)], "CALL", 252.5, 245.0)["outcome"] == "expired"
    assert resolve_outcome([], "CALL", 252.5, 245.0)["outcome"] is None


def test_put_direction():
    assert resolve_outcome([(T(33), 230, 226.9, 227)], "PUT", 227.0, 232.0)["outcome"] == "target_hit"
    assert resolve_outcome([(T(33), 232.1, 228, 231)], "PUT", 227.0, 232.0)["outcome"] == "stopped"


ZONES = [{"low": 249.5, "high": 250.5, "score": 82}, {"low": 247.6, "high": 248.1, "score": 74},
         {"low": 240, "high": 241, "score": 60}]


def test_orb_levels_call():
    lv = orb_levels("CALL", 248.0, 246.0, ZONES)
    assert lv == {"trigger": 248.0, "invalidation": 246.0, "target": 250.0, "zone_score": 74}


def test_orb_levels_fallback_target_and_no_zone():
    lv = orb_levels("PUT", 248.0, 246.0, [ZONES[0]])
    assert (lv["trigger"], lv["invalidation"], lv["target"], lv["zone_score"]) == (246.0, 248.0, 244.0, None)


def test_buckets():
    assert [bucket(s) for s in (None, 0, 59.9, 60, 79.9, 80, 89.9, 90, 100)] == \
        ["no zone", "<60", "<60", "60–69", "70–79", "80–89", "80–89", "90+", "90+"]


def test_aggregate_win_rate_fill_rate_and_outcomes():
    rows = [
        {"signal_path": "A", "zone_score": 90, "setup_score": 93, "fill_status": "filled", "pnl": 120, "pnl_pct": 40, "outcome": "target_hit"},
        {"signal_path": "A", "zone_score": 85, "setup_score": 88, "fill_status": "filled", "pnl": -45, "pnl_pct": -30, "outcome": "stopped"},
        {"signal_path": "A", "zone_score": 72, "setup_score": 82, "fill_status": "cancelled", "outcome": "target_hit"},
        {"signal_path": "A", "zone_score": 91, "setup_score": 95, "fill_status": "skipped", "outcome": "expired"},
        {"signal_path": "B", "zone_score": None, "fill_status": "filled", "pnl": -60, "pnl_pct": -25, "outcome": "stopped"},
        {"signal_path": "B", "zone_score": None, "fill_status": "filled", "pnl": None, "outcome": None},  # still open
    ]
    a = aggregate(rows)
    A, B = a["by_path"]["A"], a["by_path"]["B"]
    assert (A["signals"], A["traded"], A["win_rate"], A["avg_return_pct"], A["total_pnl"]) == (4, 2, 50.0, 5.0, 75)
    assert A["fill_rate"] == 66.7                      # 2 filled of 3 that reached the broker
    assert (A["target_hit_rate"], A["stopped_rate"], A["expired_rate"]) == (50.0, 25.0, 25.0)
    assert (B["traded"], B["win_rate"]) == (1, 0.0)    # the open trade isn't counted
    zone_rows = {(z["bucket"], z["path"]): z for z in a["by_zone_score"]}
    assert zone_rows[("90+", "A")]["signals"] == 2 and zone_rows[("no zone", "B")]["signals"] == 2
    assert [s["bucket"] for s in a["by_setup_score"]] == ["80–89", "90+"]


def test_aggregate_empty():
    a = aggregate([])
    assert a["overall"]["signals"] == 0 and a["overall"]["win_rate"] is None
