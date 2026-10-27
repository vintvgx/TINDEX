"""
Gate block → wait-and-monitor (TODO 073d0d9f).

When the technicals gate blocks a breakout entry, the engine keeps a PENDING
WATCH instead of discarding the signal: the gate is re-evaluated on each
1-min bar close and, the first time it passes, the normal entry path runs
(contract selection, confirm-first, every risk guard). 2026-10-26 SPY: the
gate blocked at 2/4 (daily trend + RSI lag intraday momentum) and a block
that never re-checks turned a delayed entry into a missed one.

Opt-in per gate — technicals_gate.watch. A gate saved before this existed has
no `watch` key and behaves exactly as before (constraint c8fc1694). REVERSAL
keeps its own decline path (publish_reversal_declined) and never watches.

One live watch per engine. A watch ends at the earliest of:
  - a bar closing back through the trigger level (below ORH for a CALL,
    above ORL for a PUT)
  - GATE_WATCH_MAX_MIN after the block
  - the breakout window (profile breakout_time_limit_min), unless the
    strategy bypasses it — the same window that bounds a fresh signal
  - EOD close minus the profile's eod_buffer_minutes
  - a position opening, the session being skipped/reset, or a block on the
    opposite side replacing it
Persisted to orb_gate_watches; calculate_orb restores a live one after a
restart, and the minute sweep expires any whose deadline passed with no bars.
"""

import concurrent.futures
import logging
import uuid as _uuid
from datetime import datetime, timedelta
from typing import Optional

import pytz

logger = logging.getLogger(__name__)
ET = pytz.timezone("America/New_York")

GATE_WATCH_MAX_MIN = 120

# Re-checks run off the hub's bar thread — a cold-cache gate evaluation can
# take seconds and must never stall bar delivery or exit evaluation.
_WATCH_EXECUTOR = concurrent.futures.ThreadPoolExecutor(max_workers=2, thread_name_prefix="gate-watch")


def gate_score_label(gate: dict) -> str:
    """'2/4' for the factor gate, '+3/14' for the composite score."""
    if gate.get("mode") == "composite":
        return f"{int(gate.get('matched') or 0):+d}/{gate.get('total')}"
    return f"{gate.get('matched')}/{gate.get('total')}"


def gate_failed_factors(gate: dict) -> list[str]:
    if gate.get("mode") == "composite":
        tier = ((gate.get("composite") or {}).get("tier") or "").replace("_", " ")
        return [f"score {gate_score_label(gate)} {tier}".strip()]
    return [r["key"] for r in gate.get("results") or [] if not r.get("ok") and not r.get("skipped")]


