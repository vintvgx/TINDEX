"""Limit sell ladder (limit-sell-ladder-spec.pdf): resting DAY limit sells,
fill accounting, and how they interact with stops, TPs and manual sells.

Run from api/:  python -m pytest tests/test_limit_sell_ladder.py
"""
import sys
import threading
import time
import types

import pytest

try:
    import supabase  # noqa: F401
except ModuleNotFoundError:
    stub = types.ModuleType("supabase")
    stub.create_client = lambda *a, **k: None
    stub.Client = object
    sys.modules["supabase"] = stub

import services.strategy.orb_engine as oe  # noqa: E402
import services.strategy.limit_order_tracker as lot  # noqa: E402

CONTRACT = "SPY261012C00580000"


class FakeAlpaca:
    """Just enough of TradingClient: orders with status / partial fills."""

    def __init__(self):
        self.orders = {}
        self.market_sells = []
        self.n = 0
        self.confirm_cancels = True

    def submit_order(self, req):
        self.n += 1
        oid = f"o{self.n}"
        if getattr(req, "limit_price", None) is None:          # market order
            self.market_sells.append(int(req.qty))
            return types.SimpleNamespace(id=oid, status="filled", filled_qty=req.qty, filled_avg_price=0.80)
        self.orders[oid] = {"status": "new", "filled_qty": 0, "filled_avg_price": None,
                            "qty": int(req.qty), "limit": float(req.limit_price)}
        return types.SimpleNamespace(id=oid)

    def fill(self, oid, qty, price):
        o = self.orders[oid]
        o["filled_qty"] = qty
        o["filled_avg_price"] = price
        o["status"] = "filled" if qty >= o["qty"] else "partially_filled"

    def get_order_by_id(self, oid):
        o = self.orders[oid]
        return types.SimpleNamespace(id=oid, status=o["status"], filled_qty=o["filled_qty"],
                                     filled_avg_price=o["filled_avg_price"])

    def cancel_order_by_id(self, oid):
        o = self.orders[oid]
        if o["status"] in ("filled", "canceled"):
            raise Exception("order not cancelable")
        o["status"] = "canceled" if self.confirm_cancels else "pending_cancel"


class FakeEM:
    def __init__(self, qty):
        self.qty = qty
        self.qty_remaining = qty
        self.entry_premium = 1.00
        self.hard_stop, self.tp1, self.tp2 = 0.70, 1.30, 1.60
        self.be_stop_active = False

    def update_qty(self, n):
        self.qty_remaining -= n


class FakeLogger:
    def __init__(self):
        self.rows = {}
        self.exits = []

    def insert_limit_order(self, row):
        self.rows[row["order_id"]] = dict(row)
        return True

    def update_limit_order(self, oid, patch):
        self.rows.setdefault(oid, {}).update(patch)
        return True

    def list_open_limit_orders(self, trade_id):
        return [r for r in self.rows.values()
                if r.get("trade_id") == trade_id and r["status"] in ("working", "partially_filled")]

    def log_exit(self, **kw):
        self.exits.append(kw)
        return True


def make_engine(qty=3):
    eng = oe.ORBEngine.__new__(oe.ORBEngine)
    eng._tick_lock = threading.Lock()
    eng._live_clients, eng._live_clients_lock = [], threading.Lock()
    eng.trade_taken, eng.contract_symbol, eng.position = True, CONTRACT, "CALL"
    eng.strategy_id, eng.strategy_name, eng.profile_key, eng.ticker = "s1", "Test", "BULL_DOG", "SPY"
    eng.active_trade_id, eng.paper = "t1", True
    eng.stream_manager = None
    eng._last_underlying_price, eng._current_option_price = 580.0, 0.80
    eng.exit_manager = FakeEM(qty)
    eng.trading_client = FakeAlpaca()
    eng.logger = FakeLogger()
    eng.notifier = types.SimpleNamespace(notify_exit=lambda **k: None)
    eng.debug = types.SimpleNamespace(emit=lambda *a, **k: None)
    eng.finalized = []
    eng._finalize_exit = lambda action, c, d, q, closing_all, up, price, entry: eng.finalized.append(
        (action["reason"], q, round(price, 2), closing_all))
    eng._resolve_exit_premium = lambda order, mid: 0.80
    eng.limit_orders = lot.LimitOrderTracker(eng)
    eng.limit_orders._ensure_polling = lambda: None      # tests drive refresh() directly
    return eng


@pytest.fixture(autouse=True)
def fast_cancel(monkeypatch):
    monkeypatch.setattr(lot, "CANCEL_CONFIRM_S", 0.3)


def test_place_reserves_and_rejects_overcommit():
    eng = make_engine(3)
    r = eng.place_limit_orders([{"qty": 1, "limit_price": 0.99}, {"qty": 1, "limit_price": 1.5}])
    assert r["status"] == "accepted" and len(r["orders"]) == 2
    assert eng.qty_available() == 1 and eng.exit_manager.qty_remaining == 3   # still held
    over = eng.place_limit_orders([{"qty": 2, "limit_price": 2.0}])
    assert over["status"] == "error" and "Only 1" in over["message"]
    bad = eng.place_limit_orders([{"qty": 0, "limit_price": 1}])
    assert bad["status"] == "error"


def test_fill_books_limit_sell_and_releases_reservation():
    eng = make_engine(3)
    r = eng.place_limit_orders([{"qty": 2, "limit_price": 1.50}])
    oid = r["orders"][0]["order_id"]
    eng.trading_client.fill(oid, 2, 1.52)
    assert eng.refresh_limit_orders() == 2
    assert eng.finalized == [("LIMIT_SELL", 2, 1.52, False)]
    assert eng.exit_manager.qty_remaining == 1 and eng.qty_available() == 1
    assert eng.logger.rows[oid]["status"] == "filled"


