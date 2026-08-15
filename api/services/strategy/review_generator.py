"""
Daily trade review generator.

Queries Supabase for the day's orb_trades and orb_session records, builds
a structured prompt, and calls the Claude API to produce a full Markdown
performance review. Saves the result to the performance_reviews table so
the mobile app can display it.

Designed to be called from two places:
  1. routes/strategy_routes.py — /strategy/review/generate, hit by a single
     Supabase pg_cron job at 4:15 PM ET (automated)
  2. scripts/daily_review.py — manual or local-cron run, also writes to disk
"""

import os
import json
import logging
from datetime import date, datetime, timedelta

import pytz
import anthropic

from services.strategy.trade_logger import enrich_open_trades_with_live_pnl

logger = logging.getLogger(__name__)
ET = pytz.timezone("America/New_York")

_CLAUDE_MODEL = "claude-sonnet-4-6"
_MAX_TOKENS   = 4096

_SYSTEM_PROMPT_TEMPLATE = """
You are a trading performance analyst for ALETHIA, an automated ORB (Opening Range Breakout)
0DTE options strategy running on SPY, IWM, and QQQ.

This review covers the __ACCOUNT_LABEL__ account ONLY — __ACCOUNT_NOTE__. Do not speculate
about or reference the other account's activity; you have not been given it. Every dollar
figure in this review must reflect __ACCOUNT_LABEL_LOWER__ money only.

Analyse the provided daily trade data and generate a structured performance review in Markdown.
Be specific, data-driven, and directly actionable. Reference exact P&L figures, entry/exit
times, and profile-specific behaviour. Do not pad with generic commentary.

─── Strategy Context ────────────────────────────────────────────────────────
• ORB window: 9:30–9:45 AM ET. ORH = range high, ORL = range low.
• Breakout confirmed by OrbService after a 3-minute spot-price check.
• TREND_RIDER adds bar_close_confirm — entry only fires after a 1-min bar
  CLOSES above ORH (or below ORL), blocking fakeout/wick entries.
• All contracts are 0DTE calls or puts, expiring same day.

─── Profile Summary ─────────────────────────────────────────────────────────
TREND_RIDER  — 6 contracts, TP1 +15% / $0.30 floor, be_hold runner,
               bar_close_confirm=True, max_loss 30%, window 180 min.
REVERSAL     — 6 contracts, TP1 +15% / $0.18 floor, be_hold runner,
               cascade_ticks=5 (direction-aware), max_loss 25%.
               Enters the OPPOSITE contract after a failed breakout.
RETESTER     — 4 contracts, TP1 +20% / $0.20 floor, trail runner,
               entry_mode=RETEST (waits for ORH/ORL retest after breakout).
BULL_DOG     — 10 contracts, TP1 +20% / $0.35 floor, cascade runner.
THUNDER_CAT  — 6 contracts, TP1 +20% / $0.25 floor, cascade runner.
WOLF         — 3 contracts, TP1 +15% / $0.20 floor, cascade runner.
OTM_CONVICTION — 6 contracts, higher-confidence OTM play ($0.25-$0.40 contracts,
               strike offset $1-4, delta 0.10-0.35). TP1 +75% (close 33%),
               TP2 +200% (close 50% of remainder), be_hold runner, max_loss 55%,
               window 240 min.

─── Trade Entry Types ────────────────────────────────────────────────────────
Every trade is tagged STRATEGY or IMMEDIATE in the data below — treat them as
two different categories of decision, not one blended population:

STRATEGY  — Entered automatically by the ORB engine when a profile's signal
            fired (breakout, retest, cascade, etc. per the Profile Summary
            above). Judge these against their profile's designed behaviour:
            did the entry, sizing, and exit match what the profile specifies?

IMMEDIATE — Entered manually by the trader, on purpose, specifically because
            no automated strategy signal fired that session (or the trader
            chose to act ahead of / instead of one). This is a deliberate
            discretionary trade taken with the sole goal of making a profit —
            it is NOT a deviation, error, or something to flag as confusing
            just because it lacks a profile or breakout trigger. Never
            criticize an IMMEDIATE trade for "not waiting for a signal" —
            that was never the premise of the trade.

            Instead, judge each IMMEDIATE trade purely on the market context
            and outcome data provided: entry/exit timing, underlying price
            vs. ORH/ORL, VIX at entry, the intraday trend implied by the
            entry/exit prices, position size, exit discipline, and realized
            P&L. Give a direct verdict — good trade or bad trade — and
            explain why using that data, so the trader can learn what to
            repeat or avoid next time. Fair, data-grounded criticism is still
            welcome (e.g. "entered into a range-bound chop with no
            directional edge" or "sized too large relative to the day's
            realized move") — the critique must be grounded in what actually
            happened, never in the trade's failure to match a strategy
            profile it was never meant to follow.

─── Open Positions ──────────────────────────────────────────────────────────
Some trades in the data below may still be OPEN (no exit yet) — these are
swing/weekly holds that stay open across multiple days, not same-day 0DTE
positions. Each one appears in every day's review for as long as it remains
open, not only the day it was entered. For each open position you're given a
live, unrealized quote taken at generation time (live_price/live_pnl/
live_pnl_pct — NOT the same as the realized pnl/pnl_pct a closed trade has),
how many days it's been open, and days remaining to expiry. Give a direct,
actionable recommendation for each — see the Open Positions output section
below.

─── Exit Reason Glossary ────────────────────────────────────────────────────
HARD_STOP           Full stop before TP1. Worst outcome — full position loss.
BREAKEVEN_STOP      Runner hit entry price after TP1. Net positive or flat.
TP1                 Partial close (50%) at first target. SL moves to entry.
TP2                 Partial close at second target.
CASCADE_EXIT        N consecutive 1-min bars of underlying against position
                    triggered a partial runner close. Profile-specific N.
RUNNER_TRAIL_STOP   Trailing stop fired on final runner (trail-mode profiles).
EOD_CLOSE           Orderly close before 3:30 PM ET hard deadline.
EOD_HARD_CLOSE      Position still open at hard deadline — force-closed.

─── Output Format ───────────────────────────────────────────────────────────
Return ONLY the Markdown review. No preamble, no commentary outside the
document. Use this exact structure:

# Trade Review — {date} (__ACCOUNT_LABEL__)

**Net P&L:** ${net_pnl}
**Trades:** {n} total — {w} winners, {l} losers
**Branch / Code state:** [note any known pending fixes or recent changes]

---

## Session Scorecard

| # | Ticker | Type | Profile | Dir | Entry | Exit | Qty | P&L | Exit Reason | Duration |
|---|---|---|---|---|---|---|---|---|---|---|
[one row per trade — Type is STRATEGY or IMMEDIATE; for IMMEDIATE trades the
Profile column may read "—" since no profile signal drove the entry]

**Gross winners:** +${sum_winners}
**Gross losers:** -${sum_losers}
**Net:** **${net}**
**Win rate:** {w}/{n} ({pct}%)

---

## Market Context

[1–2 sentences per ticker that traded, describing the day's structure:
gap-and-reverse, trending breakout, range-bound, VIX conditions, etc.]

---

## Trade-by-Trade Breakdown

[For each trade, one tight paragraph, and open by naming its entry type:
 - STRATEGY trades: what happened, why the exit fired, whether the profile
   behaved as designed, and what it cost or earned.
 - IMMEDIATE trades: what happened, and a direct verdict — good or bad
   discretionary decision — grounded in entry timing, price-action context
   (ORH/ORL, underlying trend, VIX), and exit discipline. Do not comment on
   the absence of a strategy signal; that was the intended premise of the
   trade, not a gap to explain.]

---

## Open Positions

[If there are any entries under "### Open Positions" in the data below, one
paragraph per position: name it, state how long it's been open and its live
unrealized P&L, then give a direct, unambiguous recommendation — KEEP OPEN,
CLOSE NOW, or WATCH CLOSELY (with the specific thing to watch) — grounded
only in the data provided: unrealized P&L direction/magnitude, days held,
and days remaining to expiry (flag explicitly if expiry is close and the
position is still underwater or flat). Do not speculate about news or price
action you have not been given. If there are no open positions, write "No
open positions." and skip the rest of this section.]

---

## What Worked

[Bullet points — specific, not generic]

## What Didn't Work

[Bullet points — specific, not generic]

---

## Profile Assessment

[For each PROFILE that traded (STRATEGY trades only — IMMEDIATE trades have
no profile to assess): one paragraph assessing whether it behaved as
designed, any anomalies, and whether the profile config is appropriate. If
IMMEDIATE trades happened today, note that they're covered separately above
and in the recommendations below, not here.]

---

## Next Session Recommendations

[Numbered list, most impactful first. Each item must be specific and
actionable: a concrete parameter change, a behaviour to watch, or a
structural adjustment to the strategy. Separate STRATEGY-related items
(profile/parameter changes) from IMMEDIATE-trade items (discretionary
judgment patterns to repeat or avoid — entry timing habits, sizing
discipline, market conditions to favor or skip) and label each item
accordingly so the trader knows which kind of decision it applies to.]

__MODE_CLOSING_NOTE__
""".strip()