class GateWatchMixin:
    """Mixed into ORBEngine. State: self._gate_watch (dict | None) and
    self._gate_watch_inflight, both reset in _reset_session_state. Every
    method that touches the watch expects the caller to hold _tick_lock,
    except on_bar's entry point, the worker, and the sweep, which take it."""

    # ── eligibility / deadline ────────────────────────────────────────────────

    def _gate_watch_eligible(self, gate_cfg: dict) -> bool:
        return (bool(gate_cfg.get("watch"))
                and self.profile_key != "REVERSAL"
                and not getattr(self, "_reversal_entry_in_progress", False))

    def _gate_watch_deadline(self, now: datetime) -> tuple[datetime, str]:
        from services.strategy.orb_engine import EOD_CLOSE_TIMES, ORB_WINDOW_MINUTES

        options = [(now + timedelta(minutes=GATE_WATCH_MAX_MIN),
                    f"{GATE_WATCH_MAX_MIN // 60}h without confirmation")]
        eod_h, eod_m = (int(x) for x in EOD_CLOSE_TIMES.get(self.ticker, "15:58").split(":"))
        eod = now.replace(hour=eod_h, minute=eod_m, second=0, microsecond=0)
        options.append((eod - timedelta(minutes=self.profile.get("eod_buffer_minutes") or 0),
                        "end of day"))
        if not self.bypass_breakout_window:
            total_min = 9 * 60 + 30 + ORB_WINDOW_MINUTES
            orb_close = now.replace(hour=total_min // 60, minute=total_min % 60, second=0, microsecond=0)
            options.append((orb_close + timedelta(minutes=self.profile.get("breakout_time_limit_min", 45)),
                            "breakout window closed"))
        return min(options, key=lambda o: o[0])

    def _gate_watch_end_reason(self, price: Optional[float], now: datetime) -> Optional[str]:
        w = self._gate_watch
        if self.trade_taken:
            return "a position opened"
        if now >= w["expires_at"]:
            return w["expiry_reason"]
        level = w.get("level")
        if price is not None and level:
            if w["direction"] == "CALL" and price < level:
                return f"price closed back below the ORB high ${level:.2f}"
            if w["direction"] == "PUT" and price > level:
                return f"price closed back above the ORB low ${level:.2f}"
        return None

    # ── lifecycle ─────────────────────────────────────────────────────────────

    def _start_gate_watch(self, direction: str, trigger_price: float, gate: dict, mode: str) -> bool:
        """Called from _enter_trade when the gate blocks a watch-eligible
        signal. Returns False when no watch could start (deadline already
        passed) — the caller then sends the plain "blocked" push."""
        now = datetime.now(ET)
        score = gate_score_label(gate)
        failed = gate_failed_factors(gate)
        w = self._gate_watch

        if w and w["direction"] == direction:
            # A fresh signal on the same side while watching: keep the original
            # deadline (it's measured from the first block), refresh the rest.
            w.update(trigger_price=trigger_price, score=score, failed=failed, summary=gate["summary"])
            self._persist_gate_watch(w, {"trigger_price": trigger_price, "failed_factors": failed,
                                         "summary": gate["summary"]})
            self.debug.emit("INFO", f"Gate still {score} on a new {direction} signal — "
                                    f"watch continues until {w['expires_at']:%H:%M} ET")
            return True

        expires_at, expiry_reason = self._gate_watch_deadline(now)
        if expires_at <= now:
            return False
        if w:
            self._end_gate_watch("cancelled", f"replaced by a {direction} block")

        level = self.orh if direction == "CALL" else self.orl
        w = {
            "id": str(_uuid.uuid4()), "strategy_id": self.strategy_id, "ticker": self.ticker,
            "direction": direction, "trigger_price": trigger_price, "level": level, "mode": mode,
            "score": score, "failed": failed, "summary": gate["summary"],
            "created_at": now, "expires_at": expires_at, "expiry_reason": expiry_reason, "checks": 0,
        }
        try:
            self.logger.create_gate_watch({
                "id": w["id"], "strategy_id": self.strategy_id, "ticker": self.ticker,
                "direction": direction, "trigger_price": trigger_price, "level": level,
                "gate_mode": mode, "failed_factors": failed, "summary": gate["summary"],
                "expires_at": expires_at.isoformat(), "expiry_reason": expiry_reason,
            })
        except Exception:
            # In-memory watch still runs; only restart-survival is lost.
            logger.error("[GateWatch] persist failed for %s %s", self.ticker, direction, exc_info=True)
        self._gate_watch = w
        self.debug.emit("WARN", f"Entry blocked — technicals gate [{mode}] {score}: {gate['summary']} "
                                f"— watching, re-checking each 1-min close until "
                                f"{expires_at:%H:%M} ET ({expiry_reason})")
        self.notifier.notify_gate_watch_started(
            self.ticker, self.strategy_name or self.profile_key, direction, gate["summary"], expires_at)
        return True

    def _end_gate_watch(self, status: str, reason: str, notify: bool = True) -> None:
        w = getattr(self, "_gate_watch", None)
        if not w:
            return
        self._gate_watch = None
        self._persist_gate_watch(w, {"status": status, "reason": reason,
                                     "resolved_at": datetime.now(ET).isoformat()})
        if status != "confirmed":
            self.debug.emit("WARN", f"Gate watch {status} — {w['ticker']} {w['direction']}: {reason}")
            if notify:
                self.notifier.notify_gate_watch_ended(
                    w["ticker"], self.strategy_name or self.profile_key, w["direction"], reason)

    def _persist_gate_watch(self, w: dict, patch: dict) -> None:
        try:
            self.logger.update_gate_watch(w["id"], patch)
        except Exception:
            logger.error("[GateWatch] update failed for %s", w.get("id"), exc_info=True)

    # ── re-check on each bar ──────────────────────────────────────────────────

    def _on_bar_gate_watch(self, close: float) -> None:
        """on_bar hook (hub thread). Cheap end-condition check under the lock,
        then the gate re-evaluation goes to the worker pool."""
        if not getattr(self, "_gate_watch", None):
            return
        with self._tick_lock:
            w = self._gate_watch
            if not w:
                return
            reason = self._gate_watch_end_reason(close, datetime.now(ET))
            if reason:
                self._end_gate_watch("expired", reason)
                return
            # Paused / halted / awaiting a confirmation: keep watching, don't
            # spend a re-check whose pass couldn't enter anyway.
            if (self._gate_watch_inflight or self._pending_confirmation is not None
                    or not self.config.get("active", True) or self._session_halted):
                return
            self._gate_watch_inflight = True
            watch_id = w["id"]
        try:
            _WATCH_EXECUTOR.submit(self._recheck_gate_watch, watch_id, close)
        except Exception:
            self._gate_watch_inflight = False
            raise

    def _recheck_gate_watch(self, watch_id: str, price: float) -> None:
        try:
            w = self._gate_watch
            if not w or w["id"] != watch_id:
                return
            gate_cfg = self.config.get("technicals_gate") or {}
            if not gate_cfg.get("enabled") or not self._gate_watch_eligible(gate_cfg):
                with self._tick_lock:
                    if self._gate_watch and self._gate_watch["id"] == watch_id:
                        self._end_gate_watch("cancelled", "gate or watch turned off")
                return
            mode = self._gate_mode(gate_cfg)
            ok, needs_confirm, gate = self._check_technicals_gate(
                w["direction"], price, gate_cfg.get("required") or [], mode=mode, quiet=True)

            with self._tick_lock:
                w = self._gate_watch
                if not w or w["id"] != watch_id:
                    return
                reason = self._gate_watch_end_reason(price, datetime.now(ET))
                if reason:
                    self._end_gate_watch("expired", reason)
                    return
                if gate is None:
                    return  # data hiccup — try again on the next bar
                w["checks"] += 1
                score = gate_score_label(gate)
                if not ok:
                    if score != w["score"]:
                        w.update(score=score, failed=gate_failed_factors(gate), summary=gate["summary"])
                        self.debug.emit("INFO", f"Gate watch {w['direction']} — now {score}: {gate['summary']}")
                        self._persist_gate_watch(w, {"failed_factors": w["failed"], "summary": gate["summary"]})
                    return
                if (self._pending_confirmation is not None or not self.config.get("active", True)
                        or self._session_halted):
                    return
                direction = w["direction"]
                self._end_gate_watch("confirmed", f"gate now {score}")
                self.debug.emit("SUCCESS", f"Watch confirmed — {self.ticker} {direction} gate now {score} "
                                           f"@ {price:.2f} — running entry")
                self.notifier.notify_gate_watch_confirmed(
                    self.ticker, self.strategy_name or self.profile_key, direction, score,
                    confirm_first=bool(needs_confirm or self.confirm_entry))
                # The gate just passed — hand its verdict to _enter_trade so it
                # doesn't re-run (and can't loop back into a new watch).
                self._enter_trade(direction, price, gate_result=bool(needs_confirm))
        except Exception:
            logger.error("[GateWatch] re-check failed for %s", self.ticker, exc_info=True)
        finally:
            self._gate_watch_inflight = False

    # ── sweep / restart / API ─────────────────────────────────────────────────

    def expire_gate_watch_if_stale(self) -> bool:
        """Minute-sweep hook: ends a watch whose deadline passed with no bar
        to notice it (quiet ticker, dead hub)."""
        if not getattr(self, "_gate_watch", None):
            return False
        with self._tick_lock:
            if not self._gate_watch:
                return False
            reason = self._gate_watch_end_reason(None, datetime.now(ET))
            if reason:
                self._end_gate_watch("expired", reason)
                return True
        return False

    def restore_gate_watch(self) -> None:
        """Called at the end of a successful calculate_orb: pick up a watch
        that was live when the backend restarted. Anything else still marked
        watching for this strategy is closed."""
        if not self.strategy_id:
            return
        try:
            rows = self.logger.list_gate_watches(strategy_id=self.strategy_id, status="watching")
        except Exception:
            logger.error("[GateWatch] restore lookup failed for %s", self.ticker, exc_info=True)
            return
        if not rows:
            return
        now = datetime.now(ET)
        gate_cfg = self.config.get("technicals_gate") or {}
        live = None
        for row in sorted(rows, key=lambda r: r.get("created_at") or "", reverse=True):
            try:
                created = _parse_ts(row["created_at"])
                expires = _parse_ts(row["expires_at"])
            except Exception:
                created = expires = None
            if (live is None and created and expires and created.date() == now.date() and expires > now
                    and gate_cfg.get("enabled") and self._gate_watch_eligible(gate_cfg)):
                live = (row, created, expires)
                continue
            try:
                self.logger.update_gate_watch(row["id"], {"status": "expired", "reason": "not restored after restart",
                                                          "resolved_at": now.isoformat()})
            except Exception:
                pass
        if not live:
            return
        row, created, expires = live
        self._gate_watch = {
            "id": row["id"], "strategy_id": self.strategy_id, "ticker": self.ticker,
            "direction": row["direction"], "trigger_price": float(row["trigger_price"]),
            "level": self.orh if row["direction"] == "CALL" else self.orl,
            "mode": row.get("gate_mode") or "daily", "score": "?", "failed": row.get("failed_factors") or [],
            "summary": row.get("summary") or "", "created_at": created, "expires_at": expires,
            "expiry_reason": row.get("expiry_reason") or "expired", "checks": 0,
        }
        self.debug.emit("INFO", f"Gate watch restored after restart — {row['direction']} until "
                                f"{expires:%H:%M} ET")

    def gate_watch_public(self) -> Optional[dict]:
        w = getattr(self, "_gate_watch", None)
        if not w:
            return None
        return {
            "id": w["id"], "strategy_id": w["strategy_id"], "ticker": w["ticker"],
            "direction": w["direction"], "trigger_price": w["trigger_price"], "level": w["level"],
            "mode": w["mode"], "score": w["score"], "failed": w["failed"], "summary": w["summary"],
            "created_at": w["created_at"].isoformat(), "expires_at": w["expires_at"].isoformat(),
            "expiry_reason": w["expiry_reason"], "checks": w["checks"],
        }


def _parse_ts(value) -> datetime:
    if isinstance(value, datetime):
        dt = value
    else:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = pytz.utc.localize(dt)
    return dt.astimezone(ET)
