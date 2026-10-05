"""
Morning brief — the daily top-4 setups and their paper entries
(TODO 8 part 1; plan agreed 2026-10-03, see docs/todos/OUTSTANDING.md #8).

Schedule (pg_cron → POST /brief/generate?phase=…, ET):
  09:00 build    score the ORB-follow universe, pick the top 4, push the brief
  09:10 rescore  re-score; quiet re-push only if the top 4 changed
  09:20 rescore
  09:28 lock     re-score, cut any play below 80, arm the rest and start
                 watching their live 1-minute bars

Per armed play, on each 1m bar from 9:30:
  - 9:30 bar opened > 0.3% through the trigger → stand down (don't chase)
  - trigger = 1m close through the trigger on ≥ 1.2× the IEX 1m volume
    baseline; a trigger bar that closed > 0.3% past it stands down instead
  - guards: daily kill switch (2 brief losses), max 2 brief trades open, an
    ORB strategy with an OPEN position in the ticker (stand down + notify),
    9:30–10:00 entry window
  - Technicals Gate must say ENTER for the play's direction
  - mode "auto" → enter now; mode "confirm" (default) → awaiting
    confirmation for 3 minutes (POST /brief/plays/<ticker>/confirm)

An entry is paper only: zone-anchored 0DTE contract, size tier by premium,
spread-tiered limit buy managed by limit_entry.run_limit_entry, then handed
to a paper immediate engine for exit management (trade_type "BRIEF").

All I/O goes through BriefIO so the flow can be tested with fakes.
"""

import logging
import threading
import time as _time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone

import pytz

from services.brief import entry_rules as rules
from services.brief.config import DEFAULTS as CONFIG_DEFAULTS
from services.brief.scoring import rank_plays, score_ticker

logger = logging.getLogger(__name__)
ET = pytz.timezone("America/New_York")

VOLUME_LOOKBACK_BARS = 20
VOLUME_MIN_SESSION_BARS = 10
OPEN_BAR_MINUTE = 9 * 60 + 30   # the 9:30 bar — the only bar the stale-at-open check runs on

TERMINAL = {"cut", "stood_down", "filled", "cancelled", "skipped", "scratch", "expired", "error"}
# Non-terminal statuses during a live trigger: checking → awaiting_confirmation | working.


def _now_iso(now: datetime) -> str:
    return now.isoformat(timespec="seconds")


