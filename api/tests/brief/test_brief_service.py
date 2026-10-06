"""End-to-end flow of BriefService against FakeIO: build → lock → live 1m
bars → guards / gate → confirm or auto entry → signal log."""
import threading
from datetime import timedelta
from types import SimpleNamespace

import pytest

import services.brief.brief_service as bs

from .fakes import AMZN, META, Bar, FakeIO, InlineThread, et, long_setup

D1 = (2026, 10, 5)
D2 = (2026, 10, 6)


@pytest.fixture(autouse=True)
def inline_threads(monkeypatch):
    # Swap only brief_service's own `threading` reference. Patching
    # bs.threading.Thread replaced Thread process-wide — including the
    # ThreadPoolExecutor in _score_universe, whose worker then ran inline and
    # looped forever waiting for work, hanging every brief-building test.
    monkeypatch.setattr(bs, "threading", SimpleNamespace(
        Thread=InlineThread, Lock=threading.Lock, RLock=threading.RLock))


def bar(day, h, m, o, c, v):
    return Bar(et(*day, h, m), o, c, v)


def locked(io=None, day=D1, **cfg):
    """A service with AMZN + META locked and armed for `day`, clock at 9:31."""
    io = io or FakeIO(et(*day, 9, 0))
    io.t = et(*day, 9, 28)
    io.cfg.update(cfg)
    io.inputs = {"AMZN": long_setup(**AMZN), "META": long_setup(**META)}
    svc = bs.BriefService(io)
    svc.generate("lock")
    io.t = et(*day, 9, 31)
    return io, svc


def status(svc, t):
    p = svc._play(t)
    return p["status"], p["status_reason"]


# ── build / re-score / lock ────────────────────────────────────────────────

def test_build_pushes_and_rescore_keeps_modes_quietly():
    io = FakeIO(et(*D1, 9, 0))
    io.inputs = {"AMZN": long_setup(**AMZN), "META": long_setup(**META)}
    svc = bs.BriefService(io)
    b = svc.generate("build")
    assert {p["ticker"] for p in b["plays"]} == {"AMZN", "META"}
    assert all(p["status"] == "watching" and p["mode"] == "confirm" for p in b["plays"])
    assert io.pushes[-1][0] == "active"
    svc.set_mode("AMZN", "auto")
    io.t = et(*D1, 9, 10)
    svc.generate("rescore")
    assert svc._play("AMZN")["mode"] == "auto"
    assert len(io.pushes) == 1          # top 4 unchanged → no re-push


def test_lock_cuts_below_min_score_and_never_rebuilds():
    io, svc = locked(min_setup_score=92)
    assert status(svc, "AMZN")[0] == "armed"          # 93.5
    assert status(svc, "META")[0] == "cut"            # 91.0
    assert set(io.subs) == {"AMZN"}
    assert svc.generate("rescore")["phase"] == "lock"


# ── live triggers ──────────────────────────────────────────────────────────

def test_gap_through_trigger_at_930_stands_down():
    io, svc = locked()
    io.subs["AMZN"](bar(D1, 9, 30, 248.60, 248.70, 90000))
    s, reason = status(svc, "AMZN")
    assert s == "stood_down" and "not chasing" in reason


def test_volume_and_close_through_required():
    io, svc = locked()
    io.subs["AMZN"](bar(D1, 9, 30, 247.55, 247.78, 90000))      # 1.1x
    assert status(svc, "AMZN")[0] == "armed"
    io.subs["AMZN"](bar(D1, 9, 31, 247.70, 247.85, 164000))     # 2x
    assert status(svc, "AMZN")[0] == "awaiting_confirmation"
    assert io.pushes[-1][0] == "active"


