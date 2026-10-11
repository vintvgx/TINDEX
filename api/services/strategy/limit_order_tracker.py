"""
Limit sell ladder — resting DAY limit SELL orders for one engine's position
(spec: limit-sell-ladder-spec.pdf, 2026-10-11).

A third, passive exit mode next to the 10s priced exit and Force Close:
each rung is a plain Alpaca DAY limit order that rests until it fills, is
cancelled, or expires at the close. No price-seeking, no market fallback.

Ownership split:
  - LimitOrderTracker (this file) owns the order records: placement
    bookkeeping, broker refresh, fill-delta accounting, persistence to
    `working_limit_orders`, restart recovery, and cancels.
  - ORBEngine owns position state. Every fill delta is handed to
    ORBEngine._apply_ladder_fill_locked (under _tick_lock), which runs the
    same _reserve_exit_qty + _finalize_exit path as every other exit
    (LIMIT_SELL reason, armed-levels snapshot, notification).

Contract accounting: ExitManager.qty_remaining keeps counting every
contract still held, including laddered ones; "reserved" = the unfilled
remainder of working orders, and available = qty_remaining - reserved.
Manual sells and TP exits only use available contracts; a protective exit
(hard stop, trail stop, EOD, Force Close) cancels the ladder first and then
sells everything — the stop always protects the whole position (decided
2026-10-12).

Lock order: engine._tick_lock → tracker._lock, never the reverse. Fill
deltas are CLAIMED under the tracker lock (so an Alpaca trade event and the
poll can't both count the same fill) and APPLIED afterwards under the
engine lock.
"""
import logging
import threading
import time
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

WORKING = ("working", "partially_filled")
POLL_INTERVAL_S = 5.0
CANCEL_CONFIRM_S = 2.0
MAX_RUNGS = 10