class BriefService:
    def __init__(self, io: "BriefIO" = None):
        self.io = io or BriefIO()
        self._lock = threading.RLock()
        self._brief: "dict | None" = None
        # Per-trading-day state — cleared by _reset_day() when the date rolls
        # (Railway doesn't restart daily, so the singleton outlives a session).
        self._day: "date | None" = None
        self._session_bars: dict = {}     # ticker -> [(ts, close, volume)]
        self._last_price: dict = {}
        # Hub subscriptions persist across days (the handler filters by date).
        self._subscribed: set = set()

    def _reset_day(self, today: date) -> None:
        """Drop yesterday's bars and prices the first time we see a new date,
        so the volume baseline and live prices never blend sessions."""
        with self._lock:
            if self._day != today:
                self._day = today
                self._session_bars = {}
                self._last_price = {}

    # ── Build / re-score / lock ──────────────────────────────────────────────

    def generate(self, phase: str) -> dict:
        if phase not in ("build", "rescore", "lock"):
            raise ValueError("phase must be build, rescore or lock")
        now = self.io.now()
        today = now.date()
        self._reset_day(today)
        with self._lock:
            prev = self._load_today(today)
        if prev and prev.get("locked"):
            return prev   # never rebuild a locked brief

        cfg = self.io.config()
        scored = self._score_universe(cfg)
        ranked = rank_plays(scored)
        prev_by_ticker = {p["ticker"]: p for p in (prev or {}).get("plays", [])}
        # Per-ticker entry preferences (set from the Morning Brief digest or the
        # Brief tab); default is confirm.
        entry_modes = self.io.entry_modes()

        plays = []
        for p in ranked["plays"]:
            old = prev_by_ticker.get(p["ticker"])
            play = {**p,
                    "mode": entry_modes.get(p["ticker"],
                                            (old or {}).get("mode", "confirm")),
                    "status": "watching",
                    "status_reason": None,
                    "history": (old or {}).get("history", []),
                    "baseline_1m": (old or {}).get("baseline_1m")}
            if play["baseline_1m"] is None:
                play["baseline_1m"] = self.io.iex_open_baseline(p["ticker"], today)
            plays.append(play)

        locked = phase == "lock"
        if locked:
            min_score = cfg["min_setup_score"]
            for play in plays:
                if play["score"] < min_score:
                    self._set_status(play, "cut", f"score {play['score']:.0f} below {min_score:.0f} at the 9:28 lock", now)
                else:
                    self._set_status(play, "armed", None, now)

        brief = {
            "brief_date": today.isoformat(),
            "phase": phase,
            "locked": locked,
            "generated_at": (prev or {}).get("generated_at") or _now_iso(now),
            "updated_at": _now_iso(now),
            "correlation_label": ranked["correlation_label"],
            "blocked": ranked["blocked"],
            "plays": plays,
        }
        with self._lock:
            self._brief = brief
            self.io.save_brief(brief)

        old_set = set(prev_by_ticker)
        new_set = {p["ticker"] for p in plays}
        if phase == "build" or not prev:
            self._push_brief(brief, active=True)
        elif new_set != old_set:
            self._push_brief(brief, active=False, changed=True)
        if locked:
            self.start_watching()
        return brief

    def _score_universe(self, cfg: dict) -> list:
        tickers = self.io.universe()
        out = []
        with ThreadPoolExecutor(max_workers=6) as pool:
            for t, inp in zip(tickers, pool.map(self._safe_inputs, tickers)):
                if inp:
                    s = score_ticker(t, inp, earnings_block_days=cfg["earnings_block_days"],
                                     min_trigger_zone_score=cfg["min_trigger_zone_score"])
                    if s:
                        out.append(s)
        return out

    def _safe_inputs(self, ticker):
        try:
            return self.io.gather_inputs(ticker)
        except Exception as e:
            logger.warning("[brief] inputs failed for %s: %s", ticker, e)
            return None

    def _push_brief(self, brief: dict, active: bool, changed: bool = False):
        plays = brief["plays"]
        if not plays:
            body = "No qualifying setups this morning."
        else:
            body = " · ".join(
                f"{p['ticker']} {'↑' if p['direction'] == 'CALL' else '↓'} {p['trigger']:.2f} ({p['score']:.0f})"
                for p in plays)
        title = "☀️ Morning brief updated" if changed else "☀️ Morning brief — top setups"
        self.io.push(title, body, {"type": "morning_brief", "brief_date": brief["brief_date"]},
                     "active" if active else "passive")

    # ── Read / user actions ──────────────────────────────────────────────────

    def today(self) -> "dict | None":
        with self._lock:
            return self._load_today(self.io.now().date())

    def today_view(self) -> "dict | None":
        """today() plus live context for the app: each play's latest
        underlying price (the tracking card's distance-to-trigger) and the
        server clock, so countdowns don't depend on the phone's clock."""
        brief = self.today()
        if not brief:
            return None
        plays = [{**p, "live_price": self._last_price.get(p["ticker"])} for p in brief["plays"]]
        return {**brief, "plays": plays, "server_time": _time.time()}

    def set_mode(self, ticker: str, mode: str) -> dict:
        if mode not in ("auto", "confirm"):
            raise ValueError("mode must be auto or confirm")
        with self._lock:
            play = self._play(ticker)
            if play["status"] in TERMINAL or play["status"] in ("checking", "working", "awaiting_confirmation"):
                raise ValueError(f"{ticker} is {play['status']} — mode can't change now")
            play["mode"] = mode
            self._save()
            try:
                # Keep the digest toggle and the Brief tab on one source of truth.
                self.io.set_entry_mode(ticker, mode)
            except Exception as e:
                logger.warning("[brief] entry_modes persist failed for %s: %s", ticker, e)
            return play

    def confirm(self, ticker: str) -> dict:
        now = self.io.now()
        with self._lock:
            play = self._play(ticker)
            if play["status"] != "awaiting_confirmation":
                raise ValueError(f"{ticker} is {play['status']}, not awaiting confirmation")
            if now >= datetime.fromisoformat(play["confirm_expires_at"]):
                self._set_status(play, "expired", "confirmation window passed", now)
                self._save()
                self._log_signal(play, fill_status="expired")
                raise ValueError("confirmation expired")
            if not rules.in_entry_window(now.time()):
                self._set_status(play, "stood_down", "outside the 9:30–10:00 entry window", now)
                self._save()
                self._log_signal(play, fill_status="stood_down")
                raise ValueError("outside the entry window")
            px = self._last_price.get(ticker)
            stale = self.io.config()["stale_pct"]
            if px is not None and rules.stale_through(play["direction"], play["trigger"], px, stale):
                self._set_status(play, "stood_down", f"price {px:.2f} ran > {stale * 100:.1f}% past the trigger", now)
                self._save()
                self._log_signal(play, fill_status="stood_down")
                raise ValueError("price ran past the trigger")
            self._set_status(play, "working", "confirmed — placing limit order", now)
            self._save()
        self._enter_async(ticker)
        return play

    def skip(self, ticker: str) -> dict:
        with self._lock:
            play = self._play(ticker)
            if play["status"] in TERMINAL or play["status"] == "working":
                raise ValueError(f"{ticker} is {play['status']}")
            was_signal = play["status"] == "awaiting_confirmation"
            self._set_status(play, "skipped", "skipped by you", self.io.now())
            self._save()
            if was_signal:
                self._log_signal(play, fill_status="skipped")
            return play

    # ── Live watch ───────────────────────────────────────────────────────────

    def start_watching(self):
        """Subscribe to live 1m bars for every armed play (idempotent; also
        called at boot to resume a locked brief)."""
        brief = self.today()
        if not brief or not brief.get("locked"):
            return
        for play in brief["plays"]:
            t = play["ticker"]
            if play["status"] == "armed" and t not in self._subscribed:
                self.io.subscribe(t, self._make_handler(t))
                self._subscribed.add(t)

    def _make_handler(self, ticker):
        def handler(bar):
            try:
                self.on_bar(ticker, bar)
            except Exception as e:
                logger.error("[brief] bar handling failed for %s: %s", ticker, e, exc_info=True)
        return handler

    def on_bar(self, ticker: str, bar) -> None:
        if bar.close is None:
            return
        ts = bar.ts if bar.ts.tzinfo else ET.localize(bar.ts)
        ts = ts.astimezone(ET)
        today = self.io.now().date()
        if ts.date() != today:
            return
        self._reset_day(today)
        self._last_price[ticker] = float(bar.close)
        minutes = ts.hour * 60 + ts.minute
        if minutes < 9 * 60 + 30:
            return
        bars = self._session_bars.setdefault(ticker, [])

        cfg = self.io.config()
        stale = cfg["stale_pct"]
        with self._lock:
            brief = self._load_today(today)
            if not brief or not brief.get("locked"):
                return
            play = next((p for p in brief["plays"] if p["ticker"] == ticker), None)
            if not play:
                return
            now = self.io.now()
            self._expire_confirmations(brief, now)

            # Baseline from bars BEFORE this one (same IEX feed); until there
            # are 10 session bars, yesterday's IEX opening-half-hour average.
            prior = bars[-VOLUME_LOOKBACK_BARS:]
            baseline = (sum(v for _, _, v in prior) / len(prior)) if len(prior) >= VOLUME_MIN_SESSION_BARS \
                else play.get("baseline_1m")
            bars.append((ts, float(bar.close), float(bar.volume or 0)))

            if play["status"] != "armed":
                self._save()
                return

            # Stale-at-open runs on the actual 9:30 bar only. After a
            # mid-session restart the first bar we see might be 9:45 — that's
            # not "the open", and treating it as one would stand down a play
            # that legitimately triggered at 9:40 as "chased". (The trigger
            # bar's own stale check below still applies to every trigger.)
            if minutes == OPEN_BAR_MINUTE:
                open_px = float(bar.open if bar.open is not None else bar.close)
                if rules.stale_through(play["direction"], play["trigger"], open_px, stale):
                    self._stand_down(play, f"opened at {open_px:.2f}, already > {stale * 100:.1f}% through the "
                                           f"{play['trigger']:.2f} trigger — not chasing", now, notify=True)
                    return

            if not rules.trigger_hit(play["direction"], play["trigger"], float(bar.close),
                                     float(bar.volume or 0), baseline, cfg["trigger_volume_mult"]):
                if not rules.in_entry_window(ts.time()) and minutes >= 10 * 60:
                    self._stand_down(play, "no trigger in the 9:30–10:00 window", now, notify=False)
                return

            close = float(bar.close)
            if rules.stale_through(play["direction"], play["trigger"], close, stale):
                self._stand_down(play, f"trigger bar closed at {close:.2f}, > {stale * 100:.1f}% past the "
                                       f"{play['trigger']:.2f} trigger — not chasing", now, notify=True)
                return

            # Guards + Technicals Gate do DB/network calls — run them off the
            # hub's bar thread (it serves every ticker). "checking" blocks a
            # second trigger meanwhile.
            self._set_status(play, "checking", f"triggered at {close:.2f} — checking guards and gate", now)
            play["signal_at"] = _now_iso(ts)
            play["signal_price"] = close
            self._save()
        threading.Thread(target=self._evaluate_trigger, args=(ticker, close, ts), daemon=True,
                         name=f"brief-check-{ticker}").start()

    def _evaluate_trigger(self, ticker: str, close: float, ts) -> None:
        now = self.io.now()
        today = now.date()
        with self._lock:
            play = self._play(ticker)
            brief = self._brief
            working = self._working_count(brief)
        cfg = self.io.config()
        guard = rules.play_guard(
            play,
            brief_losses_today=self.io.brief_losses_today(today),
            open_brief_trades=self.io.open_brief_trades(today) + working,
            orb_position_open=self.io.orb_position_open(ticker),
            now_t=ts.time(),
            max_losses=cfg["max_losses_per_day"],
            max_open=cfg["max_open_trades"],
        )
        verdict = {} if guard else (self.io.gate_verdict(ticker, play["direction"]) or {})
        decision = verdict.get("decision")

        enter = False
        with self._lock:
            play = self._play(ticker)
            if play["status"] != "checking":
                return
            if guard:
                reason, retry = guard
                if retry:
                    # Slots full — stay armed; the next qualifying trigger bar
                    # re-runs the guards (a slot may have freed by then).
                    self._set_status(play, "armed", reason, now)
                    self._save()
                    return
                self._stand_down(play, reason, now, notify=True)
                self._log_signal(play, fill_status="stood_down")
                return
            play["gate_at_trigger"] = decision
            play["gate_agree"] = verdict.get("factors_agree")
            play["gate_total"] = verdict.get("factors_total")
            if decision != "ENTER":
                # Not a stand-down: a later qualifying bar re-checks the gate.
                self._set_status(play, "armed", f"trigger hit but Technicals Gate said {decision or 'unavailable'}", now)
                self._save()
                return
            if play["mode"] == "auto":
                self._set_status(play, "working", "triggered — placing limit order", now)
                enter = True
            else:
                ttl = cfg["confirm_ttl_seconds"]
                play["confirm_expires_at"] = _now_iso(now + timedelta(seconds=ttl))
                self._set_status(play, "awaiting_confirmation",
                                 f"triggered at {close:.2f} — confirm within {ttl // 60}:{ttl % 60:02d}", now)
            self._save()
        self._log_signal(play, fill_status="pending")
        if enter:
            self._enter(ticker)
        elif play["status"] == "awaiting_confirmation":
            self.io.push(f"⏳ {ticker} brief play triggered — confirm?",
                         f"{'Long' if play['direction'] == 'CALL' else 'Short'} through {play['trigger']:.2f}, "
                         f"score {play['score']:.0f}, gate ENTER. Paper. Expires in {cfg['confirm_ttl_seconds'] // 60} min.",
                         {"type": "brief_confirm", "ticker": ticker}, "active")

    def _working_count(self, brief) -> int:
        return sum(1 for p in brief["plays"] if p["status"] == "working")

    def _expire_confirmations(self, brief, now):
        for p in brief["plays"]:
            if p["status"] == "awaiting_confirmation" and now >= datetime.fromisoformat(p["confirm_expires_at"]):
                self._set_status(p, "expired", "not confirmed in time", now)
                self._log_signal(p, fill_status="expired")

    # ── Entry ────────────────────────────────────────────────────────────────

    def _enter_async(self, ticker):
        threading.Thread(target=self._enter, args=(ticker,), daemon=True, name=f"brief-entry-{ticker}").start()

    def _enter(self, ticker):
        with self._lock:
            play = dict(self._play(ticker))

        def on_update(state, info):
            with self._lock:
                p = self._play(ticker)
                p["order"] = {**(p.get("order") or {}), "state": state, **{k: v for k, v in info.items()}}
                self._save()

        try:
            result = self.io.execute_entry(play, lambda: self._last_price.get(ticker), on_update, self.io.config())
        except Exception as e:
            logger.error("[brief] entry failed for %s: %s", ticker, e, exc_info=True)
            result = {"state": "ERROR", "reason": str(e)}

        now = self.io.now()
        state = result.get("state")
        with self._lock:
            p = self._play(ticker)
            if state == "FILLED":
                p["trade_id"] = result.get("trade_id")
                # The final result is authoritative for the fill (on_update
                # may have missed the last transition).
                p["order"] = {**(p.get("order") or {}), "state": "FILLED",
                              **{k: result[k] for k in ("filled_qty", "avg_price", "profile") if result.get(k) is not None}}
                self._set_status(p, "filled", f"filled {result.get('filled_qty')} @ {result.get('avg_price'):.2f} "
                                             f"({result.get('profile')})", now)
                title, level = f"✅ {ticker} brief entry filled", "active"
            elif state == "SKIPPED":
                self._set_status(p, "skipped", result.get("reason"), now)
                title, level = f"⏭️ {ticker} brief play skipped", "passive"
            elif state == "SCRATCH":
                self._set_status(p, "scratch", f"partial fill flattened — {result.get('reason')}", now)
                title, level = f"↩️ {ticker} brief entry scratched", "active"
            elif state in ("CANCELLED_TIMEOUT", "CANCELLED_STALE"):
                self._set_status(p, "cancelled", result.get("reason"), now)
                title, level = f"✖️ {ticker} brief order cancelled", "active"
            else:
                self._set_status(p, "error", result.get("reason") or "entry failed", now)
                title, level = f"⚠️ {ticker} brief entry failed", "active"
            self._save()
        self._log_signal(p, fill_status=p["status"])
        self.io.push(title, p["status_reason"] or "", {"type": "brief_order", "ticker": ticker, "state": state}, level)

    # ── Signal log (part 3) ──────────────────────────────────────────────────

    def _log_signal(self, play: dict, fill_status: str) -> None:
        """Upsert this play's path-A row in paper_signals — one per play per
        day, updated as it moves pending → filled / cancelled / skipped …
        The setup outcome and the trade's P&L are filled in by the 16:15
        resolve job (POST /brief/review/resolve)."""
        o = play.get("order") or {}
        brief_date = (self._brief or {}).get("brief_date") or self.io.now().date().isoformat()
        row = {
            "id": f"A-{brief_date}-{play['ticker']}",
            "signal_path": "A",
            "signal_date": brief_date,
            "ticker": play["ticker"],
            "direction": play["direction"],
            "signal_at": play.get("signal_at"),
            "signal_price": play.get("signal_price"),
            "setup_score": play.get("score"),
            "zone_score": (play.get("trigger_zone") or {}).get("score"),
            "gate_decision": play.get("gate_at_trigger"),
            "gate_agree": play.get("gate_agree"),
            "gate_total": play.get("gate_total"),
            "trigger": play["trigger"],
            "target": play["target"],
            "invalidation": play["invalidation"],
            "fill_status": fill_status,
            "trade_id": play.get("trade_id"),
            "contract_symbol": o.get("symbol"),
            "qty": o.get("filled_qty") if fill_status == "filled" else o.get("qty"),
            "profile": o.get("profile"),
            "entry_premium": o.get("avg_price") if fill_status == "filled" else None,
            "paper_mode": True,
        }
        def _write():
            try:
                self.io.log_signal(row)
            except Exception as e:
                logger.warning("[brief] signal log failed for %s: %s", row["ticker"], e)
        # Off-thread: callers may hold the brief lock on the hub's bar thread.
        threading.Thread(target=_write, daemon=True, name=f"brief-signal-{row['ticker']}").start()

    # ── Helpers ──────────────────────────────────────────────────────────────

    def _stand_down(self, play, reason, now, notify: bool):
        self._set_status(play, "stood_down", reason, now)
        self._save()
        if notify:
            self.io.push(f"🛑 {play['ticker']} brief play stood down", reason,
                         {"type": "brief_stand_down", "ticker": play["ticker"]}, "passive")

    def _set_status(self, play, status, reason, now):
        play["status"] = status
        play["status_reason"] = reason
        self._log(play, status, reason, now)

    @staticmethod
    def _log(play, event, reason, now):
        play.setdefault("history", []).append({"at": _now_iso(now), "event": event, "reason": reason})

    def _play(self, ticker) -> dict:
        brief = self._load_today(self.io.now().date())
        if not brief:
            raise ValueError("no morning brief today")
        t = ticker.upper()
        play = next((p for p in brief["plays"] if p["ticker"] == t), None)
        if not play:
            raise ValueError(f"{t} is not in today's brief")
        return play

    def _load_today(self, today: date) -> "dict | None":
        if self._brief and self._brief.get("brief_date") == today.isoformat():
            return self._brief
        self._brief = self.io.load_brief(today)
        return self._brief

    def _save(self):
        if self._brief:
            self._brief["updated_at"] = _now_iso(self.io.now())
            self.io.save_brief(self._brief)