def test_auto_mode_enters_and_logs_a_filled_signal():
    io, svc = locked()
    svc.set_mode("AMZN", "auto")
    io.subs["AMZN"](bar(D1, 9, 30, 247.55, 247.85, 164000))
    assert status(svc, "AMZN")[0] == "filled"
    row = io.signals["A-2026-10-05-AMZN"]
    assert (row["fill_status"], row["trade_id"], row["entry_premium"], row["profile"]) == \
        ("filled", "tr-AMZN", 0.52, "SCALP_30_100")
    assert (row["gate_agree"], row["gate_total"], row["zone_score"]) == (4, 6, 90)


def test_gate_wait_rearms_without_logging_a_signal():
    io, svc = locked()
    io.gate["AMZN"] = "WAIT"
    io.subs["AMZN"](bar(D1, 9, 30, 247.55, 247.85, 164000))
    s, reason = status(svc, "AMZN")
    assert s == "armed" and "WAIT" in reason
    assert io.signals == {}


def test_trigger_bar_too_far_through_stands_down():
    io, svc = locked()
    io.subs["AMZN"](bar(D1, 9, 30, 247.55, 247.60, 70000))
    io.subs["AMZN"](bar(D1, 9, 31, 247.70, 248.60, 200000))
    assert status(svc, "AMZN")[0] == "stood_down"


def test_kill_switch_and_orb_overlap_stand_down_and_log():
    io, svc = locked()
    io.losses = 2
    io.subs["AMZN"](bar(D1, 9, 30, 247.55, 247.85, 170000))
    assert "kill switch" in status(svc, "AMZN")[1]
    assert io.signals["A-2026-10-05-AMZN"]["fill_status"] == "stood_down"
    io.losses = 0  # kill switch is checked first — clear it to reach the ORB guard
    io.orb_open = {"META"}
    io.subs["META"](bar(D1, 9, 30, 700.5, 701.5, 170000))
    assert "ORB strategy" in status(svc, "META")[1]


def test_max_open_waits_and_rechecks_on_the_next_trigger_bar():
    io, svc = locked()
    io.open = 2
    io.subs["AMZN"](bar(D1, 9, 30, 247.55, 247.85, 170000))
    s, reason = status(svc, "AMZN")
    assert s == "armed" and "re-checking" in reason
    assert io.signals == {}
    io.open = 1
    io.subs["AMZN"](bar(D1, 9, 32, 247.80, 247.90, 170000))
    assert status(svc, "AMZN")[0] == "awaiting_confirmation"


def test_confirm_enters_skip_and_expiry_are_logged():
    io, svc = locked()
    io.subs["AMZN"](bar(D1, 9, 30, 247.55, 247.85, 170000))
    svc.confirm("AMZN")
    assert status(svc, "AMZN")[0] == "filled"

    io.subs["META"](bar(D1, 9, 30, 700.5, 701.5, 170000))
    svc.skip("META")
    assert io.signals["A-2026-10-05-META"]["fill_status"] == "skipped"

    io2, svc2 = locked()
    io2.subs["AMZN"](bar(D1, 9, 30, 247.55, 247.85, 170000))
    io2.t += timedelta(minutes=5, seconds=1)
    with pytest.raises(ValueError, match="expired"):
        svc2.confirm("AMZN")
    assert io2.signals["A-2026-10-05-AMZN"]["fill_status"] == "expired"


# ── confirm card v3 (TODO 548f02a4) ────────────────────────────────────────

def test_confirm_window_is_five_minutes_capped_at_ten():
    io, svc = locked()
    io.subs["AMZN"](bar(D1, 9, 30, 247.55, 247.85, 170000))
    assert svc._play("AMZN")["confirm_expires_at"].startswith("2026-10-05T09:36:00")

    io2, svc2 = locked()
    io2.t = et(*D1, 9, 57)
    io2.subs["AMZN"](bar(D1, 9, 57, 247.55, 247.85, 170000))
    p = svc2._play("AMZN")
    assert p["status"] == "awaiting_confirmation"
    assert p["confirm_expires_at"].startswith("2026-10-05T10:00:00")  # capped, not 10:02
    assert "3:00" in p["status_reason"]