def test_partial_fill_then_cancel_releases_rest():
    eng = make_engine(3)
    oid = eng.place_limit_orders([{"qty": 2, "limit_price": 1.50}])["orders"][0]["order_id"]
    eng.trading_client.fill(oid, 1, 1.50)
    eng.refresh_limit_orders()
    res = eng.cancel_limit_order(oid)
    assert res["status"] == "ok" and res["order"]["filled_qty"] == 1
    assert eng.finalized == [("LIMIT_SELL", 1, 1.5, False)]
    assert eng.exit_manager.qty_remaining == 2 and eng.qty_available() == 2


def test_event_and_poll_never_double_count():
    eng = make_engine(3)
    oid = eng.place_limit_orders([{"qty": 2, "limit_price": 1.50}])["orders"][0]["order_id"]
    eng.trading_client.fill(oid, 2, 1.50)
    eng.limit_orders._apply_event({"order_id": oid, "status": "filled", "filled_qty": 2, "filled_avg_price": 1.50})
    eng.refresh_limit_orders()
    assert eng.finalized == [("LIMIT_SELL", 2, 1.5, False)] and eng.exit_manager.qty_remaining == 1


def test_stop_cancels_ladder_and_sells_everything():
    eng = make_engine(3)
    eng.place_limit_orders([{"qty": 1, "limit_price": 0.99}, {"qty": 1, "limit_price": 1.50}])
    with eng._tick_lock:
        eng._handle_exit_action({"type": "CLOSE_ALL", "reason": "HARD_STOP", "qty": 3}, 580.0, 0.70)
    assert all(o["status"] == "canceled" for o in eng.trading_client.orders.values())
    assert eng.trading_client.market_sells == [3]                 # whole position, not just the free 1
    assert eng.finalized[-1][0] == "HARD_STOP" and eng.finalized[-1][3] is True


def test_stop_books_a_ladder_fill_that_beats_the_cancel():
    eng = make_engine(3)
    oid = eng.place_limit_orders([{"qty": 1, "limit_price": 0.99}])["orders"][0]["order_id"]
    eng.trading_client.fill(oid, 1, 0.99)                          # filled before the cancel lands
    with eng._tick_lock:
        eng._handle_exit_action({"type": "CLOSE_ALL", "reason": "HARD_STOP", "qty": 3}, 580.0, 0.70)
    assert ("LIMIT_SELL", 1, 0.99, False) in eng.finalized
    assert eng.trading_client.market_sells == [2]


def test_stop_follow_through_sells_after_slow_cancel():
    eng = make_engine(3)
    oid = eng.place_limit_orders([{"qty": 2, "limit_price": 1.50}])["orders"][0]["order_id"]
    eng.trading_client.confirm_cancels = False                     # Alpaca sits in pending_cancel
    with eng._tick_lock:
        eng._handle_exit_action({"type": "CLOSE_ALL", "reason": "HARD_STOP", "qty": 3}, 580.0, 0.70)
    assert eng.trading_client.market_sells == [1]                  # only the free contract now
    eng.trading_client.orders[oid]["status"] = "canceled"          # cancel finally confirms
    for _ in range(60):
        if len(eng.trading_client.market_sells) == 2:
            break
        time.sleep(0.1)
    assert eng.trading_client.market_sells == [1, 2]               # follow-through flattened it
    assert eng.exit_manager.qty_remaining == 0


def test_tp_only_uses_available_contracts():
    eng = make_engine(3)
    eng.place_limit_orders([{"qty": 3, "limit_price": 1.50}])
    eng._execute_priced_exit = lambda *a: pytest.fail("TP must not sell laddered contracts")
    with eng._tick_lock:
        eng._handle_exit_action({"type": "CLOSE_PARTIAL", "reason": "TP1", "qty": 1}, 580.0, 1.30)
    assert eng.finalized == []


def test_manual_sell_only_takes_available():
    eng = make_engine(3)
    eng.place_limit_orders([{"qty": 2, "limit_price": 1.50}])
    r = eng._reserve_manual_exit(None, None)
    assert r["ctx"]["want"] == 1 and r["ctx"]["closing_all"] is False
    eng2 = make_engine(2)
    eng2.place_limit_orders([{"qty": 2, "limit_price": 1.50}])
    assert "resting limit sells" in eng2._reserve_manual_exit(None, None)["error"]["message"]


def test_recovery_books_fills_that_happened_while_down():
    eng = make_engine(3)
    oid = eng.place_limit_orders([{"qty": 2, "limit_price": 1.50}])["orders"][0]["order_id"]
    # restart: fresh engine, same broker + DB
    eng2 = make_engine(3)
    eng2.trade_taken = False
    eng2.trading_client, eng2.logger = eng.trading_client, eng.logger
    eng.trading_client.fill(oid, 1, 1.55)
    filled = eng2.limit_orders.recover_begin({"id": "t1", "contract_symbol": CONTRACT, "entry_premium": 1.0,
                                               "profile": "BULL_DOG", "ticker": "SPY"})
    assert filled == 1
    assert eng.logger.exits[-1]["exit_reason"] == "LIMIT_SELL" and eng.logger.exits[-1]["qty_closed"] == 1
    assert eng2.limit_orders.reserved_qty() == 1                   # the unfilled rest still works
