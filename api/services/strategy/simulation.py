"""
ORB strategy simulation runner.

Synthetic session that fires real push notifications and fans out WebSocket
updates to connected /ws/strategy/<id>/live clients.
No Alpaca orders, no Supabase writes.

Scenarios
---------
"profit"   — IWM CALL: TP1 at tick 3, TP2 at tick 6, runner peaks +200% at
             tick 9, trailing stop fires at tick 10.  (~60 s)
"loss"     — IWM CALL: steady decline, hard stop triggers at tick 4 (-35%). (~24 s)
"reversal" — IWM CALL stops out at tick 4 (-$330), reversal detected, IWM PUT
             entered and runs the full profit sequence (+$810).  Net: +$480. (~90 s)

THUNDER_CAT profile parameters used:
  entry_premium  = $1.50
  qty            = 6 contracts
  hard_stop      = $0.975  (35% below entry)
  TP1            = $2.25   (50% gain  → close 3 of 6)
  TP2            = $3.00   (100% gain → close 1 of 3 remaining)
  runner_trail   = 20% below the high-water mark
"""

import json
import logging
import threading
import time

from services.strategy.exit_manager import ExitManager
from services.strategy.profiles import get_profile

logger = logging.getLogger(__name__)

# ── Synthetic trade constants ──────────────────────────────────────────────────

SIM_TICKER        = "IWM"
SIM_DIRECTION     = "CALL"
SIM_DIRECTION_PUT = "PUT"
SIM_ENTRY         = 1.50
SIM_QTY           = 6
SIM_STRIKE        = 221.00
SIM_CONTRACT      = "IWM240101C00221000 [SIM]"
SIM_CONTRACT_PUT  = "IWM240101P00221000 [SIM]"
SIM_ORH           = 220.50
SIM_ORL           = 219.50
SIM_PROFILE       = "THUNDER_CAT"

SECONDS_PER_TICK  = 6   # 10 ticks × 6 s = 60 s total


def _fib() -> dict:
    r = SIM_ORH - SIM_ORL  # 1.00
    return {
        "up_1.0":   SIM_ORH + r,
        "up_1.618": SIM_ORH + r * 1.618,
        "up_2.618": SIM_ORH + r * 2.618,
        "dn_1.0":   SIM_ORL - r,
        "dn_1.618": SIM_ORL - r * 1.618,
        "dn_2.618": SIM_ORL - r * 2.618,
        "mid":      (SIM_ORH + SIM_ORL) / 2,
        "orh":      SIM_ORH,
        "orl":      SIM_ORL,
    }


def _new_em(direction: str = SIM_DIRECTION) -> ExitManager:
    return ExitManager(
        entry_premium  = SIM_ENTRY,
        qty            = SIM_QTY,
        fib_levels     = _fib(),
        direction      = direction,
        eod_close_time = "23:59",  # never trigger EOD during simulation
        profile        = get_profile(SIM_PROFILE),
    )


# Option mid-price at each tick (entry = $1.50)
# Profit: TP1=2.25 hit at tick 3, TP2=3.00 hit at tick 6,
#         peaks $4.50 at tick 9 (+200%), trail stop at tick 10
_PROFIT_TICKS = [1.72, 2.00, 2.30, 2.55, 2.80, 3.10, 3.60, 4.10, 4.50, 3.55]

# Loss: steady decline; hard_stop=0.975 triggered at tick 4
_LOSS_TICKS   = [1.35, 1.18, 1.00, 0.95, 0.88, 0.82, 0.78, 0.75, 0.72, 0.70]

# Reversal: CALL stops out at tick 4, then PUT runs profit sequence
_REVERSAL_CALL_TICKS = [1.35, 1.18, 1.00, 0.95]
_REVERSAL_PUT_TICKS  = [1.72, 2.00, 2.30, 2.55, 2.80, 3.10, 3.60, 4.10, 4.50, 3.55]


# ── Runner ─────────────────────────────────────────────────────────────────────

