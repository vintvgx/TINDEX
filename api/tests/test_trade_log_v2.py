"""Trade Logging v2 writer + timezone fix.

Run from api/:  python -m pytest tests/test_trade_log_v2.py

TradeLogger is constructed without a Supabase connection (``__new__`` +
a fake client) so these tests never touch a database.
"""

import json
import subprocess
import sys
from datetime import datetime

import pytest

from services.strategy.trade_logger import (
    build_log_v2_cascade_event,
    build_log_v2_entry,
    build_log_v2_exit_event,
    composite_rows,
    config_hash,
    utcnow_iso,
    TradeLogger,
)


# ── Fake Supabase client ────────────────────────────────────────────────────

class _FakeQuery:
    def __init__(self, table, client):
        self.table = table
        self.client = client
        self._op = None
        self._payload = None
        self._eq = {}

    def insert(self, row):
        self._op, self._payload = "insert", dict(row)
        return self

    def update(self, patch):
        self._op, self._payload = "update", dict(patch)
        return self

    def select(self, *_cols):
        self._op = "select"
        return self

    def eq(self, col, val):
        self._eq[col] = val
        return self

    def order(self, *_a, **_k):
        return self

    def limit(self, *_a):
        return self

    def execute(self):
        return self.client._execute(self)


class _FakeTable:
    def __init__(self, client):
        self.client = client

    def insert(self, row):
        return _FakeQuery("orb_trades", self.client).insert(row)

    def update(self, patch):
        return _FakeQuery("orb_trades", self.client).update(patch)

    def select(self, *cols):
        return _FakeQuery("orb_trades", self.client).select(*cols)


class FakeClient:
    """Records writes; select returns the row set in ``rows``; optionally
    raises on any update carrying log_v2 (simulates the missing column)."""

    def __init__(self, rows=None, fail_log_v2_update=False):
        self.rows = rows or []
        self.writes = []
        self.fail_log_v2_update = fail_log_v2_update

    def table(self, _name):
        return _FakeTable(self)

    def _execute(self, q):
        if q._op == "insert":
            row = dict(q._payload)
            row.setdefault("id", "trade-1")
            self.writes.append(("insert", row))
            if "log_v2" in row and self.fail_log_v2_update:
                raise Exception('column "log_v2" does not exist')
            return _FakeResult([row])
        if q._op == "update":
            if "log_v2" in q._payload and self.fail_log_v2_update:
                raise Exception('column "log_v2" does not exist')
            self.writes.append(("update", dict(q._payload)))
            return _FakeResult([{"id": "trade-1"}])
        # select
        return _FakeResult(list(self.rows))


class _FakeResult:
    def __init__(self, data):
        self.data = data


def _logger(rows=None, fail_log_v2_update=False):
    lg = TradeLogger.__new__(TradeLogger)
    lg.client = FakeClient(rows=rows, fail_log_v2_update=fail_log_v2_update)
    return lg


def _composite():
    return {
        "total": 7, "tier": "STRONG",
        "indicators": [
            {"key": "rsi_intraday", "label": "Intraday RSI", "value": "42", "score": 1},
            {"key": "rsi_daily", "label": "Daily RSI", "value": "55", "score": 1},
            {"key": "macd", "label": "MACD", "value": "Bullish", "score": 2},
            {"key": "trend_intraday", "label": "Intraday trend", "value": "Bearish", "score": -2},
            {"key": "trend_daily", "label": "Daily trend", "value": "Chop", "score": 0},
            {"key": "vwap", "label": "VWAP", "value": "Below", "score": 1},
            {"key": "orb", "label": "ORB", "value": "Below low", "score": 2},
        ],
    }


# ── Builders ─────────────────────────────────────────────────────────────────

def test_composite_rows_in_frontend_order():
    rows = composite_rows(_composite())
    assert [r["factor"] for r in rows] == [
        "Intraday RSI (5m)", "Daily RSI", "MACD (5m)", "Intraday trend (5m EMA)",
        "Daily trend", "VWAP", "ORB",
    ]
    assert rows[0] == {"factor": "Intraday RSI (5m)", "value": "42", "score": 1}
    assert rows[3]["score"] == -2
    # Unavailable indicator keeps a null score (renders '—', never guessed).
    comp = _composite()
    comp["indicators"][0]["score"] = None
    assert composite_rows(comp)[0]["score"] is None
    assert composite_rows(None) is None
    assert composite_rows({}) is None


def test_config_hash_stable_and_short():
    prof = {"qty_contracts": 4, "runner_mode": "be_hold"}
    assert config_hash(prof) == config_hash(dict(reversed(list(prof.items()))))
    assert len(config_hash(prof)) == 12
    assert config_hash(None) is None