# ── Production I/O ─────────────────────────────────────────────────────────────

class BriefIO:
    """Everything the brief touches outside itself. Tests replace this."""

    def now(self) -> datetime:
        return datetime.now(ET)

    def _sb(self):
        from services.supabase.supabase_service import get_supabase_service
        return get_supabase_service().client

    def universe(self) -> list:
        rows = self._sb().table("user_stock_follows").select("ticker").eq("orb_enabled", True).execute().data or []
        return sorted({r["ticker"].upper() for r in rows if r.get("ticker")})

    def user_ids(self) -> list:
        rows = self._sb().table("user_stock_follows").select("user_id").eq("orb_enabled", True).execute().data or []
        return sorted({r["user_id"] for r in rows if r.get("user_id")})

    def gather_inputs(self, ticker: str) -> "dict | None":
        from services.strategy.zone_engine import zones as _zones
        snap = _zones(ticker)
        if snap.get("error"):
            return None
        price = snap["current_price"]
        prior = snap.get("prior_day") or {}
        zones = snap.get("support", []) + snap.get("resistance", [])

        trend = rsi = sector = None
        try:
            from services.entry_check_service import get_entry_check
            rows = (get_entry_check(ticker, "CALL") or {}).get("rows") or {}
            trend = (rows.get("trend") or {}).get("label")
            rsi = (rows.get("rsi") or {}).get("value")
            sector = (rows.get("sector") or {}).get("sector")
        except Exception as e:
            logger.info("[brief] technicals unavailable for %s: %s", ticker, e)

        pm_high = pm_low = None
        try:
            from services.ticker_brief.fetch import cached, yf_ticker
            def _pm():
                h = yf_ticker(ticker).history(period="1d", interval="5m", prepost=True)
                if h is None or h.empty:
                    return None
                idx = h.index.tz_convert(ET) if h.index.tz is not None else h.index.tz_localize(ET)
                pre = h[(idx.hour * 60 + idx.minute) < 9 * 60 + 30]
                if pre.empty:
                    return None
                return float(pre["High"].max()), float(pre["Low"].min())
            pm, _ = cached(f"brief_pm:{ticker}", 60, _pm)
            if pm:
                pm_high, pm_low = pm
        except Exception as e:
            logger.info("[brief] pre-market range unavailable for %s: %s", ticker, e)

        earnings_days = None
        try:
            from services.ticker_brief.sections import next_earnings
            nd = next_earnings(ticker)
            if nd:
                earnings_days = (date.fromisoformat(nd) - self.now().date()).days
        except Exception:
            pass

        gap = ((price - prior["close"]) / prior["close"] * 100) if prior.get("close") else 0.0
        return {"price": price, "zones": zones, "trend": trend, "rsi": rsi, "sector": sector,
                "gap_pct": gap, "pm_high": pm_high, "pm_low": pm_low, "prior_day": prior,
                "earnings_in_days": earnings_days}

    def iex_open_baseline(self, ticker: str, today: date) -> "float | None":
        """Average 1m IEX volume over the most recent prior session's
        9:30–10:00 — the same feed as the live bars, so the 1.2× check
        compares like with like."""
        try:
            import os
            from alpaca.data.historical import StockHistoricalDataClient
            from alpaca.data.requests import StockBarsRequest
            from alpaca.data.timeframe import TimeFrame, TimeFrameUnit
            client = StockHistoricalDataClient(os.getenv("ALPACA_LIVE_API_KEY"), os.getenv("ALPACA_LIVE_SECRET_KEY"))
            start = ET.localize(datetime.combine(today - timedelta(days=7), datetime.min.time()))
            end = ET.localize(datetime.combine(today, datetime.min.time()))
            resp = client.get_stock_bars(StockBarsRequest(symbol_or_symbols=ticker,
                                                          timeframe=TimeFrame(5, TimeFrameUnit.Minute),
                                                          start=start, end=end, feed="iex"))
            bars = resp.data.get(ticker, [])
            by_day: dict = {}
            for b in bars:
                ts = b.timestamp.astimezone(ET)
                m = ts.hour * 60 + ts.minute
                if 9 * 60 + 30 <= m < 10 * 60:
                    by_day.setdefault(ts.date(), []).append(float(b.volume or 0))
            days = sorted(d for d in by_day if d < today)
            if not days:
                return None
            vols = by_day[days[-1]]
            return round(sum(vols) / 30.0, 1) if vols else None
        except Exception as e:
            logger.warning("[brief] IEX opening baseline failed for %s: %s", ticker, e)
            return None

    def load_brief(self, today: date) -> "dict | None":
        rows = (self._sb().table("morning_briefs").select("*").eq("brief_date", today.isoformat())
                .limit(1).execute().data or [])
        if not rows:
            return None
        r = rows[0]
        return {"brief_date": r["brief_date"], "phase": r.get("phase"), "locked": r.get("locked", False),
                "generated_at": r.get("generated_at"), "updated_at": r.get("updated_at"),
                "correlation_label": r.get("correlation_label"), "blocked": r.get("blocked") or [],
                "plays": r.get("plays") or []}

    def save_brief(self, brief: dict) -> None:
        try:
            self._sb().table("morning_briefs").upsert({
                "brief_date": brief["brief_date"], "phase": brief["phase"], "locked": brief["locked"],
                "generated_at": brief["generated_at"], "updated_at": brief["updated_at"],
                "correlation_label": brief["correlation_label"], "blocked": brief["blocked"],
                "plays": brief["plays"],
            }, on_conflict="brief_date").execute()
        except Exception as e:
            logger.error("[brief] save failed: %s", e)

    def push(self, title, body, data, level):
        try:
            from services.strategy.notifier import StrategyNotifier
            if not hasattr(self, "_notifier"):
                self._notifier = StrategyNotifier(self._sb())
            self._notifier.notify_brief_event(title, body, self.user_ids(), data, interruption_level=level)
        except Exception as e:
            logger.warning("[brief] push failed: %s", e)

    def config(self) -> dict:
        if not hasattr(self, "_config"):
            from services.brief.config import ConfigStore
            self._config = ConfigStore(self._sb)
        return self._config.get()

    def entry_modes(self) -> dict:
        """Per-ticker confirm/auto preferences ({ticker: mode}); empty on any
        failure — callers fall back to 'confirm'."""
        try:
            rows = self._sb().table("brief_entry_modes").select("ticker,mode").execute().data or []
            return {r["ticker"].upper(): r["mode"] for r in rows if r.get("ticker")}
        except Exception as e:
            logger.warning("[brief] entry_modes read failed: %s", e)
            return {}

    def set_entry_mode(self, ticker: str, mode: str) -> dict:
        if mode not in ("confirm", "auto"):
            raise ValueError("mode must be confirm or auto")
        t = ticker.upper()
        self._sb().table("brief_entry_modes").upsert(
            {"ticker": t, "mode": mode,
             "updated_at": datetime.now(timezone.utc).isoformat()},
            on_conflict="ticker").execute()
        return {"ticker": t, "mode": mode}

    def gate_verdict(self, ticker: str, direction: str) -> "dict | None":
        """Technicals Gate verdict: {decision, factors_agree, factors_total, …}."""
        try:
            from services.entry_check_service import get_entry_check
            chk = get_entry_check(ticker, direction) or {}
            return (chk.get("verdicts") or {}).get(direction) or chk.get("verdict") or None
        except Exception as e:
            logger.warning("[brief] gate check failed for %s: %s", ticker, e)
            return None

    def update_config(self, patch: dict) -> dict:
        self.config()   # ensure the store exists
        return self._config.update(patch)

    def signals_between(self, start: date, end: date, paper_only: bool) -> list:
        q = (self._sb().table("paper_signals").select("*")
             .gte("signal_date", start.isoformat()).lte("signal_date", end.isoformat()))
        if paper_only:
            q = q.eq("paper_mode", True)
        return q.order("signal_at", desc=True).execute().data or []

    def log_signal(self, row: dict) -> None:
        from services.brief.signal_log import upsert_signal
        upsert_signal(self._sb(), row)

    def brief_losses_today(self, today: date) -> int:
        rows = (self._sb().table("orb_trades").select("pnl, exit_time").eq("trade_type", "BRIEF")
                .eq("trade_date", today.isoformat()).execute().data or [])
        return sum(1 for r in rows if r.get("exit_time") and (r.get("pnl") or 0) < 0)

    def open_brief_trades(self, today: date) -> int:
        rows = (self._sb().table("orb_trades").select("exit_time").eq("trade_type", "BRIEF")
                .eq("trade_date", today.isoformat()).execute().data or [])
        return sum(1 for r in rows if not r.get("exit_time"))

    def orb_position_open(self, ticker: str) -> bool:
        from routes.strategy_routes import _engines
        t = ticker.upper()
        return any(getattr(e, "ticker", "").upper() == t and getattr(e, "trade_taken", False)
                   for e in _engines.values())

    def subscribe(self, ticker: str, cb) -> None:
        from services.utils.orb_data_hub import get_orb_data_hub
        get_orb_data_hub().subscribe_bar(ticker, cb)

    def execute_entry(self, play: dict, underlying_price, on_update, cfg: "dict | None" = None) -> dict:
        """Live chain → zone-anchored contract → size tier → spread gate →
        buying-power check → managed limit buy → paper immediate engine."""
        from routes.strategy_routes import _get_or_create_immediate_engine
        from services.brief.limit_entry import run_limit_entry, FILLED
        from services.strategy.profiles import get_profile
        from alpaca.data.requests import OptionChainRequest
        from alpaca.data.enums import OptionsFeed
        from services.strategy.contract_selector import _parse_occ_strike

        ticker, direction = play["ticker"], play["direction"]
        engine = _get_or_create_immediate_engine(ticker, True)   # paper only
        chain = engine.option_client.get_option_chain(OptionChainRequest(
            underlying_symbol=ticker, expiration_date=self.now().date(),
            type="call" if direction == "CALL" else "put", feed=OptionsFeed.INDICATIVE))
        rows = []
        for symbol, snap in chain.items():
            strike = _parse_occ_strike(symbol)
            q = getattr(snap, "latest_quote", None)
            if strike is None or q is None:
                continue
            g = getattr(snap, "greeks", None)
            rows.append({"symbol": symbol, "strike": strike,
                         "ask": float(getattr(q, "ask_price", 0) or 0), "bid": float(getattr(q, "bid_price", 0) or 0),
                         "delta": getattr(g, "delta", None) if g else None})
        pick = rules.pick_contract(rows, direction, play["trigger"], play["target"])
        if not pick:
            return {"state": "SKIPPED", "reason": "no 0DTE contract fits the budget, delta and ≤ 30% spread rules"}
        gate, tier = pick["gate"], pick["tier"]
        qty, profile_key = tier["qty"], tier["profile"]

        acct = engine.get_account_info()
        if acct and qty * gate["limit"] * 100 > acct["options_buying_power"]:
            return {"state": "SKIPPED", "reason": f"paper buying power ${acct['options_buying_power']:.0f} < "
                                                  f"${qty * gate['limit'] * 100:.0f} needed"}
        on_update("SELECTED", {"symbol": pick["symbol"], "strike": pick["strike"], "qty": qty,
                               "profile": profile_key, "limit": gate["limit"], "limit_basis": gate["action"],
                               "spread_pct": gate["spread_pct"], "delta_target": pick["delta_target"]})

        cfg = cfg or CONFIG_DEFAULTS
        result = run_limit_entry(engine.trading_client, pick["symbol"], qty, gate["limit"],
                                 play["trigger"], underlying_price, on_update=on_update,
                                 timeout=cfg["limit_timeout_seconds"], drift_pct=cfg["stale_pct"])
        if result["state"] != FILLED:
            return result
        contract = {"symbol": pick["symbol"], "strike": pick["strike"], "ask": result["avg_price"],
                    "bid": pick["bid"], "delta": pick.get("delta"), "expiry": self.now().date().isoformat()}
        anchor = underlying_price() or play["trigger"]
        lock = getattr(engine, "_tick_lock", None) or threading.RLock()
        with lock:
            engine._execute_entry(direction, contract, qty, get_profile(profile_key),
                                  engine._synthetic_fib_levels(anchor), manual=True,
                                  profile_key_override=profile_key, prefilled_order=result["order"],
                                  trade_type_override="BRIEF")
        return {**result, "trade_id": engine.active_trade_id, "profile": profile_key}


_service = None
_service_lock = threading.Lock()


def get_brief_service() -> BriefService:
    global _service
    with _service_lock:
        if _service is None:
            _service = BriefService()
        return _service