class SimulationRunner:
    """
    Fire-and-forget: call start(), runs in a daemon thread.
    WebSocket fan-out goes to engine._live_clients.
    Push notifications go through engine.notifier (real Expo delivery).
    """

    def __init__(self, engine):
        self._engine  = engine
        self._running = False

    def is_running(self) -> bool:
        return self._running

    def start(self, scenario: str = "profit") -> bool:
        if self._running:
            logger.warning("[Sim] Already running — ignoring start request")
            return False
        self._running = True
        t = threading.Thread(
            target=self._run,
            args=(scenario,),
            daemon=True,
            name=f"ORBSim-{scenario}",
        )
        t.start()
        return True

    # ── Core ───────────────────────────────────────────────────────────────────

    def _run(self, scenario: str):
        try:
            if scenario == "reversal":
                self._run_reversal()
            else:
                self._run_single(scenario)
        except Exception as exc:
            logger.error("[Sim] Unexpected error: %s", exc, exc_info=True)
        finally:
            self._running = False

    def _run_single(self, scenario: str):
        """Run profit or loss scenario (single CALL leg)."""
        ticks = _PROFIT_TICKS if scenario == "profit" else _LOSS_TICKS
        em    = _new_em(SIM_DIRECTION)

        self._engine.notifier.notify_entry(
            ticker        = SIM_TICKER,
            direction     = SIM_DIRECTION,
            contract      = {"symbol": SIM_CONTRACT, "strike": SIM_STRIKE, "ask": SIM_ENTRY},
            qty           = SIM_QTY,
            entry_premium = SIM_ENTRY,
            trade_id      = "SIM",
            profile_key   = SIM_PROFILE,
            macro_event   = False,
        )
        logger.info("[Sim] Started scenario=%s  ticks=%d  interval=%ds",
                    scenario, len(ticks), SECONDS_PER_TICK)

        for tick_num, mid in enumerate(ticks, start=1):
            if not self._running:
                break

            time.sleep(SECONDS_PER_TICK)

            if scenario == "profit" and tick_num == 5:
                pnl = (mid - SIM_ENTRY) * em.qty_remaining * 100
                self._engine.notifier.notify_timer_update(
                    ticker          = SIM_TICKER,
                    contract_symbol = SIM_CONTRACT,
                    current_pnl     = pnl,
                    entry_premium   = SIM_ENTRY,
                    current_premium = mid,
                )

            self._push_ws(em, mid, tick_num, len(ticks), scenario, SIM_CONTRACT)

            action = em.evaluate(
                current_option_price     = mid,
                current_underlying_price = SIM_ORH + (mid - SIM_ENTRY) * 0.5,
            )

            if action["type"] == "HOLD":
                continue

            qty_to_close = action.get("qty", em.qty_remaining)
            closing_all  = qty_to_close >= em.qty_remaining
            exit_p       = action.get("current_premium") or mid
            pnl          = (exit_p - SIM_ENTRY) * qty_to_close * 100

            if closing_all:
                em.qty_remaining = 0
            else:
                em.qty_remaining -= qty_to_close

            self._engine.notifier.notify_exit(
                ticker          = SIM_TICKER,
                contract_symbol = SIM_CONTRACT,
                exit_reason     = action["reason"],
                pnl             = pnl,
                qty             = qty_to_close,
                profile_key     = SIM_PROFILE,
            )
            logger.info("[Sim] Exit tick=%d reason=%s qty=%d pnl=%.2f",
                        tick_num, action["reason"], qty_to_close, pnl)

            if closing_all or em.qty_remaining <= 0:
                break

        self._broadcast(json.dumps({"type": "sim_complete", "scenario": scenario}))
        logger.info("[Sim] Finished scenario=%s", scenario)

    def _run_reversal(self):
        """
        Phase 1: CALL entered, stops out at tick 4 (-$330).
        Phase 2: PUT entered on reversal, runs full profit sequence (+$810).
        Net P&L: +$480.
        """
        # ── Phase 1: CALL ─────────────────────────────────────────────────────
        call_em = _new_em(SIM_DIRECTION)
        self._engine.notifier.notify_entry(
            ticker        = SIM_TICKER,
            direction     = SIM_DIRECTION,
            contract      = {"symbol": SIM_CONTRACT, "strike": SIM_STRIKE, "ask": SIM_ENTRY},
            qty           = SIM_QTY,
            entry_premium = SIM_ENTRY,
            trade_id      = "SIM-CALL",
            profile_key   = SIM_PROFILE,
            macro_event   = False,
        )
        logger.info("[Sim] Reversal — CALL phase started")

        call_pnl = 0.0
        for tick_num, mid in enumerate(_REVERSAL_CALL_TICKS, start=1):
            if not self._running:
                return
            time.sleep(SECONDS_PER_TICK)
            self._push_ws(call_em, mid, tick_num, len(_REVERSAL_CALL_TICKS),
                          "reversal", SIM_CONTRACT, sim_leg="call")

            action = call_em.evaluate(
                current_option_price     = mid,
                current_underlying_price = SIM_ORH + (mid - SIM_ENTRY) * 0.5,
            )
            if action["type"] == "HOLD":
                continue

            exit_p   = action.get("current_premium") or mid
            call_pnl = (exit_p - SIM_ENTRY) * call_em.qty_remaining * 100
            self._engine.notifier.notify_exit(
                ticker          = SIM_TICKER,
                contract_symbol = SIM_CONTRACT,
                exit_reason     = action["reason"],
                pnl             = call_pnl,
                qty             = call_em.qty_remaining,
                profile_key     = SIM_PROFILE,
            )
            logger.info("[Sim] Reversal CALL exit tick=%d reason=%s pnl=%.2f",
                        tick_num, action["reason"], call_pnl)
            call_em.qty_remaining = 0
            break

        # Signal the reversal to connected clients before the PUT entry
        self._broadcast(json.dumps({
            "type":     "reversal_signal",
            "call_pnl": round(call_pnl, 2),
        }))
        time.sleep(SECONDS_PER_TICK)  # brief pause before PUT entry

        # ── Phase 2: PUT ──────────────────────────────────────────────────────
        put_em = _new_em(SIM_DIRECTION_PUT)
        self._engine.notifier.notify_re_entry(
            ticker        = SIM_TICKER,
            direction     = SIM_DIRECTION_PUT,
            contract      = {"symbol": SIM_CONTRACT_PUT, "strike": SIM_STRIKE, "ask": SIM_ENTRY},
            qty           = SIM_QTY,
            entry_premium = SIM_ENTRY,
            profile_key   = SIM_PROFILE,
        )
        logger.info("[Sim] Reversal — PUT phase started")

        for tick_num, mid in enumerate(_REVERSAL_PUT_TICKS, start=1):
            if not self._running:
                return
            time.sleep(SECONDS_PER_TICK)

            if tick_num == 5:
                pnl = (mid - SIM_ENTRY) * put_em.qty_remaining * 100
                self._engine.notifier.notify_timer_update(
                    ticker          = SIM_TICKER,
                    contract_symbol = SIM_CONTRACT_PUT,
                    current_pnl     = pnl,
                    entry_premium   = SIM_ENTRY,
                    current_premium = mid,
                )

            self._push_ws(put_em, mid, tick_num, len(_REVERSAL_PUT_TICKS),
                          "reversal", SIM_CONTRACT_PUT,
                          sim_leg="put", call_pnl=round(call_pnl, 2))

            action = put_em.evaluate(
                current_option_price     = mid,
                current_underlying_price = SIM_ORH - (mid - SIM_ENTRY) * 0.5,
            )
            if action["type"] == "HOLD":
                continue

            qty_to_close = action.get("qty", put_em.qty_remaining)
            closing_all  = qty_to_close >= put_em.qty_remaining
            exit_p       = action.get("current_premium") or mid
            pnl          = (exit_p - SIM_ENTRY) * qty_to_close * 100

            if closing_all:
                put_em.qty_remaining = 0
            else:
                put_em.qty_remaining -= qty_to_close

            self._engine.notifier.notify_exit(
                ticker          = SIM_TICKER,
                contract_symbol = SIM_CONTRACT_PUT,
                exit_reason     = action["reason"],
                pnl             = pnl,
                qty             = qty_to_close,
                profile_key     = SIM_PROFILE,
            )
            logger.info("[Sim] Reversal PUT exit tick=%d reason=%s qty=%d pnl=%.2f",
                        tick_num, action["reason"], qty_to_close, pnl)

            if closing_all or put_em.qty_remaining <= 0:
                break

        self._broadcast(json.dumps({"type": "sim_complete", "scenario": "reversal"}))
        logger.info("[Sim] Finished scenario=reversal  call_pnl=%.2f", call_pnl)

    # ── Helpers ────────────────────────────────────────────────────────────────

    def _push_ws(self, em: ExitManager, mid: float, tick: int, total: int,
                 scenario: str, contract: str,
                 sim_leg: str | None = None, call_pnl: float | None = None):
        ep      = em.entry_premium
        pnl     = (mid - ep) * em.qty_remaining * 100
        pnl_pct = ((mid - ep) / ep * 100) if ep > 0 else 0
        payload: dict = {
            "type":          "price_update",
            "contract":      contract,
            "mid_price":     round(mid,    4),
            "entry_premium": round(ep,     4),
            "pnl":           round(pnl,    2),
            "pnl_pct":       round(pnl_pct, 2),
            "qty_remaining": em.qty_remaining,
            "tp1_hit":       em.tp1_hit,
            "tp2_hit":       em.tp2_hit,
            "hard_stop":     round(em.hard_stop, 4),
            "tp1":           round(em.tp1,        4),
            "tp2":           round(em.tp2,        4),
            "sim":           True,
            "sim_tick":      tick,
            "sim_total":     total,
            "sim_scenario":  scenario,
        }
        if sim_leg is not None:
            payload["sim_leg"] = sim_leg
        if call_pnl is not None:
            payload["call_pnl"] = call_pnl
        self._broadcast(json.dumps(payload))

    def _broadcast(self, payload: str):
        with self._engine._live_clients_lock:
            for q in list(self._engine._live_clients):
                try:
                    q.put_nowait(payload)
                except Exception:
                    pass
