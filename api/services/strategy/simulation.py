"""
ORB strategy simulation runner.

Synthetic session that fans out WebSocket updates to connected
/ws/strategy/<id>/live clients, and — unless suppress_push is set —
fires real Expo push notifications through the engine's notifier.
No Alpaca orders, no Supabase writes.

Scenarios
---------
"profit"   — IWM CALL: crosses TP1 ~tick 3, TP2 ~tick 6 (if the chosen
             profile uses one), peaks ~tick 9, exits by tick 10 via a
             trailing stop or a breakeven pullback, depending on the
             profile's runner_mode.  (~60 s)
"loss"     — IWM CALL: steady decline, hard stop breached ~tick 4. (~24 s)
"reversal" — IWM CALL stops out ~tick 4, reversal detected, IWM PUT
             entered and runs the full profit sequence.  (~90 s)

Exit levels (TP1/TP2/hard_stop) are computed for whichever of the 6
ORB-breakout profiles the caller passes (BULL_DOG/THUNDER_CAT/WOLF/
TREND_RIDER/RETESTER/REVERSAL) via the same ExitManager/get_profile path
a real trade uses — the tick path itself is generated relative to those
levels (see _gen_profit_path/_gen_loss_path) rather than hardcoded dollar
amounts, so every profile demos its own actual thresholds correctly.
"""

import json
import logging
import threading
import time
from datetime import datetime, timedelta, timezone

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
# $ of synthetic underlying move per $1 of option-premium move — a cosmetic
# mapping for the chart only (see _underlying_at), not a real pricing model.
SIM_DELTA_K       = 0.5

SECONDS_PER_TICK  = 6   # 10 ticks × 6 s = 60 s total

# The only profiles selectable for a simulation: the automated ORB-breakout
# set. Excludes MANUAL/NO_STOP_LOSS (no reachable auto TP/SL to demo) and the
# immediate-trade-only profiles (SCALPER/PRECISION/etc. — a different feature).
VALID_SIM_PROFILES = (
    "BULL_DOG", "THUNDER_CAT", "WOLF", "TREND_RIDER", "RETESTER", "REVERSAL",
)


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


def _underlying_at(mid: float, entry: float, direction: str,
                    orh: float = SIM_ORH, k: float = SIM_DELTA_K) -> float:
    """
    Map an option premium to a synthetic IWM underlying price, purely so the
    mobile chart has something to plot on an IWM-price y-axis — not a real
    options-pricing model. CALL premium moves with the underlying; PUT
    premium moves opposite it.
    """
    sign = 1 if direction == SIM_DIRECTION else -1
    return orh + sign * (mid - entry) * k


def _new_em(direction: str = SIM_DIRECTION, profile_key: str = "THUNDER_CAT") -> ExitManager:
    return ExitManager(
        entry_premium  = SIM_ENTRY,
        qty            = SIM_QTY,
        fib_levels     = _fib(),
        direction      = direction,
        eod_close_time = "23:59",  # never trigger EOD during simulation
        profile        = get_profile(profile_key),
    )


# ── Tick-path generation ─────────────────────────────────────────────────────
# Replaces the old fixed dollar-tick arrays (which were tuned to THUNDER_CAT's
# specific $1.50 entry / $2.25 TP1 / $3.00 TP2) with paths derived from
# whichever profile's actual entry/tp1/tp2/hard_stop apply, so every
# selectable profile demonstrates its own real thresholds.

def _clean_anchors(anchors: list[tuple[int, float]]) -> list[tuple[int, float]]:
    """Keep anchors in strictly increasing tick order (drops any collision —
    defensive against unusual profile combinations, e.g. a very large
    tp1_confirm_ticks landing on the same tick as a later anchor)."""
    cleaned = [anchors[0]]
    for t, p in anchors[1:]:
        if t > cleaned[-1][0]:
            cleaned.append((t, p))
    return cleaned


def _piecewise(anchors: list[tuple[int, float]], n: int) -> list[float]:
    """anchors: strictly increasing (tick, price) pairs starting at (0, entry).
    Returns n prices for ticks 1..n, linearly interpolated between anchors."""
    anchors = _clean_anchors(anchors)
    out = []
    for tick in range(1, n + 1):
        prev_t, prev_p = anchors[0]
        next_t, next_p = anchors[-1]
        for i in range(len(anchors) - 1):
            if anchors[i][0] <= tick <= anchors[i + 1][0]:
                prev_t, prev_p = anchors[i]
                next_t, next_p = anchors[i + 1]
                break
        span = next_t - prev_t
        frac = (tick - prev_t) / span if span > 0 else 1.0
        out.append(round(prev_p + (next_p - prev_p) * frac, 4))
    return out


