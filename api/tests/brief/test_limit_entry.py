import pytest

from .fakes import FakeBroker, install_alpaca_stubs


@pytest.fixture
def run(monkeypatch):
    install_alpaca_stubs(monkeypatch)
    from services.brief.limit_entry import run_limit_entry

    def _run(broker, price=lambda: 247.80, timeout=75, drift_pct=0.003):
        clock = {"t": 0.0}

        def sleep(_):
            clock["t"] += 1
            broker.t = clock["t"]

        states = []
        res = run_limit_entry(broker, "C252", 3, 0.52, 247.75, price,
                              on_update=lambda s, i: states.append((s, i)),
                              clock=lambda: clock["t"], sleep=sleep, timeout=timeout, drift_pct=drift_pct)
        return res, [s for s, _ in states], clock["t"]
    return _run


def kinds(broker):
    return [(o.kind, getattr(o, "side", None)) for o in broker.orders]


def test_fills(run):
    b = FakeBroker(lambda t, c: ("filled", 3) if t >= 5 else ("new", 0))
    res, states, _ = run(b)
    assert res["state"] == "FILLED" and res["filled_qty"] == 3 and res["avg_price"] == 0.52
    assert states == ["WORKING", "FILLED"]
    assert kinds(b) == [("LimitOrderRequest", "buy")]
    assert b.orders[0].limit_price == 0.52


def test_times_out_at_the_configured_timeout(run):
    b = FakeBroker(lambda t, c: ("new", 0))
    res, states, elapsed = run(b, timeout=75)
    assert res["state"] == "CANCELLED_TIMEOUT" and elapsed == 75
    assert b.cancelled
    assert states[-1] == "CANCELLED_TIMEOUT"
    res, _, elapsed = run(FakeBroker(lambda t, c: ("new", 0)), timeout=30)
    assert elapsed == 30


def test_cancels_when_underlying_drifts(run):
    prices = iter([247.80] * 10 + [248.60] * 100)
    res, _, elapsed = run(FakeBroker(lambda t, c: ("new", 0)), price=lambda: next(prices))
    assert res["state"] == "CANCELLED_STALE" and elapsed == 10
    assert "248.60" in res["reason"]


def test_drift_band_is_configurable(run):
    res, _, _ = run(FakeBroker(lambda t, c: ("new", 0)), price=lambda: 248.60, drift_pct=0.005)
    assert res["state"] == "CANCELLED_TIMEOUT"   # 0.34% is inside a 0.5% band


def test_missing_price_does_not_cancel(run):
    res, _, _ = run(FakeBroker(lambda t, c: ("new", 0)), price=lambda: None)
    assert res["state"] == "CANCELLED_TIMEOUT"


def test_partial_fill_is_flattened_as_a_scratch(run):
    b = FakeBroker(lambda t, c: ("canceled", 2) if c else ("partially_filled", 2))
    res, states, _ = run(b)
    assert res["state"] == "SCRATCH" and res["filled_qty"] == 2
    assert kinds(b) == [("LimitOrderRequest", "buy"), ("MarketOrderRequest", "sell")]
    assert b.orders[1].qty == 2
    assert states[-1] == "SCRATCH"


def test_fill_that_lands_during_the_cancel_counts_as_filled(run):
    b = FakeBroker(lambda t, c: ("filled", 3) if c else ("new", 0))
    res, _, _ = run(b)
    assert res["state"] == "FILLED"
    assert kinds(b) == [("LimitOrderRequest", "buy")]   # nothing flattened


def test_broker_reject(run):
    res, states, _ = run(FakeBroker(lambda t, c: ("new", 0), reject=True))
    assert res["state"] == "ERROR" and "buying power" in res["reason"]
    assert states == ["ERROR"]


def test_broker_side_cancel_ends_the_wait(run):
    res, _, elapsed = run(FakeBroker(lambda t, c: ("canceled", 0) if t >= 3 else ("new", 0)))
    assert res["state"] == "CANCELLED_TIMEOUT" and elapsed == 3
    assert "by broker" in res["reason"]


def test_partial_that_cannot_be_flattened_is_an_error(run):
    b = FakeBroker(lambda t, c: ("canceled", 1) if c else ("partially_filled", 1), flatten_fails=True)
    res, _, _ = run(b)
    assert res["state"] == "ERROR" and res["filled_qty"] == 1
    assert "could not be flattened" in res["reason"]
