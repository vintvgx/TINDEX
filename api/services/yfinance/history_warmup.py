"""
Chart-history warm-up (polling audit B4).

The history cache is in-process, so every deploy/restart empties it and the
first chart opens afterwards wait on Yahoo. This pre-loads the charts the
app is most likely to open — followed tickers plus the index ETFs, at the
chart's default 1D view — once shortly after boot and every weekday at
9:20 ET. Nights and weekends are skipped (no unnecessary calls).
"""
import threading
from datetime import datetime

import pytz

from log.logging_config import get_logger

logger = get_logger(__name__)
ET = pytz.timezone("America/New_York")

INDEX_TICKERS = ["SPY", "QQQ", "IWM"]
MAX_TICKERS = 25
BOOT_DELAY_S = 90


def _followed_tickers() -> list:
    try:
        from services.supabase.supabase_service import get_supabase_service
        rows = (get_supabase_service().client.table("user_stock_follows")
                .select("ticker").limit(200).execute().data or [])
        return [str(r["ticker"]).upper() for r in rows if r.get("ticker")]
    except Exception as e:
        logger.warning(f"[HistoryWarmup] couldn't load follows: {e}")
        return []


def warmup_tickers() -> list:
    out, seen = [], set()
    for t in INDEX_TICKERS + _followed_tickers():
        if t not in seen:
            seen.add(t)
            out.append(t)
    return out[:MAX_TICKERS]


def run_history_warmup() -> None:
    from services.yfinance.yfinance_service import warm_history
    tickers = warmup_tickers()
    n = warm_history(tickers)
    logger.info(f"[HistoryWarmup] warmed {n} chart(s) for {len(tickers)} ticker(s)")


def _is_trading_day_window(now: datetime | None = None) -> bool:
    """Weekday, 7:00–20:00 ET — when someone might actually open a chart."""
    now = (now or datetime.now(ET)).astimezone(ET)
    return now.weekday() < 5 and 7 <= now.hour < 20


def schedule_history_warmup() -> None:
    """Call once at boot: a delayed one-shot (if it's a trading-day window)
    plus a weekday 9:20 ET job."""
    if _is_trading_day_window():
        t = threading.Timer(BOOT_DELAY_S, run_history_warmup)
        t.daemon = True
        t.start()
    from services.strategy.scheduler import get_scheduler
    sched = get_scheduler()
    if not sched:
        logger.warning("[HistoryWarmup] APScheduler not available — 9:20 warm-up not scheduled")
        return
    from apscheduler.triggers.cron import CronTrigger
    if not sched.running:
        sched.start()
    sched.add_job(
        run_history_warmup,
        CronTrigger(day_of_week="mon-fri", hour=9, minute=20, timezone=ET),
        id="job_history_warmup", replace_existing=True,
    )
    logger.info("[HistoryWarmup] scheduled (boot +%ss if trading window, weekdays 9:20 ET)", BOOT_DELAY_S)