def test_trigger_attaches_contract_candidates_top_pick_first():
    io, svc = locked()
    io.subs["AMZN"](bar(D1, 9, 30, 247.55, 247.85, 170000))
    c = svc._play("AMZN")["contract_candidates"]
    assert [x["symbol"] for x in c] == ["AMZN261005C00250000", "AMZN261005C00252500"]
    assert c[0]["top_pick"] and not c[1]["top_pick"]
    assert svc._play("AMZN")["paper_mode"] is True


def test_confirm_with_picked_contract_live_flows_to_entry_and_log():
    io, svc = locked()
    io.subs["AMZN"](bar(D1, 9, 30, 247.55, 247.85, 170000))
    svc.confirm("AMZN", "AMZN261005C00252500", False)
    assert io.entered[-1] == ("AMZN", "AMZN261005C00252500", False)
    assert status(svc, "AMZN")[0] == "filled"
    assert io.signals["A-2026-10-05-AMZN"]["paper_mode"] is False


def test_confirm_defaults_to_top_pick_on_paper():
    io, svc = locked()
    io.subs["AMZN"](bar(D1, 9, 30, 247.55, 247.85, 170000))
    svc.confirm("AMZN")
    assert io.entered[-1] == ("AMZN", None, True)
    assert io.signals["A-2026-10-05-AMZN"]["paper_mode"] is True


def test_confirm_rejects_a_contract_that_was_not_offered():
    io, svc = locked()
    io.subs["AMZN"](bar(D1, 9, 30, 247.55, 247.85, 170000))
    with pytest.raises(ValueError, match="offered"):
        svc.confirm("AMZN", "AMZN261005C00300000", True)
    assert status(svc, "AMZN")[0] == "awaiting_confirmation"


def test_mode_locked_once_triggered():
    io, svc = locked()
    io.subs["AMZN"](bar(D1, 9, 30, 247.55, 247.85, 170000))
    with pytest.raises(ValueError):
        svc.set_mode("AMZN", "auto")


def test_no_trigger_by_10_stands_down_quietly():
    io, svc = locked()
    io.t = et(*D1, 10, 1)
    io.subs["AMZN"](bar(D1, 10, 0, 247.5, 247.6, 1000))
    assert status(svc, "AMZN") == ("stood_down", "no trigger in the 9:30–10:00 window")
    assert all("stood down" not in p[1] for p in io.pushes)


def test_unfilled_order_is_cancelled_and_logged():
    io, svc = locked()
    svc.set_mode("AMZN", "auto")
    io.entry_result = {"state": "CANCELLED_TIMEOUT", "reason": "not filled within 75s"}
    io.subs["AMZN"](bar(D1, 9, 30, 247.55, 247.85, 170000))
    assert status(svc, "AMZN") == ("cancelled", "not filled within 75s")
    assert io.signals["A-2026-10-05-AMZN"]["fill_status"] == "cancelled"
    assert io.pushes[-1][0] == "active"


# ── regressions: per-day state + restart ──────────────────────────────────

def test_day_rollover_resets_bars_and_still_runs_the_open_check():
    """Singleton survives overnight: day 2 must not reuse day 1's bars, and
    the 9:30 stale-at-open check must run again for a repeat ticker."""
    io, svc = locked(day=D1)
    for m in range(30, 45):     # 15 heavy day-1 bars, no trigger (below 247.75)
        io.subs["AMZN"](bar(D1, 9, m, 247.5, 247.6, 5_000_000))
    assert len(svc._session_bars["AMZN"]) == 15

    io.t = et(*D2, 9, 0)
    io.inputs = {"AMZN": long_setup(**AMZN), "META": long_setup(**META)}
    svc.generate("build")
    assert svc._session_bars == {} and svc._last_price == {}
    io.t = et(*D2, 9, 28)
    svc.generate("lock")
    io.t = et(*D2, 9, 31)

    io.subs["AMZN"](bar(D2, 9, 30, 248.60, 248.70, 90000))       # gapped through
    s, reason = status(svc, "AMZN")
    assert s == "stood_down" and "not chasing" in reason