def _gen_profit_path(entry: float, tp1: float, tp2: float, hard_stop: float,
                      use_tp2: bool, runner_mode: str, runner_trail_pct: float,
                      tp1_confirm_ticks: int = 2, n: int = 10) -> list[float]:
    """
    Guarantees: crosses TP1 by tick 3, holds long enough to confirm TP1
    (tp1_confirm_ticks consecutive ticks — all 6 selectable profiles use 2,
    confirming at tick 4) by tick 3+tp1_confirm_ticks-1, crosses TP2 by tick 6
    if the profile uses one, peaks ~tick 9, then gives back into the
    profile's actual exit condition by the final tick: a trailing stop
    (runner_mode="trail") pulls back from the peak by runner_trail_pct, or a
    breakeven pullback (runner_mode="be_hold" — no trail, and EOD is disabled
    for the sim, so BE-stop is that profile's real exit path here).
    """
    tp1_confirm_tick = 3 + max(0, tp1_confirm_ticks - 1)
    peak_tick = 9
    target = tp2 if use_tp2 else tp1
    peak = target * 1.15

    # "trail" profiles give back to a high-water-mark trail level (still a
    # real close event). "be_hold" profiles have no trail — their only real
    # exit here is the breakeven stop, so the path must actually cross
    # entry (not just approach it) or no CLOSE event fires and the demo
    # ends with the runner still open.
    exit_price = peak * (1 - runner_trail_pct) if runner_mode == "trail" else entry * 0.995

    anchors = [(0, entry), (3, tp1 * 1.02), (tp1_confirm_tick, tp1 * 1.05)]
    if use_tp2:
        anchors.append((6, tp2 * 1.02))
    anchors.append((peak_tick, peak))
    anchors.append((n, exit_price))
    return _piecewise(anchors, n)


def _gen_loss_path(entry: float, hard_stop: float, n: int = 4) -> list[float]:
    """Linear decline that breaches hard_stop by the final tick."""
    return _piecewise([(0, entry), (n, hard_stop * 0.97)], n)


# ── Synthetic pre-entry chart history ────────────────────────────────────────

def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S%z")


def _build_pre_entry_history(orh: float = SIM_ORH, orl: float = SIM_ORL,
                              n_bars: int = 7) -> dict:
    """
    Deterministic (no RNG — reproducible demo every run) synthetic 5-min OHLC
    bars representing the opening range + a few minutes of consolidation
    before the simulated entry, in the same shape mobile's TickerHistoryData
    expects (dates/prices/volumes/opens/highs/lows). The final bar is a flat
    seed bar at orh — the mobile screen appends one real closed bar per WS
    tick from there, so entry/TP/stop events each land on their own bar.
    """
    now = time.time()
    step = 5 * 60
    mid = (orh + orl) / 2
    rng = orh - orl
    pattern = [0.0, 0.65, 0.3, -0.5, -0.85, 0.1, 0.55, 0.0]

    dates, opens, highs, lows, closes, volumes = [], [], [], [], [], []
    prev_close = mid
    for i in range(n_bars):
        frac = pattern[i % len(pattern)]
        close = mid + frac * (rng / 2) * 0.85
        open_ = prev_close
        high = max(open_, close) + rng * 0.04
        low = min(open_, close) - rng * 0.04
        dates.append(_iso(now - (n_bars - i) * step))
        opens.append(round(open_, 2))
        highs.append(round(high, 2))
        lows.append(round(low, 2))
        closes.append(round(close, 2))
        volumes.append(50_000 + i * 2_000)
        prev_close = close

    # Seed bar: flat at orh, the moment simulated entry happens.
    dates.append(_iso(now))
    opens.append(round(orh, 2))
    highs.append(round(orh, 2))
    lows.append(round(orh, 2))
    closes.append(round(orh, 2))
    volumes.append(10_000)

    return {
        "dates": dates, "prices": closes, "volumes": volumes,
        "opens": opens, "highs": highs, "lows": lows,
    }


# ── Null notifier ────────────────────────────────────────────────────────────

class _NullNotifier:
    """
    Swallows every notify_* call. Used whenever suppress_push=True — the
    standalone simulation entry point (no pre-existing strategy/user) would
    otherwise fire a real Expo push to every opted-in user app-wide, since
    StrategyNotifier's push delivery isn't scoped to any particular user.
    """
    def __getattr__(self, _name):
        def _noop(*_args, **_kwargs):
            return None
        return _noop


# ── Runner ─────────────────────────────────────────────────────────────────────

