"""
Daily trade review generator.

Queries Supabase for the day's orb_trades and orb_session records, builds
a structured prompt, and calls the Claude API to produce a full Markdown
performance review. Saves the result to the performance_reviews table so
the mobile app can display it.

Designed to be called from two places:
  1. scheduler.py — _run_daily_review() at 4:15 PM ET (automated)
  2. scripts/daily_review.py — manual or local-cron run, also writes to disk
"""

import os
import json
import logging
from datetime import date, datetime, timedelta

import pytz
import anthropic

logger = logging.getLogger(__name__)
ET = pytz.timezone("America/New_York")

_CLAUDE_MODEL = "claude-sonnet-4-6"
_MAX_TOKENS   = 4096

_SYSTEM_PROMPT = """
You are a trading performance analyst for ALETHIA, an automated ORB (Opening Range Breakout)
0DTE options strategy running on SPY, IWM, and QQQ.

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

# Trade Review — {date}

**Net P&L:** ${net_pnl}
**Trades:** {n} total — {w} winners, {l} losers
**Branch / Code state:** [note any known pending fixes or recent changes]

---

## Session Scorecard

| # | Ticker | Profile | Dir | Entry | Exit | Qty | P&L | Exit Reason | Duration |
|---|---|---|---|---|---|---|---|---|---|
[one row per trade]

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

[For each trade: one tight paragraph. What happened, why the exit fired,
whether the profile behaved as designed, and what it cost or earned.]

---

## What Worked

[Bullet points — specific, not generic]

## What Didn't Work

[Bullet points — specific, not generic]

---

## Profile Assessment

[For each profile that traded: one paragraph assessing whether it behaved
as designed, any anomalies, and whether the profile config is appropriate.]

---

## Next Session Recommendations

[Numbered list, most impactful first. Each item must be specific and
actionable: a concrete parameter change, a behaviour to watch, or a
structural adjustment to the strategy.]
""".strip()


class ReviewGenerator:
    def __init__(self, supabase_client):
        self._sb     = supabase_client
        self._claude = anthropic.Anthropic(
            api_key=os.environ.get("ANTHROPIC_API_KEY", "")
        )

    # ── Public API ─────────────────────────────────────────────────────────────

    def generate(self, session_date: date | None = None) -> tuple[str, dict]:
        """
        Generate and return (markdown_content, metadata).
        metadata keys: net_pnl, trade_count, win_rate, winners, losers.
        Raises on Claude API failure — caller decides whether to swallow.
        """
        session_date = session_date or date.today()
        trades   = self._fetch_trades(session_date)
        sessions = self._fetch_sessions(session_date)
        recent   = self._fetch_recent_pnl(session_date, days=5)

        meta     = self._compute_meta(trades)
        prompt   = self._build_prompt(trades, sessions, recent, session_date, meta)
        content  = self._call_claude(prompt)
        return content, meta

    def save_to_supabase(
        self,
        review_date: date,
        content: str,
        trades: list,
        meta: dict,
    ) -> bool:
        try:
            self._sb.table("performance_reviews").upsert({
                "review_date":    str(review_date),
                "net_pnl":        meta["net_pnl"],
                "trade_count":    meta["trade_count"],
                "win_rate":       meta["win_rate"],
                "winners":        meta["winners"],
                "losers":         meta["losers"],
                "markdown":       content,
                "trades_json":    trades,
                "created_at":     datetime.utcnow().isoformat(),
            }, on_conflict="review_date").execute()
            logger.info("[ReviewGenerator] Saved review for %s to Supabase", review_date)
            return True
        except Exception as e:
            logger.error("[ReviewGenerator] Supabase save failed: %s", e)
            return False

    # ── Data fetching ──────────────────────────────────────────────────────────

    def _fetch_trades(self, session_date: date) -> list:
        try:
            res = (
                self._sb.table("orb_trades")
                .select(
                    "ticker, profile, direction, contract_symbol, strike, "
                    "entry_premium, exit_premium, qty_entered, qty_exited, "
                    "pnl, pnl_pct, exit_reason, entry_time, exit_time, "
                    "underlying_price_entry, underlying_price_exit, "
                    "vix_at_entry, orh, orl, exit_stages, paper_mode"
                )
                .eq("trade_date", str(session_date))
                .order("entry_time")
                .execute()
            )
            return res.data or []
        except Exception as e:
            logger.error("[ReviewGenerator] fetch_trades failed: %s", e)
            return []

    def _fetch_sessions(self, session_date: date) -> list:
        try:
            res = (
                self._sb.table("orb_session")
                .select("ticker, profile_key, orh, orl, trade_taken, skip_reason")
                .eq("session_date", str(session_date))
                .execute()
            )
            return res.data or []
        except Exception as e:
            logger.warning("[ReviewGenerator] fetch_sessions failed: %s", e)
            return []

    def _fetch_recent_pnl(self, session_date: date, days: int = 5) -> list[dict]:
        """Return last N trading days' net P&L for rolling context."""
        try:
            since = str(session_date - timedelta(days=days * 2))  # buffer for weekends
            res = (
                self._sb.table("orb_trades")
                .select("trade_date, pnl")
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

    def _fmt_trade(self, idx: int, t: dict) -> str:
        entry_t    = (t.get("entry_time") or "")[:19].replace("T", " ")
        exit_t     = (t.get("exit_time")  or "")[:19].replace("T", " ")
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
        return (
            f"Trade {idx}: {t.get('ticker') or '?'} {t.get('profile') or '?'} {t.get('direction') or '?'}\n"
            f"  Contract: {t.get('contract_symbol') or '?'}  Strike: ${t.get('strike') or '?'}\n"
            f"  Entry: ${entry_p:.2f} × {t.get('qty_entered') or 0} @ {entry_t}\n"
            f"  Underlying at entry: {self._fv(t.get('underlying_price_entry'))}\n"
            f"  ORH: {self._fv(t.get('orh'))}  ORL: {self._fv(t.get('orl'))}\n"
            f"  Exit: {exit_str} × {t.get('qty_exited') or 0} @ {exit_t}\n"
            f"  Underlying at exit: {self._fv(t.get('underlying_price_exit'))}\n"
            f"  VIX at entry: {t.get('vix_at_entry') or 'n/a'}\n"
            f"  Exit reason: {t.get('exit_reason') or '?'}  "
            f"P&L: {'+' if pnl >= 0 else ''}${pnl:.2f} ({pnl_pct:.1f}%)\n"
            f"  Paper mode: {t.get('paper_mode')}"
            + stages_str
        )

    def _build_prompt(
        self,
        trades: list,
        sessions: list,
        recent: list,
        session_date: date,
        meta: dict,
    ) -> str:
        lines = [
            f"## Daily Trade Data — {session_date.strftime('%B %d, %Y')}",
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
                    f"  {s.get('ticker')} [{s.get('profile_key')}]  "
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

        lines.append(
            "Please generate the full Markdown performance review following the "
            "structure in your system prompt."
        )
        return "\n".join(lines)

    def _call_claude(self, prompt: str) -> str:
        response = self._claude.messages.create(
            model=_CLAUDE_MODEL,
            max_tokens=_MAX_TOKENS,
            system=_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        )
        return response.content[0].text
