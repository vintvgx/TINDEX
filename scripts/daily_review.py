#!/usr/bin/env python3
"""
Local daily review script.

Pulls trade data from Supabase, generates a Claude-powered Markdown review,
and writes it to docs/performance/review/trade-review-YYYY-MM-DD.md.

Usage:
    python scripts/daily_review.py                  # today's review
    python scripts/daily_review.py --date 2026-06-24  # specific date

Requires environment variables (copy from .env or set in shell):
    SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY
    ANTHROPIC_API_KEY

Run daily via launchd (Mac) or cron — schedule for 4:30 PM ET on weekdays.
"""

import os
import sys
import argparse
import logging
from datetime import date, datetime
from pathlib import Path

# ── Path setup: allow imports from api/ ───────────────────────────────────────
REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "api"))

from supabase import create_client                           # noqa: E402
from services.strategy.review_generator import ReviewGenerator  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
logger = logging.getLogger(__name__)

REVIEW_DIR = REPO_ROOT / "docs" / "performance" / "review"


def _parse_date(date_str: str) -> date:
    return datetime.strptime(date_str, "%Y-%m-%d").date()


def _is_market_day(d: date) -> bool:
    return d.weekday() < 5  # Mon–Fri; US holiday check omitted for simplicity


def main():
    parser = argparse.ArgumentParser(description="Generate daily ORB trade review")
    parser.add_argument("--date", help="Session date YYYY-MM-DD (default: today)")
    parser.add_argument("--no-supabase-save", action="store_true",
                        help="Skip saving to Supabase (write file only)")
    args = parser.parse_args()

    session_date = _parse_date(args.date) if args.date else date.today()

    if not _is_market_day(session_date):
        logger.info("%s is not a market day — skipping", session_date)
        sys.exit(0)

    # ── Supabase client ───────────────────────────────────────────────────────
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        logger.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")
        sys.exit(1)
    if not os.environ.get("ANTHROPIC_API_KEY"):
        logger.error("ANTHROPIC_API_KEY must be set")
        sys.exit(1)

    sb = create_client(url, key)

    # ── Generate review ───────────────────────────────────────────────────────
    logger.info("Generating review for %s …", session_date)
    gen = ReviewGenerator(sb)
    content, meta = gen.generate(session_date)

    logger.info(
        "Review generated — %d trades, net P&L $%.2f, win rate %.1f%%",
        meta["trade_count"], meta["net_pnl"], meta["win_rate"],
    )

    # ── Write to disk ─────────────────────────────────────────────────────────
    REVIEW_DIR.mkdir(parents=True, exist_ok=True)
    filename = REVIEW_DIR / f"trade-review-{session_date}.md"
    filename.write_text(content, encoding="utf-8")
    logger.info("Written → %s", filename)

    # ── Save to Supabase ──────────────────────────────────────────────────────
    if not args.no_supabase_save:
        trades = gen._fetch_trades(session_date)
        gen.save_to_supabase(session_date, content, trades, meta)


if __name__ == "__main__":
    main()