def test_build_entry_snapshot_shape():
    v2 = build_log_v2_entry(
        strategy_name="SPY RIDER", profile_key="TREND_RIDER",
        effective_profile={"tp1_close_pct": 0.5, "tp2_close_pct": 0.5,
                           "cascade_close_pct": 0.5, "cascade_retrace_pct": 0.5,
                           "runner_mode": "be_hold"},
        direction="PUT", trigger_price=760.0, breakout_level=762.0, vwap=759.5,
        gate={"mode": "composite", "summary": "composite +7/14 STRONG", "composite": _composite()},
        contract={"symbol": "SPY261102C00762000", "bid": 1.02, "ask": 1.06,
                  "spread_pct": 0.038, "delta": 0.42, "oi": None},
        buying_power=5000.0, hard_stop=0.742, tp1=1.378, tp2=1.96,
        entry_premium=1.06, qty=4, entry_time_iso="2026-11-02T14:50:01+00:00")
    assert v2["schema"] == "trade-log-v2/1"
    assert v2["strategy_name"] == "SPY RIDER" and v2["config_hash"]
    assert v2["composite"]["total"] == 7 and v2["composite"]["tier"] == "STRONG"
    assert len(v2["composite"]["rows"]) == 7
    assert v2["entry"]["gate"]["v"] == "composite +7/14 STRONG"
    assert v2["entry"]["gate"]["p"] == "ENGINE"
    assert "1.02" in v2["contract"]["quote"]["v"] and "1.06" in v2["contract"]["quote"]["v"]
    assert v2["contract"]["quote"]["p"] == "VERIFIED"
    assert "0.42" in v2["contract"]["greeks"]["v"]
    # IV is not on the chain snapshot and OI is None by design — both omit,
    # so the frontend renders them MISSING rather than a fabricated value.
    assert "vol_oi" not in v2["contract"]
    assert "IV" not in v2["contract"]["greeks"]["v"]
    assert v2["contract"]["buying_power"]["v"] == "$5,000"
    assert v2["frozen_config"]["hard_stop"]["v"] == 0.742
    assert v2["frozen_config"]["tp1"]["v"] == 1.378
    assert v2["frozen_config"]["cascade"]["v"].startswith("trim 50%")
    assert v2["events"][0]["code"] == "ENTRY" and v2["events"][0]["qty_after"] == 4
    # Flow and market are not computed at entry — omitted, not invented.
    assert "flow" not in v2["entry"] and "market" not in v2["entry"]


def test_build_entry_without_gate_is_missing_not_guessed():
    v2 = build_log_v2_entry(
        strategy_name="MANUAL", profile_key="THUNDER_CAT", effective_profile={},
        direction="CALL", trigger_price=None, breakout_level=None, vwap=None,
        gate=None, contract=None, buying_power=None,
        hard_stop=None, tp1=None, tp2=None,
        entry_premium=1.25, qty=2, entry_time_iso="2026-11-02T14:50:01+00:00")
    assert "composite" not in v2 and "entry" not in v2 and "contract" not in v2
    assert v2["events"][0]["premium"] == 1.25


def test_build_exit_event_quantities_and_technicals():
    ev = build_log_v2_exit_event(
        code="TP1", qty_before=4, qty_closed=1, qty_after=3, premium=1.37,
        underlying=758.5, leg_pnl=31.0, cum_pnl=31.0,
        armed={"hard_stop": 1.06, "tp1": 1.378, "tp2": 1.96},
        vwap_txt="Below VWAP $759.50", orb_txt="Below low $762.00",
        time_iso="2026-11-02T15:14:25+00:00")
    assert ev["code"] == "TP1" and ev["p"] == "VERIFIED"
    assert (ev["qty_before"], ev["qty_closed"], ev["qty_after"]) == (4, 1, 3)
    assert ev["leg_pnl"] == 31.0 and ev["cum_pnl"] == 31.0
    assert ev["technicals"]["vwap"] == "Below VWAP $759.50"
    # No composite on exit legs (not computed in the exit path).
    assert "composite_total" not in ev["technicals"]


def test_build_cascade_event_carries_evidence():
    ev = build_log_v2_cascade_event(
        code="CASCADE_BLOCKED", qty_before=2, qty_closed=0, qty_after=2,
        price=1.82, underlying=758.0, peak=2.68, trigger=1.87,
        deadline_iso="2026-11-02T15:30:00-05:00",
        bars=[{"t": "2026-11-02T15:24:00-05:00", "o": 1.9, "c": 1.85,
               "against": True, "recovering": False}],
        blocked_reason="2x1m did not confirm by the next 5m close",
        time_iso="2026-11-02T15:30:00+00:00")
    assert ev["code"] == "CASCADE_BLOCKED" and ev["p"] == "ENGINE"
    assert ev["evidence"]["peak"] == 2.68 and ev["evidence"]["trigger"] == 1.87
    assert ev["evidence"]["bars"][0]["against"] is True
    assert ev["blocked_reason"].startswith("2x1m")


# ── Writer behaviour ─────────────────────────────────────────────────────────