def normalize_status(raw) -> str:
    """Alpaca order status → working | partially_filled | filled | canceled |
    expired | rejected."""
    s = str(getattr(raw, "value", raw) or "").rsplit(".", 1)[-1].lower()
    if s == "filled":
        return "filled"
    if s == "partially_filled":
        return "partially_filled"
    if s in ("canceled", "cancelled"):
        return "canceled"
    if s in ("expired", "done_for_day"):
        return "expired"
    if s in ("rejected", "suspended"):
        return "rejected"
    return "working"   # new, accepted, pending_new, pending_cancel, held, …


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class LimitOrderTracker:
    def __init__(self, engine):
        self.engine = engine
        self._lock = threading.Lock()
        self._orders: dict = {}        # order_id -> record dict
        self._pending = 0              # contracts reserved for submissions in flight
        self._poll_thread = None

    # ── State ──────────────────────────────────────────────────────────────

    def reserved_qty(self) -> int:
        with self._lock:
            return self._pending + sum(
                r["qty"] - r["filled_qty"] for r in self._orders.values() if r["status"] in WORKING)

    def has_working(self) -> bool:
        with self._lock:
            return self._pending > 0 or any(r["status"] in WORKING for r in self._orders.values())

    def working_ids(self) -> list:
        with self._lock:
            return [oid for oid, r in self._orders.items() if r["status"] in WORKING]

    def snapshot(self) -> list:
        """Every order for the current position (working first), newest last."""
        with self._lock:
            rows = [dict(r) for r in self._orders.values()]
        rows.sort(key=lambda r: (r["status"] not in WORKING, r["placed_at"]))
        return rows

    def reset(self) -> None:
        """Forget records (session reset / new day). DAY orders are dead by then."""
        with self._lock:
            self._orders.clear()
            self._pending = 0

    # ── Placement bookkeeping (engine validates under _tick_lock) ──────────

    def reserve_pending(self, qty: int) -> None:
        with self._lock:
            self._pending += qty

    def release_pending(self, qty: int) -> None:
        with self._lock:
            self._pending = max(0, self._pending - qty)

    def add_submitted(self, order_id: str, qty: int, limit_price: float, contract: str,
                      trade_id, paper: bool) -> dict:
        rec = {
            "order_id": order_id, "qty": int(qty), "limit_price": round(float(limit_price), 2),
            "filled_qty": 0, "filled_avg_price": None, "status": "working",
            "placed_at": _now_iso(), "contract_symbol": contract,
        }
        with self._lock:
            self._pending = max(0, self._pending - qty)
            self._orders[order_id] = rec
        self.engine.logger.insert_limit_order({
            **{k: rec[k] for k in ("order_id", "qty", "limit_price", "filled_qty", "status",
                                    "placed_at", "contract_symbol")},
            "strategy_id": self.engine.strategy_id, "trade_id": trade_id, "paper": bool(paper),
        })
        self._ensure_polling()
        return dict(rec)

    # ── Fill accounting ────────────────────────────────────────────────────

    def claim(self, order_id: str, status, filled_qty, filled_avg_price):
        """Record the broker's state for one order. Returns (delta_qty,
        delta_price, record) — delta_qty > 0 only for contracts not counted
        before, so concurrent callers can never double-count a fill."""
        new_status = normalize_status(status)
        with self._lock:
            rec = self._orders.get(order_id)
            if rec is None:
                return 0, None, None
            prev_q, prev_avg = rec["filled_qty"], rec["filled_avg_price"] or 0.0
            new_q = max(prev_q, min(int(float(filled_qty or 0)), rec["qty"]))
            delta = new_q - prev_q
            delta_price = None
            if delta > 0:
                new_avg = float(filled_avg_price or rec["limit_price"])
                notional = new_avg * new_q - prev_avg * prev_q
                delta_price = notional / delta if notional > 0 else new_avg
                rec["filled_qty"], rec["filled_avg_price"] = new_q, new_avg
            if new_status == "working" and rec["filled_qty"] > 0:
                new_status = "partially_filled"
            if rec["filled_qty"] >= rec["qty"]:
                new_status = "filled"
            changed = delta > 0 or new_status != rec["status"]
            rec["status"] = new_status
            out = dict(rec)
        if changed:
            self.engine.logger.update_limit_order(order_id, {
                "filled_qty": out["filled_qty"], "filled_avg_price": out["filled_avg_price"],
                "status": out["status"],
            })
        return delta, delta_price, out

    def _fetch_and_claim(self, order_id: str):
        o = self.engine.trading_client.get_order_by_id(order_id)
        return self.claim(order_id, getattr(o, "status", None),
                          getattr(o, "filled_qty", None), getattr(o, "filled_avg_price", None))

    def refresh(self) -> int:
        """Poll Alpaca for every working order and apply new fills (takes the
        engine lock per fill). Returns contracts newly filled."""
        total = 0
        for oid in self.working_ids():
            try:
                delta, price, rec = self._fetch_and_claim(oid)
            except Exception as e:
                logger.debug("[LimitOrders] refresh %s failed: %s", oid, e)
                continue
            if delta > 0:
                self.engine._on_ladder_fill(delta, price, rec)
                total += delta
        return total

    def on_trade_event(self, event: dict) -> None:
        """Alpaca trade_updates (C1 hub). Runs on the stream thread — hand off."""
        oid = event.get("order_id")
        with self._lock:
            known = oid in self._orders
        if not known:
            return
        threading.Thread(target=self._apply_event, args=(event,), daemon=True,
                         name="LimitOrderEvent").start()

    def _apply_event(self, event: dict) -> None:
        status = event.get("status") or event.get("event")
        delta, price, rec = self.claim(event["order_id"], status,
                                       event.get("filled_qty"), event.get("filled_avg_price"))
        if delta > 0:
            self.engine._on_ladder_fill(delta, price, rec)

    def _ensure_polling(self) -> None:
        with self._lock:
            if self._poll_thread and self._poll_thread.is_alive():
                return
            t = threading.Thread(target=self._poll_loop, daemon=True,
                                 name=f"LimitOrders-{getattr(self.engine, 'ticker', '')}")
            self._poll_thread = t
        t.start()

    def _poll_loop(self) -> None:
        """Fallback to the trade_updates stream: poll while orders work."""
        while self.has_working():
            time.sleep(POLL_INTERVAL_S)
            try:
                self.refresh()
            except Exception as e:
                logger.debug("[LimitOrders] poll failed: %s", e)

    # ── Cancels ────────────────────────────────────────────────────────────

    def _cancel_and_confirm(self, order_ids: list, apply_fill) -> list:
        """Cancel at the broker, wait up to CANCEL_CONFIRM_S for each to reach a
        terminal state, and hand any final fills to `apply_fill(delta, price,
        rec)`. Returns the ids still not terminal (cancel unconfirmed)."""
        client = self.engine.trading_client
        for oid in order_ids:
            try:
                client.cancel_order_by_id(oid)
            except Exception as e:
                # Already filled/cancelled at the broker — the refresh below
                # records whatever it actually is.
                logger.debug("[LimitOrders] cancel %s: %s", oid, e)
        pending = list(order_ids)
        deadline = time.monotonic() + CANCEL_CONFIRM_S
        while pending:
            still = []
            for oid in pending:
                try:
                    delta, price, rec = self._fetch_and_claim(oid)
                except Exception:
                    still.append(oid)
                    continue
                if delta > 0:
                    apply_fill(delta, price, rec)
                if rec is not None and rec["status"] in WORKING:
                    still.append(oid)
            pending = still
            if not pending or time.monotonic() >= deadline:
                break
            time.sleep(0.2)
        return pending

    def cancel(self, order_id: str, apply_fill) -> dict | None:
        with self._lock:
            rec = self._orders.get(order_id)
            if rec is None:
                return None
            if rec["status"] not in WORKING:
                return dict(rec)
        self._cancel_and_confirm([order_id], apply_fill)
        with self._lock:
            return dict(self._orders[order_id])

    def cancel_all(self, apply_fill) -> list:
        """Cancel every working order. Returns ids whose cancel isn't confirmed yet."""
        ids = self.working_ids()
        if not ids:
            return []
        return self._cancel_and_confirm(ids, apply_fill)

    # ── Restart recovery ───────────────────────────────────────────────────

    def recover_begin(self, row: dict) -> int:
        """Boot, BEFORE broker reconciliation: reload this trade's working
        orders, book any fills that happened while the server was down (as
        LIMIT_SELL exits on the trade row — the engine isn't armed yet, so this
        is bookkeeping only), and keep the still-working ones as reserved.
        Returns contracts filled during the downtime."""
        trade_id = row.get("id")
        if not trade_id:
            return 0
        rows = self.engine.logger.list_open_limit_orders(trade_id)
        if not rows:
            return 0
        with self._lock:
            for r in rows:
                self._orders[r["order_id"]] = {
                    "order_id": r["order_id"], "qty": int(r["qty"]),
                    "limit_price": float(r["limit_price"]), "filled_qty": int(r.get("filled_qty") or 0),
                    "filled_avg_price": float(r["filled_avg_price"]) if r.get("filled_avg_price") else None,
                    "status": r.get("status") or "working", "placed_at": r.get("placed_at") or _now_iso(),
                    "contract_symbol": r["contract_symbol"],
                }
        total = 0
        for r in rows:
            try:
                delta, price, rec = self._fetch_and_claim(r["order_id"])
            except Exception as e:
                logger.warning("[LimitOrders] recovery fetch %s failed: %s — keeping as working",
                               r["order_id"], e)
                continue
            if delta > 0:
                total += delta
                self._book_offline_fill(row, delta, price)
        if self.has_working():
            self._ensure_polling()
        logger.info("[LimitOrders] recovered %d order(s) for trade %s, %d contract(s) filled while down",
                    len(rows), trade_id, total)
        return total

    def _book_offline_fill(self, row: dict, qty: int, price: float) -> None:
        eng = self.engine
        try:
            eng.logger.log_exit(
                contract_symbol=row["contract_symbol"], exit_reason="LIMIT_SELL",
                exit_premium=price, qty_closed=qty, profile=row.get("profile") or eng.profile_key,
                strategy_id=eng.strategy_id, trading_client=eng.trading_client, trade_id=row["id"],
            )
            entry = float(row.get("entry_premium") or 0)
            eng.notifier.notify_exit(
                ticker=row.get("ticker") or eng.ticker, contract_symbol=row["contract_symbol"],
                exit_reason="LIMIT_SELL", pnl=(price - entry) * qty * 100, qty=qty,
                profile_key=row.get("profile") or eng.profile_key, exit_premium=price,
                paper_mode=bool(row.get("paper_mode", eng.paper)), strategy_id=eng.strategy_id,
            )
        except Exception as e:
            logger.error("[LimitOrders] booking offline fill failed: %s", e, exc_info=True)
