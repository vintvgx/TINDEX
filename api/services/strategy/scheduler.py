"""
APScheduler-based daily job manager.

Trade days come from the engine config — frontend controls which days
are active. When config changes, reschedule_jobs() rebuilds the cron jobs.
"""

import logging
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


def reschedule_jobs(engine):
    sched = get_scheduler()
    if not sched:
        logger.warning("[Scheduler] APScheduler not available — scheduling disabled")
        return

    for job_id in ["job_orb_calc", "job_price_poll", "job_eod_reset"]:
        try:
            sched.remove_job(job_id)
        except Exception:
            pass

    days_cron = _days_to_cron(list(engine.trade_days))
    if not days_cron:
        logger.info("[Scheduler] No trade days configured — no jobs scheduled")
        return

    logger.info("[Scheduler] Scheduling jobs for: %s", days_cron)

    sched.add_job(
        lambda: (engine.reset_session(), engine.calculate_orb()),
        CronTrigger(day_of_week=days_cron, hour=9, minute=35, timezone=ET),
        id="job_orb_calc", replace_existing=True,
    )

    sched.add_job(
        lambda: _poll(engine),
        CronTrigger(day_of_week=days_cron, hour="9-15", minute="*/1", timezone=ET),
        id="job_price_poll", replace_existing=True,
    )

    sched.add_job(
        lambda: _eod_reset(engine),
        CronTrigger(day_of_week=days_cron, hour=15, minute=30, timezone=ET),
        id="job_eod_reset", replace_existing=True,
    )


def _poll(engine):
    if not engine.orh:
        return
    price_data = engine.get_latest_price()
    if price_data:
        engine.on_price_tick(
            current_price=price_data["underlying"],
            current_volume=price_data.get("volume"),
        )


def _eod_reset(engine):
    if engine.trade_taken and engine.contract_symbol:
        try:
            engine.trading_client.close_position(engine.contract_symbol)
            engine.logger.log_exit(
                engine.contract_symbol, "EOD_HARD_CLOSE",
                None,
                engine.exit_manager.qty_remaining if engine.exit_manager else 0,
                engine.profile_key,
            )
        except Exception as ex:
            logger.error("[Scheduler] EOD close failed: %s", ex)
    engine.reset_session()


def init_scheduler(engine):
    sched = get_scheduler()
    if not sched:
        logger.warning("[Scheduler] APScheduler not installed — manual start only")
        return None
    if not sched.running:
        sched.start()
    reschedule_jobs(engine)
    logger.info("[Scheduler] Started with engine profile=%s", engine.profile_key)
    return sched
