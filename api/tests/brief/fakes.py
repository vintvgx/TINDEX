"""Fakes for the morning-brief tests: a BriefIO stand-in, bars, setups, a
broker, and a Supabase-shaped query stub. No network, no Alpaca."""
import copy
import sys
import types
from datetime import datetime

import pytz

from services.brief.config import DEFAULTS

ET = pytz.timezone("America/New_York")


def et(y, mo, d, h, mi, s=0):
    return ET.localize(datetime(y, mo, d, h, mi, s))


def zone(lo, hi, score, kind):
    return {"low": lo, "high": hi, "score": score, "type": kind}


def long_setup(price, trig, tgt, sup, trend="Bullish", rsi=60, sector="Technology", earnings=None):
    """A clean long: resistance trigger zone `trig` just above price, a
    target zone `tgt` beyond it, support `sup` below."""
    return {
        "price": price,
        "zones": [zone(*trig, 90, "resistance"), zone(*tgt, 80, "resistance"), zone(*sup, 70, "support")],
        "trend": trend, "rsi": rsi, "sector": sector, "gap_pct": 0.8,
        "pm_high": price + 0.2, "pm_low": price - 2,
        "prior_day": {"high": price + 0.5, "low": price - 5, "close": price - 0.2},
        "earnings_in_days": earnings,
    }


AMZN = dict(price=247.60, trig=(247.25, 247.75), tgt=(252.0, 253.0), sup=(244.5, 245.5))
META = dict(price=700.0, trig=(699.5, 701.0), tgt=(712.0, 715.0), sup=(690.0, 692.0))


class Bar:
    def __init__(self, ts, o, c, v):
        self.ts, self.open, self.close, self.volume = ts, o, c, v
        self.high, self.low = max(o, c), min(o, c)


class FakeIO:
    """In-memory BriefIO. Entry fills immediately unless `entry_result` is set."""

    def __init__(self, now):
        self.t = now
        self.db = {}
        self.pushes, self.entries = [], []
        self.subs = {}
        self.signals = {}
        self.losses = self.open = 0
        self.orb_open = set()
        self.gate = {}
        self.inputs = {}
        self.modes = {}
        self.cfg = dict(DEFAULTS)
        self.baseline = 82000.0
        self.entry_result = None

    def now(self): return self.t
    def config(self): return dict(self.cfg)
    def entry_modes(self): return dict(self.modes)
    def set_entry_mode(self, t, mode):
        if mode not in ("confirm", "auto"):
            raise ValueError("mode must be confirm or auto")
        self.modes[t.upper()] = mode
        return {"ticker": t.upper(), "mode": mode}
    def universe(self): return sorted(self.inputs)
    def gather_inputs(self, t): return self.inputs[t]
    def iex_open_baseline(self, t, d): return self.baseline
    def load_brief(self, d): return copy.deepcopy(self.db.get(d.isoformat()))
    def save_brief(self, b): self.db[b["brief_date"]] = copy.deepcopy(b)
    def push(self, title, body, data, level): self.pushes.append((level, title, body))
    def brief_losses_today(self, d): return self.losses
    def open_brief_trades(self, d): return self.open
    def orb_position_open(self, t): return t in self.orb_open
    def subscribe(self, t, cb): self.subs[t] = cb

    def gate_verdict(self, t, d):
        dec = self.gate.get(t, "ENTER")
        return {"decision": dec, "factors_agree": 4 if dec == "ENTER" else 2, "factors_total": 6}

    def log_signal(self, row):
        prev = self.signals.get(row["id"], {})
        self.signals[row["id"]] = {**prev, **{k: v for k, v in row.items() if v is not None}}

    def execute_entry(self, play, underlying_price, on_update, cfg=None):
        self.entries.append(play["ticker"])
        on_update("WORKING", {"limit": 0.52, "started_at": 0.0, "timeout": 75})
        return self.entry_result or {"state": "FILLED", "filled_qty": 3, "avg_price": 0.52,
                                     "trade_id": "tr-" + play["ticker"], "profile": "SCALP_30_100"}


