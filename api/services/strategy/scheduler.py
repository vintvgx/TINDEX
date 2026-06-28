"""
APScheduler-based daily job manager.

Trade days come from the engine config — frontend controls which days
are active. When config changes, reschedule_jobs() rebuilds the cron jobs.

ORB calc fires at 9:46 (9:30 + 15-minute window + 1 minute) so that all bars in
the fixed 09:30–09:45 opening-range window are complete before the engine fetches
them. The window is fixed to stay consistent with OrbService.
"""

import logging
import threading
from datetime import datetime
import pytz

from services.strategy.orb_engine import ORB_WINDOW_MINUTES

try:
    from apscheduler.schedulers.background import BackgroundScheduler
    from apscheduler.triggers.cron import CronTrigger
    HAS_APSCHEDULER = True
except ImportError:
    HAS_APSCHEDULER = False

logger = logging.getLogger(__name__)
ET = pytz.timezone("America/New_York")

DAY_MAP = {0: "mon", 1: "tue", 2: "wed", 3: "thu", 4: "fri"}

_scheduler = None


def get_scheduler():
    global _scheduler
    if HAS_APSCHEDULER and _scheduler is None:
        _scheduler = BackgroundScheduler(timezone=ET)
    return _scheduler


def _days_to_cron(trade_days: list) -> str:
    return ",".join(DAY_MAP[d] for d in sorted(trade_days) if d in DAY_MAP)


def reschedule_jobs(engine, strategy_id: str = None):
    """
    Remove existing cron jobs and rebuild them from the engine's current config.
    strategy_id is used as a prefix so multiple engines don't clash on job IDs.

    NOTE: Called by init_scheduler on startup and by strategy_routes after a
    config update so that trade_days changes take effect immediately.
    """
    sched = get_scheduler()
    if not sched:
        logger.warning("[Scheduler] APScheduler not available — scheduling disabled")
        return

    sid = strategy_id or getattr(engine, "strategy_id", None) or "default"

    for suffix in ("orb_calc", "price_poll", "eod_reset"):
        try:
            sched.remove_job(f"job_{sid}_{suffix}")
        except Exception:
            pass
    # NOTE: "price_poll" is retained in the removal list above to clean up any
    # legacy job from before the hub migration; it is no longer (re)created.

    days_cron = _days_to_cron(list(engine.trade_days))
    if not days_cron:
        logger.info("[Scheduler] No trade days configured — no jobs scheduled")
        return

    # Fire ORB calc one minute after the last bar in the fixed 09:30–09:45 window
    # is complete: bars 9:30-9:44, fetch at 9:46.
    orb_fire_minute = 30 + ORB_WINDOW_MINUTES + 1   # always within hour 9
    orb_fire_hour   = 9 + orb_fire_minute // 60
    orb_fire_minute = orb_fire_minute % 60

    logger.info("[Scheduler] Scheduling jobs — sid=%s days=%s orb_calc=%d:%02d",
                sid, days_cron, orb_fire_hour, orb_fire_minute)

    sched.add_job(
        lambda: (engine.reset_session(), engine.calculate_orb()),
        CronTrigger(day_of_week=days_cron, hour=orb_fire_hour,
                    minute=orb_fire_minute, timezone=ET),
        id=f"job_{sid}_orb_calc", replace_existing=True,
    )

    # Per-minute price polling is gone: underlying bars are pushed from OrbService
    # via the hub (engine.on_bar → on_price_tick). No price_poll job is scheduled.

    sched.add_job(
        lambda: _eod_reset(engine),
        CronTrigger(day_of_week=days_cron, hour=15, minute=30, timezone=ET),
        id=f"job_{sid}_eod_reset", replace_existing=True,
    )


def _eod_reset(engine):
    """
    Hard-close any open position at end of day, log the forced exit, send
    a push notification, then reset session state for the next trading day.

    NOTE: Fires at 15:30 ET on trade days (after all per-ticker EOD closes).
    """
    if engine.trade_taken and engine.contract_symbol:
        contract_symbol = engine.contract_symbol
        qty_closed = engine.exit_manager.qty_remaining if engine.exit_manager else 0

        # Close the Alpaca position first; 0DTE options often expire worthless at
        # market close, so close_position may throw "position not found" — that's
        # expected and must NOT prevent the exit from being logged.
        try:
            engine.trading_client.close_position(contract_symbol)
        except Exception as ex:
            logger.warning("[Scheduler] EOD close_position failed (likely expired): %s", ex)

        # Always log and notify — even if close_position above threw.
        try:
            engine.logger.log_exit(
                contract_symbol, "EOD_HARD_CLOSE",
                None,
                qty_closed,
                engine.profile_key,
                strategy_id=engine.strategy_id,
            )
            engine.notifier.notify_exit(
                ticker=engine.ticker,
                contract_symbol=contract_symbol,
                exit_reason="EOD_CLOSE",
                pnl=0.0,
                qty=qty_closed,
                profile_key=engine.profile_key,
            )
        except Exception as ex:
            logger.error("[Scheduler] EOD log/notify failed: %s", ex)
    elif engine.orh and not engine.session_skipped:
        # Session was armed and watched all day but no breakout fired — notify user.
        engine.notifier.notify_no_trade_eod(
            ticker=engine.ticker,
            profile_key=engine.profile_key,
            orh=engine.orh,
            orl=engine.orl,
        )
    engine.reset_session()


