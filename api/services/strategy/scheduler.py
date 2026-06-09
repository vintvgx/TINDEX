"""
APScheduler-based daily job manager.

Trade days come from the engine config — frontend controls which days
are active. When config changes, reschedule_jobs() rebuilds the cron jobs.

ORB calc fires at 9:30 + orb_minutes + 1 minute so that all bars in the
opening range window are complete before the engine fetches them.
"""

import logging
import threading
from datetime import datetime
import pytz

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
    config update so that trade_days / orb_minutes changes take effect immediately.
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

    # Fire ORB calc one minute after the last bar in the window is complete.
    # orb_minutes=5  → bars 9:30-9:34, fetch at 9:36
    # orb_minutes=10 → bars 9:30-9:39, fetch at 9:41
    # orb_minutes=15 → bars 9:30-9:44, fetch at 9:46
    orb_minutes     = engine.config.get("orb_minutes", 10)
    orb_fire_minute = 30 + orb_minutes + 1          # always within hour 9 for ≤28 min windows
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
        try:
            engine.trading_client.close_position(engine.contract_symbol)

            qty_closed = engine.exit_manager.qty_remaining if engine.exit_manager else 0
            engine.logger.log_exit(
                engine.contract_symbol, "EOD_HARD_CLOSE",
                None,
                qty_closed,
                engine.profile_key,
                strategy_id=engine.strategy_id,
            )
            engine.notifier.notify_exit(
                ticker=engine.ticker,
                contract_symbol=engine.contract_symbol,
                exit_reason="EOD_CLOSE",
                pnl=0.0,      # exact P&L not available here; trade log will have it
                qty=qty_closed,
                profile_key=engine.profile_key,
            )
        except Exception as ex:
            logger.error("[Scheduler] EOD close failed: %s", ex)
    engine.reset_session()


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
        orb_minutes     = engine.config.get("orb_minutes", 10)
        orb_fire_min    = 30 + orb_minutes + 1
        orb_fire_hour   = 9 + orb_fire_min // 60
        orb_fire_min    = orb_fire_min % 60
        orb_calc_dt     = now_et.replace(hour=orb_fire_hour, minute=orb_fire_min,
                                         second=0, microsecond=0)
        eod_dt          = now_et.replace(hour=15, minute=30, second=0, microsecond=0)
        if orb_calc_dt <= now_et <= eod_dt:
            logger.info("[Scheduler] Late start — triggering calculate_orb now for %s", engine.ticker)
            threading.Thread(target=engine.calculate_orb, daemon=True).start()

    return sched
