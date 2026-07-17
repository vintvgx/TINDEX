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
    if not sched.running:
        sched.start()

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
        # NO_STOP_LOSS positions opt out of every automatic exit, including this
        # hard backstop — see profiles.py's disable_eod_close. Skip entirely
        # rather than closing; ExitManager.evaluate() already skips its own
        # EOD_CLOSE branch for the same flag, so this cron must agree or the
        # position gets force-closed here anyway despite the profile's promise.
        if engine.exit_manager and engine.exit_manager.profile.get("disable_eod_close"):
            logger.info("[Scheduler] EOD close skipped for %s — NO_STOP_LOSS position held open",
                        getattr(engine, "strategy_id", None) or engine.ticker)
            return

        # This job only exists to flatten a 0DTE contract before it expires
        # worthless at market close — it must NOT force-close a swing/LEAPS
        # position that has weeks/months of runway left just because this
        # cron fires every trading day at 15:30 ET. Saved-strategy (auto)
        # engines only ever enter same-day 0DTE contracts, so this check is a
        # no-op for them; it only changes behavior for immediate-trade
        # engines, which schedule_eod_close's docstring already assumed were
        # always 0DTE — no longer true now that immediate trades can target
        # any expiration. See the 2026-07-17 incident where this forced an
        # IBM Aug 21 and NFLX Sep 18 swing position closed same-day.
        try:
            _, expiry_str = engine._parse_occ_symbol(engine.contract_symbol)
            expiry_date = datetime.strptime(expiry_str, "%Y-%m-%d").date()
            is_zero_dte = expiry_date <= datetime.now(ET).date()
        except Exception:
            is_zero_dte = True  # unparseable — fail closed, same convention as the stream-verify fix
        if not is_zero_dte:
            logger.info("[Scheduler] EOD close skipped for %s — %s expires %s, not 0DTE",
                        getattr(engine, "strategy_id", None) or engine.ticker,
                        engine.contract_symbol, expiry_str)
            return

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
                trading_client=engine.trading_client,
                trade_id=engine.active_trade_id,
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


# ── Expiry reminders (swing/LEAPS heads-up, not a forced close) ────────────────
# Milestones, checked in order of urgency — days_to_expiry is calendar days,
# so a milestone can be skipped over a weekend (e.g. a Monday expiry means
# Friday's check sees 3 days left, not 2 or 1). That's fine: there's no
# trading day in between to act on it anyway, and "week" already caught it.
_EXPIRY_MILESTONES = [
    ("one_day", 1),
    ("two_day", 2),
    ("week",    7),
]


def check_expiry_reminders():
    """
    Daily check across EVERY open orb_trades row (any engine, saved-strategy
    or immediate) for one of three heads-up milestones: 1 day, 2 days, or
    within the week of expiration. Purely informational — no position is
    touched. Added as the replacement for the old blanket EOD auto-close once
    that was scoped to 0DTE-only (2026-07-17): a swing/LEAPS holder still gets
    *some* warning as expiry approaches, just not a forced exit.

    Each (trade, milestone) fires at most once — expiry_reminders_sent on the
    row tracks which milestones already went out, so re-running this (or a
    Railway restart) never re-sends the same reminder.
    """
    from services.strategy.orb_engine import ORBEngine
    from services.strategy.trade_logger import TradeLogger
    from services.strategy.notifier import StrategyNotifier
    from services.supabase.supabase_service import get_supabase_service

    logger_svc = TradeLogger()
    notifier = StrategyNotifier(get_supabase_service().client)
    today_et = datetime.now(ET).date()

    rows = logger_svc.get_open_trades()
    for row in rows:
        try:
            _, expiry_str = ORBEngine._parse_occ_symbol(row["contract_symbol"])
            expiry_date = datetime.strptime(expiry_str, "%Y-%m-%d").date()
            days_to_expiry = (expiry_date - today_et).days
            if days_to_expiry <= 0:
                continue  # 0DTE / already past — not what this reminder is for

            already_sent = row.get("expiry_reminders_sent") or []
            milestone = next(
                (m for m, threshold in _EXPIRY_MILESTONES
                 if days_to_expiry <= threshold and m not in already_sent),
                None,
            )
            if not milestone:
                continue

            qty_remaining = max(int(row["qty_entered"]) - int(row.get("qty_exited") or 0), 0)
            if qty_remaining <= 0:
                continue

            notifier.notify_expiry_reminder(
                contract_symbol=row["contract_symbol"],
                days_to_expiry=days_to_expiry,
                milestone=milestone,
                qty=qty_remaining,
                direction=row["direction"],
            )
            logger_svc.mark_expiry_reminder_sent(row["id"], milestone, already_sent)
        except Exception as e:
            logger.error("[Scheduler] check_expiry_reminders failed for %s (id=%s): %s",
                         row.get("contract_symbol"), row.get("id"), e, exc_info=True)


def schedule_expiry_reminders():
    """
    One global daily job (not per-engine) — 9:00 AM ET, mon-fri, well before
    the open so a swing-trade holder sees it first thing. Call once at boot.
    """
    sched = get_scheduler()
    if not sched:
        logger.warning("[Scheduler] APScheduler not available — expiry reminders not scheduled")
        return
    if not sched.running:
        sched.start()
    sched.add_job(
        check_expiry_reminders,
        CronTrigger(day_of_week="mon-fri", hour=9, minute=0, timezone=ET),
        id="job_expiry_reminders", replace_existing=True,
    )
    logger.info("[Scheduler] Expiry reminder check scheduled (daily 9:00 AM ET)")

    return sched
