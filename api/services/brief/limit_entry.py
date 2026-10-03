"""
Limit-buy order management for morning-brief entries (spec §3).

  WORKING → FILLED
          → CANCELLED_TIMEOUT   not filled within TIMEOUT_SECONDS (75 s)
          → CANCELLED_STALE     underlying drifted > 0.3% from the trigger
          → SCRATCH             partially filled when cancelled: the partial
                                is flattened (sold) and logged as a scratch —
                                never run a degraded version of the split
          → ERROR               broker rejected / unexpected failure

Paper vs live: the order goes to the engine's Alpaca TradingClient (paper or
live account). Alpaca's paper broker only fills a limit when the market
reaches it, so paper fills follow the same rule as live — no simulated
instant fills.

The broker client, clock, sleep and underlying-price feed are injected so the
state machine can be tested without Alpaca.
"""

import logging
import time as _time

from services.brief.entry_rules import drifted

logger = logging.getLogger(__name__)

TIMEOUT_SECONDS = 75
POLL_SECONDS = 1.0

FILLED, TIMEOUT, STALE, SCRATCH, ERROR = (
    "FILLED", "CANCELLED_TIMEOUT", "CANCELLED_STALE", "SCRATCH", "ERROR")


def _status(order) -> str:
    st = getattr(order, "status", "")
    return str(getattr(st, "value", st)).lower()


def _filled_qty(order) -> int:
    try:
        return int(float(getattr(order, "filled_qty", 0) or 0))
    except (TypeError, ValueError):
        return 0


def run_limit_entry(client, symbol: str, qty: int, limit_price: float, trigger: float,
                    underlying_price, on_update=None, clock=_time.time, sleep=_time.sleep,
                    timeout: float = TIMEOUT_SECONDS, poll: float = POLL_SECONDS) -> dict:
    """
    Submit a DAY limit buy and manage it to a terminal state. Returns
    {state, filled_qty, avg_price, order, reason}. `underlying_price()` →
    latest underlying price (or None). `on_update(state, info)` is called on
    each transition for push / persistence.
    """
    from alpaca.trading.enums import OrderSide, TimeInForce
    from alpaca.trading.requests import LimitOrderRequest, MarketOrderRequest

    def _emit(state, **info):
        if on_update:
            try:
                on_update(state, info)
            except Exception as e:
                logger.warning("[brief] limit update callback failed: %s", e)

    try:
        order = client.submit_order(LimitOrderRequest(
            symbol=symbol, qty=qty, side=OrderSide.BUY,
            time_in_force=TimeInForce.DAY, limit_price=round(limit_price, 2)))
    except Exception as e:
        logger.error("[brief] limit order rejected for %s: %s", symbol, e)
        _emit(ERROR, reason=str(e))
        return {"state": ERROR, "filled_qty": 0, "avg_price": None, "order": None, "reason": str(e)}

    started = clock()
    _emit("WORKING", order_id=str(getattr(order, "id", "")), limit=round(limit_price, 2),
          started_at=started, timeout=timeout)

    reason = None
    while True:
        try:
            order = client.get_order_by_id(str(order.id))
        except Exception as e:
            logger.warning("[brief] order poll failed for %s: %s", symbol, e)
        status = _status(order)
        if status == "filled":
            avg = float(getattr(order, "filled_avg_price", 0) or limit_price)
            _emit(FILLED, filled_qty=qty, avg_price=avg)
            return {"state": FILLED, "filled_qty": qty, "avg_price": avg, "order": order, "reason": None}
        if status in ("canceled", "cancelled", "expired", "rejected"):
            reason = f"order {status} by broker"
            break
        if clock() - started >= timeout:
            reason = f"not filled within {int(timeout)}s"
            break
        px = underlying_price()
        if px is not None and drifted(trigger, px):
            reason = f"underlying moved to {px:.2f}, > 0.3% from the {trigger:.2f} trigger"
            break
        sleep(poll)

    # Cancel whatever is still working, then look at what actually filled.
    try:
        client.cancel_order_by_id(str(order.id))
    except Exception as e:
        logger.info("[brief] cancel for %s returned: %s", symbol, e)
    try:
        order = client.get_order_by_id(str(order.id))
    except Exception:
        pass
    filled = _filled_qty(order)
    if filled >= qty:   # filled in the race with the cancel
        avg = float(getattr(order, "filled_avg_price", 0) or limit_price)
        _emit(FILLED, filled_qty=qty, avg_price=avg)
        return {"state": FILLED, "filled_qty": qty, "avg_price": avg, "order": order, "reason": None}
    if filled > 0:
        # Partial: flatten it — never run a degraded split.
        try:
            client.submit_order(MarketOrderRequest(symbol=symbol, qty=filled, side=OrderSide.SELL,
                                                   time_in_force=TimeInForce.DAY))
        except Exception as e:
            logger.error("[brief] FAILED to flatten partial %s x%d: %s", symbol, filled, e)
            _emit(ERROR, reason=f"partial fill of {filled} could not be flattened: {e}", filled_qty=filled)
            return {"state": ERROR, "filled_qty": filled, "avg_price": None, "order": order,
                    "reason": f"partial fill of {filled} could not be flattened: {e}"}
        _emit(SCRATCH, filled_qty=filled, reason=reason)
        return {"state": SCRATCH, "filled_qty": filled, "avg_price": None, "order": order, "reason": reason}
    state = STALE if reason and "moved" in reason else TIMEOUT
    _emit(state, reason=reason)
    return {"state": state, "filled_qty": 0, "avg_price": None, "order": order, "reason": reason}
