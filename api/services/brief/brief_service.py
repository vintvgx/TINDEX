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
from datetime import date, datetime, timedelta

import pytz

from services.brief import entry_rules as rules
from services.brief.scoring import PROMISING_SCORE, rank_plays, score_ticker

logger = logging.getLogger(__name__)
ET = pytz.timezone("America/New_York")

CONFIRM_TTL_SECONDS = 3 * 60
VOLUME_LOOKBACK_BARS = 20
VOLUME_MIN_SESSION_BARS = 10

TERMINAL = {"cut", "stood_down", "filled", "cancelled", "skipped", "scratch", "expired", "error"}
# Non-terminal statuses during a live trigger: checking → awaiting_confirmation | working.


def _now_iso(now: datetime) -> str:
    return now.isoformat(timespec="seconds")


class BriefService:
    def __init__(self, io: "BriefIO" = None):
        self.io = io or BriefIO()
        self._lock = threading.RLock()
        self._brief: "dict | None" = None
        self._session_bars: dict = {}     # ticker -> [(ts, close, volume)]
        self._last_price: dict = {}
        self._first_bar_seen: set = set()
        self._subscribed: set = set()

    # ── Build / re-score / lock ──────────────────────────────────────────────

    def generate(self, phase: str) -> dict:
        if phase not in ("build", "rescore", "lock"):
            raise ValueError("phase must be build, rescore or lock")
        now = self.io.now()
        today = now.date()
        with self._lock:
            prev = self._load_today(today)
        if prev and prev.get("locked"):
            return prev   # never rebuild a locked brief

        scored = self._score_universe()
        ranked = rank_plays(scored)
        prev_by_ticker = {p["ticker"]: p for p in (prev or {}).get("plays", [])}

        plays = []
        for p in ranked["plays"]:
            old = prev_by_ticker.get(p["ticker"])
            play = {**p,
                    "mode": (old or {}).get("mode", "confirm"),
                    "status": "watching",
                    "status_reason": None,
                    "history": (old or {}).get("history", []),
                    "baseline_1m": (old or {}).get("baseline_1m")}
            if play["baseline_1m"] is None:
                play["baseline_1m"] = self.io.iex_open_baseline(p["ticker"], today)
            plays.append(play)

        locked = phase == "lock"
        if locked:
            for play in plays:
                if play["score"] < PROMISING_SCORE:
                    self._set_status(play, "cut", f"score {play['score']:.0f} below {PROMISING_SCORE} at the 9:28 lock", now)
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

    def _score_universe(self) -> list:
        tickers = self.io.universe()
        out = []
        with ThreadPoolExecutor(max_workers=6) as pool:
            for t, inp in zip(tickers, pool.map(self._safe_inputs, tickers)):
                if inp:
                    s = score_ticker(t, inp)
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
                raise ValueError("confirmation expired")
            if not rules.in_entry_window(now.time()):
                self._set_status(play, "stood_down", "outside the 9:30–10:00 entry window", now)
                self._save()
                raise ValueError("outside the entry window")
            px = self._last_price.get(ticker)
            if px is not None and rules.stale_through(play["direction"], play["trigger"], px):
                self._set_status(play, "stood_down", f"price {px:.2f} ran > 0.3% past the trigger", now)
                self._save()
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
            self._set_status(play, "skipped", "skipped by you", self.io.now())
            self._save()
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
        self._last_price[ticker] = float(bar.close)
        minutes = ts.hour * 60 + ts.minute
        if minutes < 9 * 60 + 30:
            return
        bars = self._session_bars.setdefault(ticker, [])

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

            if ticker not in self._first_bar_seen:
                self._first_bar_seen.add(ticker)
                open_px = float(bar.open if bar.open is not None else bar.close)
                if rules.stale_through(play["direction"], play["trigger"], open_px):
                    self._stand_down(play, f"opened at {open_px:.2f}, already > 0.3% through the "
                                           f"{play['trigger']:.2f} trigger — not chasing", now, notify=True)
                    return

            if not rules.trigger_hit(play["direction"], play["trigger"], float(bar.close),
                                     float(bar.volume or 0), baseline):
                if not rules.in_entry_window(ts.time()) and minutes >= 10 * 60:
                    self._stand_down(play, "no trigger in the 9:30–10:00 window", now, notify=False)
                return

            close = float(bar.close)
            if rules.stale_through(play["direction"], play["trigger"], close):
                self._stand_down(play, f"trigger bar closed at {close:.2f}, > 0.3% past the "
                                       f"{play['trigger']:.2f} trigger — not chasing", now, notify=True)
                return

            # Guards + Technicals Gate do DB/network calls — run them off the
            # hub's bar thread (it serves every ticker). "checking" blocks a
            # second trigger meanwhile.
            self._set_status(play, "checking", f"triggered at {close:.2f} — checking guards and gate", now)
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
        reason = rules.play_guard(
            play,
            brief_losses_today=self.io.brief_losses_today(today),
            open_brief_trades=self.io.open_brief_trades(today) + working,
            orb_position_open=self.io.orb_position_open(ticker),
            now_t=ts.time(),
        )
        decision = None if reason else self.io.gate_decision(ticker, play["direction"])

        enter = False
        with self._lock:
            play = self._play(ticker)
            if play["status"] != "checking":
                return
            if reason:
                self._stand_down(play, reason, now, notify=True)
                return
            play["gate_at_trigger"] = decision
            if decision != "ENTER":
                # Not a stand-down: a later qualifying bar re-checks the gate.
                self._set_status(play, "armed", f"trigger hit but Technicals Gate said {decision or 'unavailable'}", now)
                self._save()
                return
            if play["mode"] == "auto":
                self._set_status(play, "working", "triggered — placing limit order", now)
                enter = True
            else:
                play["confirm_expires_at"] = _now_iso(now + timedelta(seconds=CONFIRM_TTL_SECONDS))
                self._set_status(play, "awaiting_confirmation",
                                 f"triggered at {close:.2f} — confirm within 3 min", now)
            self._save()
        if enter:
            self._enter(ticker)
        elif play["status"] == "awaiting_confirmation":
            self.io.push(f"⏳ {ticker} brief play triggered — confirm?",
                         f"{'Long' if play['direction'] == 'CALL' else 'Short'} through {play['trigger']:.2f}, "
                         f"score {play['score']:.0f}, gate ENTER. Paper. Expires in 3 min.",
                         {"type": "brief_confirm", "ticker": ticker}, "active")

    def _working_count(self, brief) -> int:
        return sum(1 for p in brief["plays"] if p["status"] == "working")

    def _expire_confirmations(self, brief, now):
        for p in brief["plays"]:
            if p["status"] == "awaiting_confirmation" and now >= datetime.fromisoformat(p["confirm_expires_at"]):
                self._set_status(p, "expired", "not confirmed within 3 min", now)

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
            result = self.io.execute_entry(play, lambda: self._last_price.get(ticker), on_update)
        except Exception as e:
            logger.error("[brief] entry failed for %s: %s", ticker, e, exc_info=True)
            result = {"state": "ERROR", "reason": str(e)}

        now = self.io.now()
        state = result.get("state")
        with self._lock:
            p = self._play(ticker)
            if state == "FILLED":
                p["trade_id"] = result.get("trade_id")
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
        self.io.push(title, p["status_reason"] or "", {"type": "brief_order", "ticker": ticker, "state": state}, level)

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

    def gate_decision(self, ticker: str, direction: str) -> "str | None":
        try:
            from services.entry_check_service import get_entry_check
            chk = get_entry_check(ticker, direction) or {}
            v = (chk.get("verdicts") or {}).get(direction) or chk.get("verdict") or {}
            return v.get("decision")
        except Exception as e:
            logger.warning("[brief] gate check failed for %s: %s", ticker, e)
            return None

    def brief_losses_today(self, today: date) -> int:
        rows = (self._sb().table("orb_trades").select("pnl, exit_time").eq("trade_type", "BRIEF")
                .eq("session_date", today.isoformat()).execute().data or [])
        return sum(1 for r in rows if r.get("exit_time") and (r.get("pnl") or 0) < 0)

    def open_brief_trades(self, today: date) -> int:
        rows = (self._sb().table("orb_trades").select("exit_time").eq("trade_type", "BRIEF")
                .eq("session_date", today.isoformat()).execute().data or [])
        return sum(1 for r in rows if not r.get("exit_time"))

    def orb_position_open(self, ticker: str) -> bool:
        from routes.strategy_routes import _engines
        t = ticker.upper()
        return any(getattr(e, "ticker", "").upper() == t and getattr(e, "trade_taken", False)
                   for e in _engines.values())

    def subscribe(self, ticker: str, cb) -> None:
        from services.utils.orb_data_hub import get_orb_data_hub
        get_orb_data_hub().subscribe_bar(ticker, cb)

    def execute_entry(self, play: dict, underlying_price, on_update) -> dict:
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

        result = run_limit_entry(engine.trading_client, pick["symbol"], qty, gate["limit"],
                                 play["trigger"], underlying_price, on_update=on_update)
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