class SimulationRunner:
    """
    Fire-and-forget: call start(), runs in a daemon thread.
    WebSocket fan-out always goes to engine._live_clients regardless of
    suppress_push — only the push-notification side is optional.
    """

    def __init__(self, engine, suppress_push: bool = False):
        self._engine   = engine
        self._running  = False
        self._notifier = _NullNotifier() if suppress_push else engine.notifier

    def is_running(self) -> bool:
        return self._running

    def start(self, scenario: str = "profit", profile_key: str = "THUNDER_CAT") -> bool:
        if self._running:
            logger.warning("[Sim] Already running — ignoring start request")
            return False
        if profile_key not in VALID_SIM_PROFILES:
            profile_key = "THUNDER_CAT"
        self._running = True
        t = threading.Thread(
            target=self._run,
            args=(scenario, profile_key),
            daemon=True,
            name=f"ORBSim-{scenario}-{profile_key}",
        )
        t.start()
        return True

    # ── Core ───────────────────────────────────────────────────────────────────

    def _run(self, scenario: str, profile_key: str):
        try:
            if scenario == "reversal":
                self._run_reversal(profile_key)
            else:
                self._run_single(scenario, profile_key)
        except Exception as exc:
            logger.error("[Sim] Unexpected error: %s", exc, exc_info=True)
        finally:
            self._running = False

    def _run_single(self, scenario: str, profile_key: str):
        """Run profit or loss scenario (single CALL leg)."""
        em = _new_em(SIM_DIRECTION, profile_key)
        use_tp2 = em.profile.get("use_tp2", em.qty > 2)
        ticks = (
            _gen_profit_path(
                em.entry_premium, em.tp1, em.tp2, em.hard_stop, use_tp2,
                em.profile.get("runner_mode", "trail"),
                em.profile.get("runner_trail_pct", 0.20),
                em.profile.get("tp1_confirm_ticks", 2),
            )
            if scenario == "profit"
            else _gen_loss_path(em.entry_premium, em.hard_stop)
        )

        self._notifier.notify_entry(
            ticker        = SIM_TICKER,
            direction     = SIM_DIRECTION,
            contract      = {"symbol": SIM_CONTRACT, "strike": SIM_STRIKE, "ask": SIM_ENTRY},
            qty           = SIM_QTY,
            entry_premium = SIM_ENTRY,
            trade_id      = "SIM",
            profile_key   = profile_key,
            macro_event   = False,
        )
        logger.info("[Sim] Started scenario=%s profile=%s ticks=%d interval=%ds",
                    scenario, profile_key, len(ticks), SECONDS_PER_TICK)

        for tick_num, mid in enumerate(ticks, start=1):
            if not self._running:
                break

            time.sleep(SECONDS_PER_TICK)

            if scenario == "profit" and tick_num == 5:
                pnl = (mid - SIM_ENTRY) * em.qty_remaining * 100
                self._notifier.notify_timer_update(
                    ticker          = SIM_TICKER,
                    contract_symbol = SIM_CONTRACT,
                    current_pnl     = pnl,
                    entry_premium   = SIM_ENTRY,
                    current_premium = mid,
                )

            self._push_ws(em, mid, tick_num, len(ticks), scenario, SIM_CONTRACT)

            underlying = _underlying_at(mid, em.entry_premium, em.direction)
            action = em.evaluate(
                current_option_price     = mid,
                current_underlying_price = underlying,
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

            self._notifier.notify_exit(
                ticker          = SIM_TICKER,
                contract_symbol = SIM_CONTRACT,
                exit_reason     = action["reason"],
                pnl             = pnl,
                qty             = qty_to_close,
                profile_key     = profile_key,
            )
            logger.info("[Sim] Exit tick=%d reason=%s qty=%d pnl=%.2f",
                        tick_num, action["reason"], qty_to_close, pnl)

            if closing_all or em.qty_remaining <= 0:
                break

        self._broadcast(json.dumps({"type": "sim_complete", "scenario": scenario}))
        logger.info("[Sim] Finished scenario=%s profile=%s", scenario, profile_key)

    def _run_reversal(self, profile_key: str):
        """
        Phase 1: CALL entered, stops out ~tick 4.
        Phase 2: PUT entered on reversal, runs the full profit sequence.
        """
        # ── Phase 1: CALL ─────────────────────────────────────────────────────
        call_em = _new_em(SIM_DIRECTION, profile_key)
        call_ticks = _gen_loss_path(call_em.entry_premium, call_em.hard_stop, n=4)

        self._notifier.notify_entry(
            ticker        = SIM_TICKER,
            direction     = SIM_DIRECTION,
            contract      = {"symbol": SIM_CONTRACT, "strike": SIM_STRIKE, "ask": SIM_ENTRY},
            qty           = SIM_QTY,
            entry_premium = SIM_ENTRY,
            trade_id      = "SIM-CALL",
            profile_key   = profile_key,
            macro_event   = False,
        )
        logger.info("[Sim] Reversal — CALL phase started (profile=%s)", profile_key)

        call_pnl = 0.0
        for tick_num, mid in enumerate(call_ticks, start=1):
            if not self._running:
                return
            time.sleep(SECONDS_PER_TICK)
            self._push_ws(call_em, mid, tick_num, len(call_ticks),
                          "reversal", SIM_CONTRACT, sim_leg="call")

            underlying = _underlying_at(mid, call_em.entry_premium, call_em.direction)
            action = call_em.evaluate(
                current_option_price     = mid,
                current_underlying_price = underlying,
            )
            if action["type"] == "HOLD":
                continue

            exit_p   = action.get("current_premium") or mid
            call_pnl = (exit_p - SIM_ENTRY) * call_em.qty_remaining * 100
            self._notifier.notify_exit(
                ticker          = SIM_TICKER,
                contract_symbol = SIM_CONTRACT,
                exit_reason     = action["reason"],
                pnl             = call_pnl,
                qty             = call_em.qty_remaining,
                profile_key     = profile_key,
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
        put_em = _new_em(SIM_DIRECTION_PUT, profile_key)
        put_use_tp2 = put_em.profile.get("use_tp2", put_em.qty > 2)
        put_ticks = _gen_profit_path(
            put_em.entry_premium, put_em.tp1, put_em.tp2, put_em.hard_stop, put_use_tp2,
            put_em.profile.get("runner_mode", "trail"),
            put_em.profile.get("runner_trail_pct", 0.20),
            put_em.profile.get("tp1_confirm_ticks", 2),
        )
        self._notifier.notify_re_entry(
            ticker        = SIM_TICKER,
            direction     = SIM_DIRECTION_PUT,
            contract      = {"symbol": SIM_CONTRACT_PUT, "strike": SIM_STRIKE, "ask": SIM_ENTRY},
            qty           = SIM_QTY,
            entry_premium = SIM_ENTRY,
            profile_key   = profile_key,
        )
        logger.info("[Sim] Reversal — PUT phase started (profile=%s)", profile_key)

        for tick_num, mid in enumerate(put_ticks, start=1):
            if not self._running:
                return
            time.sleep(SECONDS_PER_TICK)

            if tick_num == 5:
                pnl = (mid - SIM_ENTRY) * put_em.qty_remaining * 100
                self._notifier.notify_timer_update(
                    ticker          = SIM_TICKER,
                    contract_symbol = SIM_CONTRACT_PUT,
                    current_pnl     = pnl,
                    entry_premium   = SIM_ENTRY,
                    current_premium = mid,
                )

            self._push_ws(put_em, mid, tick_num, len(put_ticks), "reversal", SIM_CONTRACT_PUT,
                          sim_leg="put", call_pnl=round(call_pnl, 2))

            underlying = _underlying_at(mid, put_em.entry_premium, put_em.direction)
            action = put_em.evaluate(
                current_option_price     = mid,
                current_underlying_price = underlying,
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

            self._notifier.notify_exit(
                ticker          = SIM_TICKER,
                contract_symbol = SIM_CONTRACT_PUT,
                exit_reason     = action["reason"],
                pnl             = pnl,
                qty             = qty_to_close,
                profile_key     = profile_key,
            )
            logger.info("[Sim] Reversal PUT exit tick=%d reason=%s qty=%d pnl=%.2f",
                        tick_num, action["reason"], qty_to_close, pnl)

            if closing_all or put_em.qty_remaining <= 0:
                break

        self._broadcast(json.dumps({"type": "sim_complete", "scenario": "reversal"}))
        logger.info("[Sim] Finished scenario=reversal profile=%s call_pnl=%.2f",
                    profile_key, call_pnl)

    # ── Helpers ────────────────────────────────────────────────────────────────

    def _push_ws(self, em: ExitManager, mid: float, tick: int, total: int,
                 scenario: str, contract: str,
                 sim_leg: str | None = None, call_pnl: float | None = None):
        ep      = em.entry_premium
        pnl     = (mid - ep) * em.qty_remaining * 100
        pnl_pct = ((mid - ep) / ep * 100) if ep > 0 else 0
        direction = em.direction
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
            # Synthetic underlying-price mapping (see _underlying_at) so the
            # mobile chart can plot ticks/entry/TP/stop on an IWM-price axis.
            # stop_underlying is recomputed every tick — hard_stop itself
            # moves to breakeven once TP1 fires, so this can't be a
            # one-time snapshot.
            "underlying_price": round(_underlying_at(mid, ep, direction), 2),
            "entry_underlying": round(_underlying_at(ep, ep, direction), 2),
            "tp1_underlying":   round(_underlying_at(em.tp1, ep, direction), 2),
            "tp2_underlying":   round(_underlying_at(em.tp2, ep, direction), 2),
            "stop_underlying":  round(_underlying_at(em.hard_stop, ep, direction), 2),
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