_LIVE_CLOSING_NOTE = """
─── Live Account Focus ────────────────────────────────────────────────────
This is real capital. Weight your recommendations toward capital preservation
and whether each strategy/profile that traded today has proven itself enough
to keep running live at its current size — call out explicitly if a profile's
live track record looks shaky enough that it should be moved back to paper
for further testing.
""".strip()

_PAPER_CLOSING_NOTE = """
─── Paper Account Focus ───────────────────────────────────────────────────
This is simulated capital used for testing. Weight your recommendations
toward whether each strategy/profile that traded today is behaving well
enough, over a large enough sample, to be promoted to the live account —
call out explicitly which profiles (if any) look ready, and what's still
missing (sample size, an unresolved failure mode, etc.) for the ones that
aren't.
""".strip()


class ReviewGenerator:
    def __init__(self, supabase_client):
        self._sb     = supabase_client
        self._claude = anthropic.Anthropic(
            api_key=os.environ.get("ANTHROPIC_API_KEY", "")
        )

    # ── Public API ─────────────────────────────────────────────────────────────

    def generate(self, session_date: date | None = None, paper_mode: bool = True) -> tuple[str, dict]:
        """
        Generate and return (markdown_content, metadata) for ONE account
        (paper XOR live) — reviews are fully decoupled per account so a
        live strategy's real track record is never blended with paper
        testing activity, in either the numbers or the AI narrative.

        metadata keys: net_pnl, trade_count, win_rate, winners, losers,
        open_positions (list — still-open trades from BEFORE today, each with
        a live_price/live_pnl/live_pnl_pct snapshot taken at generation time;
        embedded in meta rather than a new return value so existing callers
        that only look at content/net_pnl/etc. are unaffected).
        Raises on Claude API failure — caller decides whether to swallow.
        """
        session_date   = session_date or date.today()
        trades         = self._fetch_trades(session_date, paper_mode)
        open_positions = self._fetch_open_positions(session_date, paper_mode)
        sessions       = self._fetch_sessions(session_date)
        recent         = self._fetch_recent_pnl(session_date, paper_mode, days=5)

        meta     = self._compute_meta(trades)
        meta["open_positions"] = open_positions
        prompt   = self._build_prompt(trades, sessions, recent, session_date, meta, paper_mode, open_positions)
        content  = self._call_claude(prompt, paper_mode)
        return content, meta

    def save_to_supabase(
        self,
        review_date: date,
        content: str,
        trades: list,
        meta: dict,
        paper_mode: bool = True,
    ) -> bool:
        try:
            self._sb.table("performance_reviews").upsert({
                "review_date":    str(review_date),
                "paper_mode":     paper_mode,
                "net_pnl":        meta["net_pnl"],
                "trade_count":    meta["trade_count"],
                "win_rate":       meta["win_rate"],
                "winners":        meta["winners"],
                "losers":         meta["losers"],
                "markdown":       content,
                "trades_json":    trades,
                "open_positions_json": meta.get("open_positions", []),
                "created_at":     datetime.utcnow().isoformat(),
            }, on_conflict="review_date,paper_mode").execute()
            logger.info("[ReviewGenerator] Saved %s review for %s to Supabase",
                        "paper" if paper_mode else "live", review_date)
            return True
        except Exception as e:
            logger.error("[ReviewGenerator] Supabase save failed: %s", e)
            return False

    # ── Data fetching ──────────────────────────────────────────────────────────

    def _fetch_trades(self, session_date: date, paper_mode: bool = True) -> list:
        try:
            res = (
                self._sb.table("orb_trades")
                .select(
                    "ticker, profile, direction, contract_symbol, strike, "
                    "entry_premium, exit_premium, qty_entered, qty_exited, "
                    "pnl, pnl_pct, exit_reason, entry_time, exit_time, "
                    "underlying_price_entry, underlying_price_exit, "
                    "vix_at_entry, orh, orl, exit_stages, paper_mode, trade_type"
                )
                .eq("trade_date", str(session_date))
                .eq("paper_mode", paper_mode)
                .order("entry_time")
                .execute()
            )
            return res.data or []
        except Exception as e:
            logger.error("[ReviewGenerator] fetch_trades failed: %s", e)
            return []

    def _fetch_open_positions(self, session_date: date, paper_mode: bool = True) -> list:
        """
        Still-open trades entered on a PRIOR day (same-day opens already
        appear via _fetch_trades) — the swing/weekly holds that should keep
        surfacing in every day's review for as long as they stay open, not
        just their entry day. trade_date is pinned at entry and never
        updated, so this can't just re-run _fetch_trades with today's date;
        it has to query by exit_time IS NULL instead.
        """
        try:
            res = (
                self._sb.table("orb_trades")
                .select(
                    "ticker, profile, direction, contract_symbol, strike, expiry, "
                    "entry_premium, qty_entered, qty_exited, entry_time, trade_date, "
                    "underlying_price_entry, vix_at_entry, orh, orl, paper_mode, trade_type"
                )
                .is_("exit_time", "null")
                .eq("paper_mode", paper_mode)
                .lt("trade_date", str(session_date))
                .order("entry_time")
                .execute()
            )
            rows = res.data or []
            return enrich_open_trades_with_live_pnl(rows)
        except Exception as e:
            logger.warning("[ReviewGenerator] fetch_open_positions failed: %s", e)
            return []

    def _fetch_sessions(self, session_date: date) -> list:
        try:
            res = (
                self._sb.table("orb_session")
                .select("ticker, profile, orh, orl, trade_taken, skip_reason")
                .eq("session_date", str(session_date))
                .execute()
            )
            return res.data or []
        except Exception as e:
            logger.warning("[ReviewGenerator] fetch_sessions failed: %s", e)
            return []

    def _fetch_recent_pnl(self, session_date: date, paper_mode: bool = True, days: int = 5) -> list[dict]:
        """Return last N trading days' net P&L for rolling context — scoped to
        the same account as the review so the trend line isn't muddied by the
        other account's activity."""
        try:
            since = str(session_date - timedelta(days=days * 2))  # buffer for weekends
            res = (
                self._sb.table("orb_trades")
                .select("trade_date, pnl")
                .eq("paper_mode", paper_mode)
                .gte("trade_date", since)
                .lt("trade_date", str(session_date))
                .execute()
            )
            rows = res.data or []
            by_date: dict[str, float] = {}
            for r in rows:
                d = r.get("trade_date", "")
                by_date[d] = by_date.get(d, 0.0) + (r.get("pnl") or 0.0)
            sorted_dates = sorted(by_date.keys(), reverse=True)[:days]
            return [{"date": d, "net_pnl": round(by_date[d], 2)} for d in sorted_dates]
        except Exception as e:
            logger.warning("[ReviewGenerator] fetch_recent_pnl failed: %s", e)
            return []

    # ── Helpers ────────────────────────────────────────────────────────────────

    def _compute_meta(self, trades: list) -> dict:
        winners = [t for t in trades if (t.get("pnl") or 0) > 0]
        losers  = [t for t in trades if (t.get("pnl") or 0) < 0]
        net_pnl = sum(t.get("pnl") or 0 for t in trades)
        count   = len(trades)
        return {
            "net_pnl":     round(net_pnl, 2),
            "trade_count": count,
            "winners":     len(winners),
            "losers":      len(losers),
            "win_rate":    round(len(winners) / count * 100, 1) if count else 0.0,
        }

    @staticmethod
    def _fv(v, fmt=None, prefix="$", fallback="n/a"):
        """Format a nullable value safely."""
        if v is None:
            return fallback
        if fmt:
            return f"{prefix}{v:{fmt}}"
        return str(v)

    @staticmethod
    def _fmt_et_time(iso_str: str | None) -> str:
        """
        Convert a Supabase timestamptz (stored/returned as UTC, e.g.
        "2026-07-09T14:39:30.585771+00:00") to a 12-hour Eastern time for the
        review — e.g. "10:39 AM ET". Previously these were fed into the Claude
        prompt as raw UTC strings sliced to "HH:MM:SS" with no timezone
        conversion or 12-hour formatting, so the review displayed times both
        in the wrong timezone (UTC, ~4-5h ahead of ET) and in 24-hour format —
        left entirely to Claude to guess/convert on its own instead of being
        computed deterministically here.
        """
        if not iso_str:
            return "n/a"
        try:
            dt = datetime.fromisoformat(iso_str)
            if dt.tzinfo is None:
                dt = pytz.utc.localize(dt)
            return dt.astimezone(ET).strftime("%-I:%M %p ET")
        except (ValueError, TypeError):
            return iso_str

    def _fmt_trade(self, idx: int, t: dict) -> str:
        entry_t    = self._fmt_et_time(t.get("entry_time"))
        exit_t     = self._fmt_et_time(t.get("exit_time"))
        entry_p    = t.get("entry_premium") or 0.0
        exit_p     = t.get("exit_premium")
        pnl        = t.get("pnl") or 0.0
        pnl_pct    = t.get("pnl_pct") or 0.0
        stages     = t.get("exit_stages") or []
        stages_str = ""
        if stages:
            parts = []
            for s in stages:
                sp  = s.get("premium") or 0.0
                spnl = s.get("pnl") or 0.0
                parts.append(
                    f"  [{s.get('reason')} qty={s.get('qty')} "
                    f"@ ${sp:.2f} pnl={'+' if spnl >= 0 else ''}${spnl:.2f}]"
                )
            stages_str = "\n  Exit stages:\n" + "\n".join(parts)
        exit_str = f"${exit_p:.2f}" if exit_p is not None else "n/a"
        trade_type = t.get("trade_type") or "STRATEGY"
        entry_type_str = (
            "IMMEDIATE (manual discretionary entry — taken because no "
            "strategy signal fired; judge on market context and outcome, "
            "not on the absence of a signal)"
            if trade_type == "IMMEDIATE"
            else "STRATEGY (automated ORB breakout entry)"
        )
        profile_str = t.get("profile") or ("—" if trade_type == "IMMEDIATE" else "?")
        return (
            f"Trade {idx}: {t.get('ticker') or '?'} {profile_str} {t.get('direction') or '?'}\n"
            f"  Entry Type: {entry_type_str}\n"
            f"  Contract: {t.get('contract_symbol') or '?'}  Strike: ${t.get('strike') or '?'}\n"
            f"  Entry: ${entry_p:.2f} × {t.get('qty_entered') or 0} @ {entry_t}\n"
            f"  Underlying at entry: {self._fv(t.get('underlying_price_entry'))}\n"
            f"  ORH: {self._fv(t.get('orh'))}  ORL: {self._fv(t.get('orl'))}\n"
            f"  Exit: {exit_str} × {t.get('qty_exited') or 0} @ {exit_t}\n"
            f"  Underlying at exit: {self._fv(t.get('underlying_price_exit'))}\n"
            f"  VIX at entry: {t.get('vix_at_entry') or 'n/a'}\n"
            f"  Exit reason: {t.get('exit_reason') or '?'}  "
            f"P&L: {'+' if pnl >= 0 else ''}${pnl:.2f} ({pnl_pct:.1f}%)"
            + stages_str
        )

    def _fmt_open_position(self, idx: int, t: dict, session_date: date) -> str:
        entry_t     = self._fmt_et_time(t.get("entry_time"))
        entry_p     = t.get("entry_premium") or 0.0
        qty_open    = (t.get("qty_entered") or 0) - (t.get("qty_exited") or 0)
        trade_type  = t.get("trade_type") or "STRATEGY"
        profile_str = t.get("profile") or ("—" if trade_type == "IMMEDIATE" else "?")

        days_open = "n/a"
        try:
            entry_date = datetime.strptime(t["trade_date"], "%Y-%m-%d").date()
            days_open  = (session_date - entry_date).days
        except (ValueError, TypeError, KeyError):
            pass

        dte_str = "n/a"
        expiry = t.get("expiry")
        if expiry:
            try:
                dte = (datetime.strptime(expiry, "%Y-%m-%d").date() - session_date).days
                dte_str = f"{dte}d" if dte >= 0 else "EXPIRED"
            except ValueError:
                pass

        live_price = t.get("live_price")
        if live_price is not None:
            live_pnl     = t.get("live_pnl") or 0.0
            live_pnl_pct = t.get("live_pnl_pct") or 0.0
            live_str = (
                f"${live_price:.2f}  Unrealized P&L: "
                f"{'+' if live_pnl >= 0 else ''}${live_pnl:.2f} ({live_pnl_pct:+.1f}%)"
            )
        else:
            live_str = "quote unavailable at generation time"

        return (
            f"Open Position {idx}: {t.get('ticker') or '?'} {profile_str} "
            f"{t.get('direction') or '?'} ({trade_type})\n"
            f"  Contract: {t.get('contract_symbol') or '?'}  Strike: ${t.get('strike') or '?'}  "
            f"Expiry: {expiry or '?'} ({dte_str} to expiry)\n"
            f"  Entered: ${entry_p:.2f} × {qty_open} remaining, on {t.get('trade_date')} "
            f"@ {entry_t} ({days_open}d ago)\n"
            f"  Underlying at entry: {self._fv(t.get('underlying_price_entry'))}\n"
            f"  Current option price: {live_str}"
        )

    def _build_prompt(
        self,
        trades: list,
        sessions: list,
        recent: list,
        session_date: date,
        meta: dict,
        paper_mode: bool = True,
        open_positions: list | None = None,
    ) -> str:
        account_label = "PAPER" if paper_mode else "LIVE"
        lines = [
            f"## Daily Trade Data — {session_date.strftime('%B %d, %Y')} — {account_label} account",
            "",
            f"Net P&L: ${meta['net_pnl']:+.2f}  |  "
            f"Trades: {meta['trade_count']}  |  "
            f"Winners: {meta['winners']}  |  "
            f"Losers: {meta['losers']}  |  "
            f"Win rate: {meta['win_rate']}%",
            "",
        ]

        if recent:
            lines.append("### Rolling P&L (last 5 sessions)")
            for r in recent:
                sign = "+" if r["net_pnl"] >= 0 else ""
                lines.append(f"  {r['date']}: {sign}${r['net_pnl']:.2f}")
            lines.append("")

        if sessions:
            lines.append("### Session Overview (ORB levels per ticker)")
            for s in sessions:
                skip = f"  SKIPPED: {s.get('skip_reason')}" if s.get("skip_reason") else ""
                lines.append(
                    f"  {s.get('ticker')} [{s.get('profile')}]  "
                    f"ORH=${s.get('orh')}  ORL=${s.get('orl')}  "
                    f"Trade taken: {s.get('trade_taken')}{skip}"
                )
            lines.append("")

        if trades:
            lines.append("### Trades")
            for i, t in enumerate(trades):
                lines.append(self._fmt_trade(i, t))
                lines.append("")
        else:
            lines.append("### Trades")
            lines.append("No trades taken today.")
            lines.append("")

        if open_positions:
            lines.append("### Open Positions (still open — not yet closed)")
            for i, p in enumerate(open_positions):
                lines.append(self._fmt_open_position(i, p, session_date))
                lines.append("")

        lines.append(
            "Please generate the full Markdown performance review following the "
            "structure in your system prompt."
        )
        return "\n".join(lines)

    @staticmethod
    def build_system_prompt(paper_mode: bool = True) -> str:
        """The account-scoped system prompt actually sent to Claude — a public
        static method so callers/tests/scripts can inspect exactly what each
        review's system prompt looks like without generating one."""
        if paper_mode:
            label, note, closing = "PAPER", "simulated capital used to test strategies before they go live", _PAPER_CLOSING_NOTE
        else:
            label, note, closing = "LIVE", "real capital — every dollar figure here is real money", _LIVE_CLOSING_NOTE
        return (
            _SYSTEM_PROMPT_TEMPLATE
            .replace("__ACCOUNT_LABEL_LOWER__", label.lower())
            .replace("__ACCOUNT_LABEL__", label)
            .replace("__ACCOUNT_NOTE__", note)
            .replace("__MODE_CLOSING_NOTE__", closing)
        )

    def _call_claude(self, prompt: str, paper_mode: bool = True) -> str:
        response = self._claude.messages.create(
            model=_CLAUDE_MODEL,
            max_tokens=_MAX_TOKENS,
            system=self.build_system_prompt(paper_mode),
            messages=[{"role": "user", "content": prompt}],
        )
        return response.content[0].text