def test_log_entry_carries_log_v2_and_drops_it_when_column_missing():
    lg = _logger()
    trade_id = lg.log_entry(
        ticker="SPY", direction="PUT",
        contract={"symbol": "SPY261102C00762000", "strike": 762, "expiry": "2026-11-02"},
        entry_premium=1.06, orh=765.0, orl=762.0, fib_levels={},
        session_date="2026-11-02", profile="TREND_RIDER", qty=4,
        log_v2={"schema": "trade-log-v2/1", "events": []})
    assert trade_id == "trade-1"
    kind, row = lg.client.writes[0]
    assert kind == "insert" and row["log_v2"]["schema"] == "trade-log-v2/1"
    # Offset-aware entry time (the timezone fix).
    assert row["entry_time"].endswith("+00:00")
    assert datetime.fromisoformat(row["entry_time"]).tzinfo is not None

    lg2 = _logger(fail_log_v2_update=True)
    # A missing log_v2 column must not lose the trade: the insert retries
    # without log_v2 (progressive-drop) and still returns the trade id.
    trade_id2 = lg2.log_entry(
        ticker="SPY", direction="PUT",
        contract={"symbol": "SPY261102C00762000", "strike": 762, "expiry": "2026-11-02"},
        entry_premium=1.06, orh=765.0, orl=762.0, fib_levels={},
        session_date="2026-11-02", profile="TREND_RIDER", qty=4,
        log_v2={"schema": "trade-log-v2/1", "events": []})
    assert trade_id2 == "trade-1"
    assert "log_v2" not in lg2.client.writes[-1][1]


def test_log_v2_event_appends_and_missing_column_is_nonfatal():
    existing = {"schema": "trade-log-v2/1", "events": [{"code": "ENTRY"}]}
    lg = _logger(rows=[{"log_v2": existing}])
    assert lg.log_v2_event("trade-1", {"code": "TP1", "qty_closed": 1}) is True
    kind, patch = lg.client.writes[0]
    assert kind == "update" and [e["code"] for e in patch["log_v2"]["events"]] == ["ENTRY", "TP1"]

    lg2 = _logger(rows=[{"log_v2": existing}], fail_log_v2_update=True)
    assert lg2.log_v2_event("trade-1", {"code": "TP1"}) is False
    assert lg2.log_v2_override("trade-1", {"field": "tp1", "old": 1.0, "new": 2.0}) is False
    assert lg2.log_v2_event(None, {"code": "TP1"}) is False
    assert lg2.log_v2_event("trade-1", {}) is False


def test_utcnow_iso_is_offset_aware():
    iso = utcnow_iso()
    assert iso.endswith("+00:00")
    assert datetime.fromisoformat(iso).tzinfo is not None


def test_log_exit_stage_time_is_offset_aware():
    """log_exit writes stage times with an explicit +00:00 offset, so the
    JSONB blob no longer stores a naive UTC string the frontend could
    misread as phone-local time."""
    lg = _logger(rows=[{
        "id": "trade-1", "entry_premium": 1.06, "qty_entered": 4, "qty_exited": 0,
        "pnl": 0, "exit_stages": [], "account_balance_before": None,
    }])
    assert lg.log_exit(
        contract_symbol="SPY261102C00762000", exit_reason="TP1", exit_premium=1.37,
        qty_closed=1, profile="TREND_RIDER", trade_id="trade-1") is True
    kind, patch = lg.client.writes[0]
    assert kind == "update"
    stage = patch["exit_stages"][0]
    assert stage["time"].endswith("+00:00")
    assert datetime.fromisoformat(stage["time"]).tzinfo is not None


# ── Frontend naive-as-UTC rule (node check of the exact JS rule) ─────────────
# The TS file itself cannot run under pytest, so this test evaluates the
# identical parse rule (naive → append 'Z'; offset-aware → unchanged) in
# node and asserts the Boston (America/New_York) rendering of the
# 2026-11-02 legs: 15:14:25 naive UTC must read 10:14:25 AM ET, not 3:14 PM.

NODE_RULE = """
const parseTime = (iso) => {
  const s = iso.trim();
  const hasOffset = /([+-]\\d{2}:?\\d{2}|[Zz])$/.test(s);
  return new Date(hasOffset ? s : `${s}Z`);
};
const fmt = (iso) => parseTime(iso).toLocaleTimeString('en-US', {
  timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true,
});
console.log(JSON.stringify([
  fmt('2026-11-02T15:14:25.829710'),   // old naive TP1 stage
  fmt('2026-11-02T16:10:09.638529'),   // old naive breakeven stage
  fmt('2026-11-02T14:50:01.015845+00:00'),  // offset-aware entry time
  fmt('2026-11-02T15:14:25+00:00'),    // new offset-aware stage time
]));
"""


def test_frontend_naive_utc_rule_via_node():
    try:
        out = subprocess.run([sys.executable, "-c", "import sys; sys.exit(0)"],
                             capture_output=True, timeout=10)
    except Exception:
        pytest.skip("subprocess unavailable")
    res = subprocess.run(["node", "-e", NODE_RULE], capture_output=True, text=True, timeout=30)
    assert res.returncode == 0, res.stderr
    times = json.loads(res.stdout.strip())
    assert times[0] == "10:14:25 AM", times  # was 3:14:25 PM before the fix
    assert times[1] == "11:10:09 AM", times  # was 4:10:09 PM before the fix
    assert times[2] == "9:50:01 AM", times   # entry clock behaviour unchanged
    assert times[3] == "10:14:25 AM", times  # new writes render identically