def schedule_eod_close(engine):
    """
    Schedule ONLY a 15:30 ET hard-close (mon–fri) for an engine that has no ORB
    trade-day schedule — e.g. an immediate-trade engine. Ensures any open 0DTE
    position is flattened at end of day even though the engine never auto-trades.
    """
    sched = get_scheduler()
    if not sched:
        logger.warning("[Scheduler] APScheduler not available — EOD close not scheduled")
        return
    if not sched.running:
        sched.start()
    sid = getattr(engine, "strategy_id", None) or "immediate"
    job_id = f"job_{sid}_eod_reset"
    sched.add_job(
        lambda: _eod_reset(engine),
        CronTrigger(day_of_week="mon-fri", hour=15, minute=30, timezone=ET),
        id=job_id, replace_existing=True,
    )
    logger.info("[Scheduler] EOD-only hard-close scheduled for %s (%s)", sid, engine.ticker)


def schedule_daily_review(supabase_client):
    """
    Register a single 4:15 PM ET mon–fri job that generates the daily trade
    review and saves it to Supabase. Safe to call multiple times — the job ID
    is fixed so it is replaced, never duplicated.

    Call once at app startup after the Supabase client is ready:
        from services.strategy.scheduler import schedule_daily_review
        schedule_daily_review(sb_client)
    """
    sched = get_scheduler()
    if not sched:
        logger.warning("[Scheduler] APScheduler not available — daily review not scheduled")
        return
    if not sched.running:
        sched.start()

    sched.add_job(
        lambda: _run_daily_review(supabase_client),
        CronTrigger(day_of_week="mon-fri", hour=16, minute=15, timezone=ET),
        id="job_daily_review",
        replace_existing=True,
    )
    logger.info("[Scheduler] Daily review job scheduled at 4:15 PM ET mon–fri")


def _run_daily_review(supabase_client):
    """
    EOD review job: query today's trades, call Claude, save to Supabase.
    Errors are caught and logged so they never surface as unhandled exceptions
    in the scheduler thread.
    """
    from services.strategy.review_generator import ReviewGenerator
    from datetime import date as _date
    try:
        gen      = ReviewGenerator(supabase_client)
        today    = _date.today()
        content, meta = gen.generate(today)
        trades   = gen._fetch_trades(today)
        gen.save_to_supabase(today, content, trades, meta)
        logger.info(
            "[Scheduler] Daily review complete — %d trades, net P&L $%.2f",
            meta["trade_count"], meta["net_pnl"],
        )
    except Exception as e:
        logger.error("[Scheduler] Daily review job failed: %s", e)


def init_scheduler(engine):
    """Start the BackgroundScheduler and register jobs for the current engine config."""
    sched = get_scheduler()
    if not sched:
        logger.warning("[Scheduler] APScheduler not installed — manual start only")
        return None
    if not sched.running:
        sched.start()
    reschedule_jobs(engine)
    logger.info("[Scheduler] Started with engine profile=%s", engine.profile_key)

    # Late-start recovery: if the server started after the orb_calc cron fired today,
    # the job won't fire again until tomorrow. Trigger calculate_orb immediately so the
    # engine can still trade the remainder of the session.
    now_et = datetime.now(ET)
    if now_et.weekday() in engine.trade_days and not engine.orh and not engine.session_skipped:
        orb_fire_min    = 30 + ORB_WINDOW_MINUTES + 1
        orb_fire_hour   = 9 + orb_fire_min // 60
        orb_fire_min    = orb_fire_min % 60
        orb_calc_dt     = now_et.replace(hour=orb_fire_hour, minute=orb_fire_min,
                                         second=0, microsecond=0)
        eod_dt          = now_et.replace(hour=15, minute=30, second=0, microsecond=0)
        if orb_calc_dt <= now_et <= eod_dt:
            logger.info("[Scheduler] Late start — triggering calculate_orb now for %s", engine.ticker)
            threading.Thread(target=engine.calculate_orb, daemon=True).start()

    return sched
