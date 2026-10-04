import pytest

from services.brief.config import DEFAULTS, SCHEMA, merged, validate_patch


def test_defaults_are_the_agreed_plan():
    assert DEFAULTS["min_setup_score"] == 80
    assert DEFAULTS["trigger_volume_mult"] == 1.2
    assert DEFAULTS["stale_pct"] == 0.003
    assert DEFAULTS["limit_timeout_seconds"] == 75
    assert DEFAULTS["confirm_ttl_seconds"] == 180
    assert DEFAULTS["max_losses_per_day"] == 2
    assert DEFAULTS["max_open_trades"] == 2


def test_defaults_inside_their_own_bounds():
    for k, (d, lo, hi, _) in SCHEMA.items():
        assert lo <= d <= hi, k


def test_validate_casts_and_bounds():
    assert validate_patch({"trigger_volume_mult": "1.5", "max_open_trades": 3.0}) == \
        {"trigger_volume_mult": 1.5, "max_open_trades": 3}


@pytest.mark.parametrize("patch", [{"trigger_volume_mult": 0.5}, {"stale_pct": 0.5}, {"foo": 1},
                                   {"max_open_trades": "x"}, {}, None])
def test_validate_rejects(patch):
    with pytest.raises(ValueError):
        validate_patch(patch)


def test_merged_skips_bad_stored_values():
    cfg = merged({"stale_pct": 5, "max_open_trades": 3, "junk": 1})
    assert cfg["stale_pct"] == DEFAULTS["stale_pct"] and cfg["max_open_trades"] == 3 and "junk" not in cfg