class InlineThread:
    """threading.Thread stand-in that runs the target synchronously."""

    def __init__(self, target, args=(), daemon=None, name=None):
        self._t, self._a = target, args

    def start(self):
        self._t(*self._a)


def install_alpaca_stubs(monkeypatch):
    """Minimal alpaca.trading.{enums,requests} so limit_entry can build its
    order requests without the real SDK."""
    enums = types.ModuleType("alpaca.trading.enums")
    reqs = types.ModuleType("alpaca.trading.requests")
    enums.OrderSide = types.SimpleNamespace(BUY="buy", SELL="sell")
    enums.TimeInForce = types.SimpleNamespace(DAY="day")

    class _Req:
        def __init__(self, **kw):
            self.__dict__.update(kw)
            self.kind = type(self).__name__

    reqs.LimitOrderRequest = type("LimitOrderRequest", (_Req,), {})
    reqs.MarketOrderRequest = type("MarketOrderRequest", (_Req,), {})
    for name in ("alpaca", "alpaca.trading"):
        monkeypatch.setitem(sys.modules, name, sys.modules.get(name) or types.ModuleType(name))
    monkeypatch.setitem(sys.modules, "alpaca.trading.enums", enums)
    monkeypatch.setitem(sys.modules, "alpaca.trading.requests", reqs)


class FakeBroker:
    """Scripted order lifecycle. `script(t, cancelled)` → (status, filled_qty)."""

    def __init__(self, script, avg=0.52, reject=False, flatten_fails=False):
        self.script, self.avg = script, avg
        self.reject, self.flatten_fails = reject, flatten_fails
        self.t = 0.0
        self.cancelled = False
        self.orders = []

    def submit_order(self, req):
        if self.reject and req.kind == "LimitOrderRequest":
            raise RuntimeError("insufficient buying power")
        if self.flatten_fails and req.kind == "MarketOrderRequest":
            raise RuntimeError("market closed")
        self.orders.append(req)
        return types.SimpleNamespace(id="o1", status="new", filled_qty=0)

    def get_order_by_id(self, oid):
        status, filled = self.script(self.t, self.cancelled)
        return types.SimpleNamespace(id=oid, status=status, filled_qty=filled,
                                     filled_avg_price=self.avg if filled else None)

    def cancel_order_by_id(self, oid):
        self.cancelled = True


class FakeSB:
    """Supabase-client-shaped stub over {table: [rows]} — select/eq/gte/
    is_/limit/update/upsert, enough for signal_log."""

    def __init__(self, db):
        self.db = db

    def table(self, name):
        return _Query(self.db.setdefault(name, []))


class _Query:
    def __init__(self, rows):
        self.rows, self.filters, self.op, self.payload = rows, [], "select", None

    def select(self, *_): return self
    def limit(self, _): return self
    def eq(self, k, v): self.filters.append(lambda r: r.get(k) == v); return self
    def gte(self, k, v): self.filters.append(lambda r: str(r.get(k)) >= v); return self
    def is_(self, k, _): self.filters.append(lambda r: r.get(k) is None); return self
    def update(self, p): self.op, self.payload = "update", p; return self
    def upsert(self, p, on_conflict=None): self.op, self.payload = "upsert", p; return self

    def execute(self):
        match = [r for r in self.rows if all(f(r) for f in self.filters)]
        if self.op == "update":
            for r in match:
                r.update(self.payload)
            return types.SimpleNamespace(data=[])
        if self.op == "upsert":
            existing = next((r for r in self.rows if r["id"] == self.payload["id"]), None)
            if existing:
                existing.update(self.payload)
            else:
                self.rows.append(dict(self.payload))
            return types.SimpleNamespace(data=[])
        return types.SimpleNamespace(data=[dict(r) for r in match])