def test_day_rollover_baseline_uses_only_todays_bars():
    io, svc = locked(day=D1)
    for m in range(30, 45):
        io.subs["AMZN"](bar(D1, 9, m, 247.5, 247.6, 5_000_000))
    io.t = et(*D2, 9, 28)
    io.inputs = {"AMZN": long_setup(**AMZN)}
    svc.generate("lock")
    io.t = et(*D2, 9, 31)
    # 1.5x yesterday's IEX opening baseline — would be far below the 5M-volume
    # average if day-1 bars leaked into the baseline.
    io.subs["AMZN"](bar(D2, 9, 30, 247.55, 247.85, 123000))
    assert status(svc, "AMZN")[0] == "awaiting_confirmation"


def test_restart_mid_session_does_not_treat_first_bar_as_the_open():
    """A restart at ~9:44 resumes the locked brief; the first bar seen is
    9:45. Its open being > 0.3% past the trigger must not stand the play down
    — only the real 9:30 bar gets the stale-at-open check."""
    io, svc = locked()
    io.subs["AMZN"](bar(D1, 9, 30, 247.55, 247.60, 70000))      # normal open
    restarted = bs.BriefService(io)                              # fresh singleton, same DB
    io.subs.clear()
    restarted.start_watching()
    assert "AMZN" in io.subs
    io.t = et(*D1, 9, 46)
    io.subs["AMZN"](bar(D1, 9, 45, 248.60, 248.40, 164000))      # open 0.34% through, close 0.26%
    assert status(restarted, "AMZN")[0] == "awaiting_confirmation"


def test_restart_still_blocks_a_chased_trigger_bar():
    io, svc = locked()
    restarted = bs.BriefService(io)
    io.subs.clear()
    restarted.start_watching()
    io.t = et(*D1, 9, 46)
    io.subs["AMZN"](bar(D1, 9, 45, 248.60, 248.70, 164000))      # close 0.38% through
    assert status(restarted, "AMZN")[0] == "stood_down"


# ── entry-mode preferences (digest toggle) ─────────────────────────────────

def test_build_seeds_modes_from_entry_modes_table():
    io = FakeIO(et(*D1, 9, 0))
    io.inputs = {"AMZN": long_setup(**AMZN), "META": long_setup(**META)}
    io.set_entry_mode("AMZN", "auto")   # set from the digest before the build
    svc = bs.BriefService(io)
    b = svc.generate("build")
    modes = {p["ticker"]: p["mode"] for p in b["plays"]}
    assert modes["AMZN"] == "auto"
    assert modes["META"] == "confirm"   # default stays confirm


def test_set_mode_persists_to_entry_modes():
    io = FakeIO(et(*D1, 9, 0))
    io.inputs = {"AMZN": long_setup(**AMZN), "META": long_setup(**META)}
    svc = bs.BriefService(io)
    svc.generate("build")
    svc.set_mode("AMZN", "auto")
    assert io.entry_modes()["AMZN"] == "auto"
    # A fresh-day build picks the persisted preference back up.
    io2 = FakeIO(et(*D2, 9, 0))
    io2.inputs = {"AMZN": long_setup(**AMZN), "META": long_setup(**META)}
    io2.modes = dict(io.modes)
    svc2 = bs.BriefService(io2)
    b2 = svc2.generate("build")
    assert {p["ticker"]: p["mode"] for p in b2["plays"]}["AMZN"] == "auto"


def test_set_entry_mode_rejects_bad_mode():
    io = FakeIO(et(*D1, 9, 0))
    try:
        io.set_entry_mode("AMZN", "yolo")
    except ValueError:
        pass
    else:
        raise AssertionError("expected ValueError")
