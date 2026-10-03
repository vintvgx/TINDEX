from services.brief import scoring
from services.brief.scoring import rank_plays, score_setup, score_ticker

from .fakes import AMZN, long_setup, zone


def test_weights_sum_to_100():
    assert sum((scoring.W_ZONE, scoring.W_PROX, scoring.W_REWARD, scoring.W_TREND,
                scoring.W_RSI, scoring.W_PM, scoring.W_PRIOR)) == 100


def test_strong_long_scores_high_and_levels_come_from_zones():
    s = score_ticker("AMZN", long_setup(**AMZN))
    assert s["direction"] == "CALL"
    assert s["trigger"] == 247.75            # top of the resistance trigger zone
    assert s["target"] == 252.5              # centre of the next zone up
    assert s["invalidation"] == 244.5        # bottom of the support below
    assert s["score"] >= 85
    assert s["blocked"] is None
    assert abs(sum(s["components"].values()) - s["score"]) < 0.5


def test_score_never_exceeds_100_and_components_respect_weights():
    s = score_setup("CALL", long_setup(**AMZN))
    caps = {"zone": 25, "proximity": 15, "reward": 15, "trend": 15, "rsi": 10, "premarket": 10, "prior_day": 10}
    for k, v in s["components"].items():
        assert 0 <= v <= caps[k], k
    assert s["score"] <= 100


def test_counter_trend_and_exhausted_rsi_score_lower():
    good = score_setup("CALL", long_setup(**AMZN))["score"]
    bad = score_setup("CALL", long_setup(**AMZN, trend="Bearish", rsi=78))["score"]
    assert good - bad >= 25   # loses the full trend (15) and RSI (10) weights


def test_far_trigger_scores_no_proximity():
    far = long_setup(price=240.0, trig=(247.25, 247.75), tgt=(252.0, 253.0), sup=(235.0, 236.0))
    assert score_setup("CALL", far)["components"]["proximity"] == 0


def test_tiny_move_to_target_scores_no_reward():
    tight = long_setup(price=247.60, trig=(247.25, 247.75), tgt=(247.80, 248.0), sup=(244.5, 245.5))
    assert score_setup("CALL", tight)["components"]["reward"] == 0   # < 0.25% move


def test_no_target_zone_means_no_setup():
    inp = {"price": 100.0, "zones": [zone(100.5, 101.0, 80, "resistance")]}
    assert score_setup("CALL", inp) is None


def test_short_setup_uses_support_bottom_as_trigger():
    inp = {"price": 100.0, "trend": "Bearish", "rsi": 40, "gap_pct": -0.5,
           "zones": [zone(99.2, 99.8, 85, "support"), zone(96.0, 97.0, 75, "support"),
                     zone(101.0, 101.5, 70, "resistance")]}
    s = score_setup("PUT", inp)
    assert (s["trigger"], s["target"], s["invalidation"]) == (99.2, 96.5, 101.5)


def test_earnings_and_weak_zone_block():
    assert score_ticker("X", long_setup(**AMZN, earnings=1))["blocked"] == "earnings in 1 day"
    assert score_ticker("X", long_setup(**AMZN, earnings=5))["blocked"] is None
    assert score_ticker("X", long_setup(**AMZN), earnings_block_days=7) is not None
    blocked = score_ticker("X", long_setup(**AMZN), min_trigger_zone_score=95)["blocked"]
    assert blocked.startswith("trigger zone scores 90")


def test_rank_takes_top_4_unblocked_and_labels_one_thesis():
    plays = [dict(score_ticker(f"T{i}", long_setup(**AMZN)), score=90 - i) for i in range(5)]
    plays.append(dict(score_ticker("E", long_setup(**AMZN, earnings=0)), score=99))
    r = rank_plays(plays)
    assert [p["ticker"] for p in r["plays"]] == ["T0", "T1", "T2", "T3"]
    assert r["blocked"] == [{"ticker": "E", "reason": "earnings in 0 days"}]
    assert r["correlation_label"].startswith("4 of 4 plays are long Technology")


def test_no_label_when_theses_differ():
    a = score_ticker("A", long_setup(**AMZN, sector="Technology"))
    b = score_ticker("B", long_setup(**AMZN, sector="Energy"))
    assert rank_plays([a, b])["correlation_label"] is None
